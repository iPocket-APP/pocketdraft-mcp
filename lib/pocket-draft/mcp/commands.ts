import { z } from "zod"
import { CANVAS_DIMENSION_RANGE } from "../models"
import {
  aspectSchema,
  colorInputSchema,
  fillSchema,
  idSchema,
  numberSchema,
  pointSchema,
} from "./validation"
import { MUTATION_COMMANDS, type MutationCommand } from "./protocol"
const text = z.string().max(100000),
  name = z.string().max(1000),
  optionalId = idSchema.optional()
export const referenceSchema = z.union([
  idSchema,
  z.object({ ref: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/) }).strict(),
])
const optionalRef = referenceSchema.optional()
const n = numberSchema,
  positive = n.positive(),
  unit = n.min(0).max(1)
const transform = z
  .object({
    center: pointSchema.partial().strict().optional(),
    scale: n.min(0.1).max(8).optional(),
    rotation: n.optional(),
  })
  .strict()
export const textPatch = {
  string: text.optional(),
  fontName: name.optional(),
  fontSize: n.min(8).max(8192).optional(),
  weight: z.enum(["regular", "medium", "semibold", "bold"]).optional(),
  alignment: z.enum(["leading", "center", "trailing"]).optional(),
  color: colorInputSchema.optional(),
  lineSpacing: n.optional(),
  kerning: n.optional(),
  boxWidth: positive.nullable().optional(),
  stroke: z
    .object({ color: colorInputSchema, width: n.nonnegative() })
    .strict()
    .nullable()
    .optional(),
  shadow: z
    .object({
      color: colorInputSchema,
      radius: n.nonnegative(),
      offsetX: n,
      offsetY: n,
    })
    .strict()
    .nullable()
    .optional(),
  pill: z
    .object({
      color: colorInputSchema,
      paddingX: n.nonnegative(),
      paddingY: n.nonnegative(),
      cornerRadius: n.nonnegative(),
    })
    .strict()
    .nullable()
    .optional(),
}
const patch = z
  .object({
    ...textPatch,
    deviceId: optionalId,
    frameId: optionalId,
    orientation: z.enum(["portrait", "landscape"]).optional(),
    screenshotZoom: n.min(1).max(3).optional(),
    screenshotOffset: pointSchema.partial().strict().optional(),
    shadowIntensity: unit.optional(),
    aspectRatio: positive.optional(),
    cornerRadius: n.nonnegative().optional(),
  })
  .strict()
const base = {
  schemaVersion: z.literal(1).optional(),
  document: z.record(z.string(), z.unknown()).optional(),
  project: z.record(z.string(), z.unknown()).optional(),
  assets: z.record(z.string(), z.string()).optional(),
  locale: z.enum(["zh", "en"]).optional(),
  assetMode: z.enum(["inline", "reference"]).optional(),
}
const canvas = { canvasId: optionalRef }
const layer = { ...canvas, layerId: referenceSchema }
const url = z
  .string()
  .min(1)
  .max(12 * 1024 * 1024)
const template = {
  ...canvas,
  templateId: idSchema,
  display: z.enum(["65", "69"]).optional(),
  themeId: optionalId,
}
const define = <T extends z.ZodRawShape>(fields: T) =>
  z.object({ ...base, ...fields }).strict()
