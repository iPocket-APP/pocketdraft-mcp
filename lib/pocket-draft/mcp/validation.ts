import { z } from "zod"
import {
  CANVAS_ASPECT_LABELS,
  MAXIMUM_CANVAS_COUNT,
  MAXIMUM_LAYER_COUNT,
  MAXIMUM_DEVICE_COPIES,
  syncActiveCanvasToProject,
  type Project,
} from "../models"
import { getDevice, getFrame } from "../catalog"
import { PocketDraftMcpError } from "./errors"

export const idSchema = z.string().min(1).max(256)
export const numberSchema = z.number().finite()
const positive = numberSchema.positive()
const unit = numberSchema.min(0).max(1)
export const colorSchema = z.object({ r: unit, g: unit, b: unit, a: unit })
export const colorInputSchema = z.union([
  colorSchema.strict(),
  z.string().regex(/^#?(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i),
])
export const pointSchema = z.object({ x: numberSchema, y: numberSchema })
export const transformSchema = z.object({
  center: pointSchema,
  scale: positive.max(8),
  rotation: numberSchema,
})
export const aspectSchema = z.enum(
  Object.keys(CANVAS_ASPECT_LABELS) as [
    Project["canvasAspect"],
    ...Project["canvasAspect"][],
  ]
)
const stops = z
  .array(z.object({ color: colorSchema, location: unit }))
  .min(2)
  .max(64)
export const fillSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("solid"), color: colorSchema }),
  z.object({ kind: z.literal("linearGradient"), stops, angle: numberSchema }),
  z.object({ kind: z.literal("radialGradient"), stops }),
  z.object({
    kind: z.literal("image"),
    assetRef: idSchema,
    blurRadius: numberSchema.nonnegative(),
    dimming: unit,
  }),
])
const contentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("background"),
    fill: fillSchema,
    devicePadding: unit,
  }),
  z.object({
    kind: z.literal("device"),
    deviceId: idSchema,
    frameId: idSchema,
    orientation: z.enum(["portrait", "landscape"]),
    screenshotRef: idSchema.nullable(),
    screenshotZoom: positive,
    screenshotOffset: pointSchema,
    shadowIntensity: unit,
    wasManuallyTransformed: z.boolean(),
  }),
  z.object({
    kind: z.literal("text"),
    string: z.string().max(100000),
    fontName: z.string().max(256),
    fontSize: positive.max(8192),
    weight: z.enum(["regular", "medium", "semibold", "bold"]),
    color: colorSchema,
    alignment: z.enum(["leading", "center", "trailing"]),
    lineSpacing: numberSchema,
    kerning: numberSchema,
    boxWidth: positive.nullish(),
    stroke: z
      .object({ color: colorSchema, width: numberSchema.nonnegative() })
      .nullish(),
    shadow: z
      .object({
        color: colorSchema,
        radius: numberSchema.nonnegative(),
        offsetX: numberSchema,
        offsetY: numberSchema,
      })
      .nullish(),
    pill: z
      .object({
        color: colorSchema,
        paddingX: numberSchema.nonnegative(),
        paddingY: numberSchema.nonnegative(),
        cornerRadius: numberSchema.nonnegative(),
      })
      .nullish(),
  }),
  z.object({
    kind: z.literal("image"),
    assetRef: idSchema,
    aspectRatio: positive,
    cornerRadius: numberSchema.nonnegative(),
  }),
])
export const layerSchema = z.object({
  id: idSchema,
  name: z.string().max(1000),
  transform: transformSchema,
  opacity: unit,
  isVisible: z.boolean(),
  isLocked: z.boolean(),
  content: contentSchema,
})
export const canvasSchema = z.object({
  id: idSchema,
  name: z.string().max(1000),
  canvasAspect: aspectSchema,
  canvasLogicalSize: z.object({
    width: positive.max(8192),
    height: positive.max(8192),
  }),
  layers: z.array(layerSchema).min(1).max(MAXIMUM_LAYER_COUNT),
})
const projectSchemaFor = (canvas: z.ZodType<z.infer<typeof canvasSchema>>) =>
  z
    .object({
      id: idSchema,
      name: z.string().max(1000),
      schemaVersion: z.literal(2),
      canvases: z.array(canvas).min(1).max(MAXIMUM_CANVAS_COUNT),
      activeCanvasId: idSchema,
    })
    .superRefine((p, ctx) => {
      const ids = new Set<string>()
      p.canvases.forEach((c, i) => {
        if (ids.has(c.id))
          ctx.addIssue({
            code: "custom",
            path: ["canvases", i, "id"],
            message: "Duplicate canvas id",
          })
        ids.add(c.id)
        const layers = new Set<string>()
        if (
          c.layers[0]?.content.kind !== "background" ||
          c.layers.filter((l) => l.content.kind === "background").length !== 1
        )
          ctx.addIssue({
            code: "custom",
            path: ["canvases", i, "layers"],
            message: "Exactly one background must be first",
          })
        if (
          c.layers.filter((l) => l.content.kind === "device").length >
          MAXIMUM_DEVICE_COPIES
        )
          ctx.addIssue({
            code: "custom",
            path: ["canvases", i, "layers"],
            message: "Device limit exceeded",
          })
        c.layers.forEach((l, j) => {
          if (layers.has(l.id))
            ctx.addIssue({
              code: "custom",
              path: ["canvases", i, "layers", j, "id"],
              message: "Duplicate layer id",
            })
          layers.add(l.id)
          if (
            l.content.kind === "device" &&
            (!getDevice(l.content.deviceId) ||
              !getFrame(l.content.deviceId, l.content.frameId))
          )
            ctx.addIssue({
              code: "custom",
              path: ["canvases", i, "layers", j, "content"],
              message: "Unknown device or frame",
            })
        })
      })
      if (!ids.has(p.activeCanvasId))
        ctx.addIssue({
          code: "custom",
          path: ["activeCanvasId"],
          message: "Unknown active canvas",
        })
    })
export const projectSchema = projectSchemaFor(canvasSchema)
const validatedCanvasProjectSchema = projectSchemaFor(
  z.custom<z.infer<typeof canvasSchema>>()
)
export function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success)
    throw new PocketDraftMcpError(
      "invalid_input",
      "Invalid input",
      result.error.issues.map((i) => ({
        path: i.path.map(String).join("."),
        message: i.message,
      }))
    )
  return result.data
}
export function validateProject(
  input: unknown,
  validatedCanvases?: WeakSet<object>
): Project {
  if (
    !validatedCanvases ||
    !input ||
    typeof input !== "object" ||
    !("canvases" in input) ||
    !Array.isArray(input.canvases)
  ) {
    return syncActiveCanvasToProject(validate(projectSchema, input) as Project)
  }
  const canvases = input.canvases.map((canvas, index) => {
    if (canvas && typeof canvas === "object" && validatedCanvases.has(canvas))
      return canvas
    const parsed = canvasSchema.safeParse(canvas)
    if (!parsed.success)
      throw new PocketDraftMcpError(
        "invalid_input",
        "Invalid input",
        parsed.error.issues.map((i) => ({
          path: ["canvases", index, ...i.path].map(String).join("."),
          message: i.message,
        }))
      )
    return parsed.data
  })
  // All changed canvases were deeply validated above. Always rerun cross-project invariants.
  const project = syncActiveCanvasToProject(
    validate(validatedCanvasProjectSchema, { ...input, canvases }) as Project
  )
  project.canvases.forEach((canvas) => validatedCanvases.add(canvas))
  return project
}