export const COMMAND_SCHEMAS = {
  "projects.create": define({
    aspect: aspectSchema.optional(),
    name: name.optional(),
  }),
  "projects.rename": define({ name: name.min(1) }),
  "projects.import": define({
    package: z.record(z.string(), z.unknown()).optional(),
  }),
  "canvases.add": define({
    name: name.optional(),
    duplicate: z.boolean().optional(),
  }),
  "canvases.delete": define({ canvasId: referenceSchema }),
  "canvases.rename": define({ canvasId: referenceSchema, name: name.min(1) }),
  "canvases.switch": define({ canvasId: referenceSchema }),
  "canvases.setAspect": define({
    ...canvas,
    aspect: aspectSchema,
    width: n
      .int()
      .min(CANVAS_DIMENSION_RANGE.min)
      .max(CANVAS_DIMENSION_RANGE.max)
      .optional(),
    height: n
      .int()
      .min(CANVAS_DIMENSION_RANGE.min)
      .max(CANVAS_DIMENSION_RANGE.max)
      .optional(),
  }),
  "templates.apply": define(template),
  "templates.applySet": define(template),
  "layers.addDevice": define({
    ...canvas,
    name: name.optional(),
    deviceId: optionalId,
    frameId: optionalId,
    orientation: z.enum(["portrait", "landscape"]).optional(),
    url: url.optional(),
    transform: transform.optional(),
  }),
  "layers.addText": define({
    ...canvas,
    name: name.optional(),
    ...textPatch,
    transform: transform.optional(),
  }),
  "layers.addImage": define({
    ...canvas,
    name: name.optional(),
    url,
    cornerRadius: n.nonnegative().optional(),
    transform: transform.optional(),
  }),
  "layers.update": define({
    ...layer,
    ...patch.shape,
    name: name.optional(),
    opacity: unit.optional(),
    isVisible: z.boolean().optional(),
    isLocked: z.boolean().optional(),
    transform: transform.optional(),
    content: patch.optional(),
  }),
  "layers.delete": define(layer),
  "layers.reorder": define({
    ...layer,
    action: z.enum(["front", "back", "forward", "backward"]).optional(),
    toIndex: n.int().min(1).optional(),
  }),
  "layers.setBackground": define({
    ...canvas,
    color: colorInputSchema.optional(),
    presetId: optionalId,
    fill: fillSchema.optional(),
    url: url.optional(),
    blurRadius: n.nonnegative().optional(),
    dimming: unit.optional(),
  }),
  "layers.setDevicePadding": define({ ...canvas, value: n.min(0).max(0.5) }),
  "assets.attach": define({
    ...canvas,
    layerId: optionalRef,
    url,
    cropPolicy: z.enum(["reset", "preserve"]).optional(),
    target: z.enum(["screenshot", "image", "background"]).optional(),
  }),
  "layout.sync": define({
    sourceCanvasId: optionalRef,
    targetCanvasIds: z.array(referenceSchema).min(1).max(10),
    mapping: z
      .array(
        z
          .object({
            targetCanvasId: referenceSchema,
            sourceLayerId: referenceSchema,
            targetLayerId: referenceSchema,
          })
          .strict()
      )
      .max(500)
      .optional(),
    fields: z
      .array(z.enum(["transform", "opacity", "style"]))
      .min(1)
      .optional(),
    scope: z
      .object({
        canvasSize: z.boolean().optional(),
        background: z.boolean().optional(),
        devices: z.boolean().optional(),
        texts: z.boolean().optional(),
        images: z.boolean().optional(),
      })
      .strict()
      .optional(),
  }),
  "canvases.duplicate": define({
    canvasId: referenceSchema,
    name: name.optional(),
  }),
  "canvases.reorder": define({
    canvasIds: z.array(referenceSchema).min(1).max(10),
  }),
  "layers.duplicate": define({
    ...layer,
    targetCanvasId: optionalRef,
    name: name.optional(),
  }),
  "assets.reuse": define({
    ...canvas,
    layerId: optionalRef,
    assetRef: idSchema,
    target: z.enum(["screenshot", "image", "background"]),
    cropPolicy: z.enum(["reset", "preserve"]).optional(),
  }),
  "devices.clearScreenshot": define(layer),
  "devices.setCrop": define({
    ...layer,
    zoom: n.min(1).max(3).optional(),
    offset: pointSchema.partial().strict().optional(),
  }),
  "devices.resetCrop": define(layer),
  "layers.position": define({ ...layer, x: n, y: n }),
  "layers.move": define({ ...layer, dx: n, dy: n }),
  "layers.resize": define({
    ...layer,
    width: positive.optional(),
    height: positive.optional(),
  }),
  "layers.rotate": define({
    ...layer,
    degrees: n,
    relative: z.boolean().optional(),
  }),
  "layers.align": define({
    ...canvas,
    layerIds: z.array(referenceSchema).min(1).max(49),
    alignment: z.enum(["left", "right", "top", "bottom", "centerX", "centerY"]),
    reference: z.enum(["canvas", "selection", "layer"]).optional(),
    referenceLayerId: optionalRef,
    margin: n.optional(),
  }),
  "layers.distribute": define({
    ...canvas,
    layerIds: z.array(referenceSchema).min(2).max(49),
    axis: z.enum(["x", "y"]),
    gap: n.nonnegative().optional(),
  }),
  "texts.reflow": define({ ...layer, width: positive }),
  "texts.fit": define({
    ...layer,
    width: positive,
    height: positive,
    minFontSize: n.min(8).max(8192),
    maxFontSize: n.min(8).max(8192),
    maxLines: n.int().positive().optional(),
  }),
} satisfies Record<MutationCommand, z.ZodObject<z.ZodRawShape>>
export const COMMAND_EXAMPLES: Record<
  MutationCommand,
  Record<string, unknown>
> = {
  "projects.create": { name: "App Store", aspect: "appStore69" },
  "projects.rename": { name: "Launch" },
  "projects.import": {
    package: {
      type: "pocket-draft-project",
      version: 1,
      project: "<project>",
      assets: {},
    },
  },
  "canvases.add": { name: "Features" },
  "canvases.delete": { canvasId: "<canvas-id>" },
  "canvases.rename": { canvasId: "<canvas-id>", name: "Features" },
  "canvases.switch": { canvasId: "<canvas-id>" },
  "canvases.setAspect": { aspect: "appStore69" },
  "templates.apply": { templateId: "layout-classic" },
  "templates.applySet": { templateId: "set-editorial" },
  "layers.addDevice": { deviceId: "iphone-17-pro" },
  "layers.addText": { string: "Ship faster" },
  "layers.addImage": { url: "https://example.com/image.png" },
  "layers.update": { layerId: "<layer-id>", string: "Hello" },
  "layers.delete": { layerId: "<layer-id>" },
  "layers.reorder": { layerId: "<layer-id>", action: "front" },
  "layers.setBackground": { color: "#ffffff" },
  "layers.setDevicePadding": { value: 0.08 },
  "assets.attach": {
    url: "https://example.com/image.png",
    target: "screenshot",
  },
  "layout.sync": {
    sourceCanvasId: "<canvas-id>",
    targetCanvasIds: ["<target-canvas-id>"],
    scope: {
      texts: true,
      devices: false,
      images: false,
      background: false,
      canvasSize: false,
    },
  },
  "canvases.duplicate": { canvasId: "<canvas-id>", name: "Copy" },
  "canvases.reorder": { canvasIds: ["<canvas-id>", "<other-canvas-id>"] },
  "layers.duplicate": {
    layerId: "<layer-id>",
    targetCanvasId: "<target-canvas-id>",
  },
  "assets.reuse": {
    assetRef: "<asset-ref>",
    target: "screenshot",
    layerId: "<device-id>",
  },
  "devices.clearScreenshot": { layerId: "<device-id>" },
  "devices.setCrop": {
    layerId: "<device-id>",
    zoom: 1.2,
    offset: { x: 0, y: 0 },
  },
  "devices.resetCrop": { layerId: "<device-id>" },
  "layers.position": { layerId: "<layer-id>", x: 540, y: 120 },
  "layers.move": { layerId: "<layer-id>", dx: 0, dy: -12 },
  "layers.resize": { layerId: "<layer-id>", width: 400 },
  "layers.rotate": { layerId: "<layer-id>", degrees: -8 },
  "layers.align": {
    layerIds: ["<layer-a>", "<layer-b>"],
    alignment: "left",
    reference: "selection",
  },
  "layers.distribute": { layerIds: ["<a>", "<b>", "<c>"], axis: "x", gap: 24 },
  "texts.reflow": { layerId: "<title>", width: 800 },
  "texts.fit": {
    layerId: "<title>",
    width: 800,
    height: 240,
    minFontSize: 24,
    maxFontSize: 96,
    maxLines: 2,
  },
}

// One registry drives runtime validation, tool discovery, and resource documentation.
type PublicSchema<T> =
  T extends z.ZodObject<infer S>
    ? z.ZodObject<Omit<S, "document" | "project" | "assets" | "assetMode">>
    : never
type PublicCommandSchemas = {
  [K in MutationCommand]: PublicSchema<(typeof COMMAND_SCHEMAS)[K]>
}
export const PUBLIC_COMMAND_SCHEMAS = Object.fromEntries(
  MUTATION_COMMANDS.map((command) => [
    command,
    (COMMAND_SCHEMAS[command] as z.ZodObject<z.ZodRawShape>).omit({
      document: true,
      project: true,
      assets: true,
      assetMode: true,
    }),
  ])
) as PublicCommandSchemas
export type CommandInput<K extends MutationCommand> = z.input<
  PublicCommandSchemas[K]
>
export type TypedBatchStep = {
  [K in MutationCommand]: { command: K; input: CommandInput<K>; as?: string }
}[MutationCommand]
const steps = MUTATION_COMMANDS.map((command) =>
  z
    .object({
      command: z.literal(command),
      input: PUBLIC_COMMAND_SCHEMAS[command],
      as: z
        .string()
        .regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
        .optional(),
    })
    .strict()
)
export const batchStepSchema = z.discriminatedUnion(
  "command",
  steps as [(typeof steps)[number], (typeof steps)[number], ...typeof steps]
)
export type BatchStep = {
  command: MutationCommand
  input: Record<string, unknown>
  as?: string
}
export const GEOMETRY_COMMANDS = new Set<string>([
  "layers.position",
  "layers.move",
  "layers.resize",
  "layers.rotate",
  "layers.align",
  "layers.distribute",
  "texts.reflow",
  "texts.fit",
  "devices.setCrop",
  "devices.resetCrop",
  "assets.reuse",
])

/** Coordinate and execution rules shared by discovery resources and tool descriptions. */
export const COMMAND_RULES = {
  coordinates:
    "layers.move dx/dy, layers.position x/y (center), resize width/height, alignment margin, distribution gap, text fit/reflow width/height, and devices.setCrop offset all use canvas logical pixels. Rotation commands use degrees. resize preserves aspect ratio and scales the whole layer; texts.reflow changes wrapping without scaling glyphs. Text style values are unscaled layer-local pixels.",
  legacy:
    "layers.update transform.center is normalized to canvas width/height; transform.rotation is radians; scale is unitless (0.1–8). Its screenshotOffset remains a normalized fraction of the screen, unlike devices.setCrop offset in logical pixels. Never mix these representations.",
  selection:
    "Only explicit IDs or batch-local {ref: alias} write targets. Search names/text via inspect first. Ambiguous implicit screenshot/image targets return candidates.",
  geometry:
    "Alignment and distribution use rotated bounds including text pill padding, excluding shadows. Default align reference is canvas. Distribution without gap holds endpoints; with gap anchors the first layer. texts.fit uses browser fonts, includes pill padding, preserves copy and rotation, and fails when constraints cannot fit. Fit dimensions describe the unrotated box. Cropping uses the actual decoded image aspect.",
  textEffects:
    "stroke, shadow, pill and boxWidth accept null to remove. Supply complete effect objects; do not mix top-level text/device fields with content.",
  locking:
    "Unlock a locked layer in an earlier command before changing content, geometry, order or deleting. Visibility/lock-only changes are allowed. Canvas resize/delete and template replacement also honor locks.",
  aliases:
    "Set as on a single layer or canvas creation/duplication. Later IDs may be {ref: alias}. Aliases are scoped to this batch; dry-run IDs are temporary. Copy maps describe every duplicated ID.",
  synchronization:
    "layout.sync requires explicit targetCanvasIds. Default scope covers size/background/devices/texts/images. fields selects transform/opacity/style for foreground layers; canvasSize/background follow scope. Style preserves target text and asset references. Supply mapping for differently structured targets. Validate with validate_project.layoutSync or dryRun; any mismatch rejects the whole batch.",
  screenshots:
    "Replacing a screenshot preserves device position, size and orientation. Crop resets unless cropPolicy=preserve is explicit and valid. devices.clearScreenshot resets crop too.",
  verification:
    "Every step reports changed, fields, created IDs and optional copyMap. dryRun performs the same preparation and geometry with no storage/history writes. No-op batches do not commit. Final summary/revision come from the saved browser state. History requires the inspected revision and entryId. Cancellation can race with a committed transaction; check operation_status before retrying.",
} as const
