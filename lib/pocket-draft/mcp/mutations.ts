import { resolveBatchInput, type BatchReference } from "./batch-references"
import { errorData } from "../bridge-protocol"
import { extraCommand } from "./extra-commands"
import {
  editable,
  validateLayerPatch,
  uniqueTarget,
  operationError,
  projectChanges,
} from "./precision"
import { COMMAND_SCHEMAS, GEOMETRY_COMMANDS, type BatchStep } from "./commands"
import { validate } from "./validation"
import { callContext, withCallContext } from "./call-context"
import {
  DEFAULT_DEVICE_ID,
  defaultFrameId,
  getDevice,
  getFrame,
  orientationForSize,
} from "@/lib/pocket-draft/catalog"
import { GRADIENT_PRESETS } from "@/lib/pocket-draft/gradients"
import { normalizedCustomSize } from "@/lib/pocket-draft/geometry"
import {
  CANVAS_ASPECT_SIZES,
  CANVAS_ASPECT_LABELS,
  CANVAS_DIMENSION_RANGE,
  MAXIMUM_CANVAS_COUNT,
  MAXIMUM_DEVICE_COPIES,
  MAXIMUM_LAYER_COUNT,
  SCALE_RANGE,
  SCREENSHOT_ZOOM_RANGE,
  activeCanvasOf,
  clamp,
  colorFromHex,
  createBlankCanvas,
  createDeviceLayer,
  createImageLayer,
  createTextLayer,
  deviceLayerCount,
  isBackground,
  isDevice,
  syncActiveCanvasToProject,
  uniqueLayerName,
  type BackgroundFill,
  type CanvasAspect,
  type Color,
  type DeviceContent,
  type DeviceOrientation,
  type FontWeight,
  type ImageContent,
  type Layer,
  type LayerTransform,
  type Point,
  type Project,
  type ProjectCanvas,
  type Size,
  type TextAlign,
  type TextContent,
} from "@/lib/pocket-draft/models"
import {
  applyTemplateSetToProject,
  applyTemplateToCanvas,
  TEMPLATES,
} from "@/lib/pocket-draft/templates"
import {
  GOLDIE_THEMES,
  type AppStoreDisplay,
} from "@/lib/pocket-draft/goldie-layouts"

import { PocketDraftMcpError } from "@/lib/pocket-draft/mcp/errors"
import { resolveAssetSource } from "@/lib/pocket-draft/mcp/fetch-asset"
import {
  createEmptyDocument,
  parseDocument,
  parseDocumentFromInput,
  pruneDocumentAssets,
  type PocketDraftDocument,
  type ProjectInspection,
  inspectDocument,
} from "@/lib/pocket-draft/mcp/document"
import {
  MUTATION_COMMANDS,
  type MutationCommand,
} from "@/lib/pocket-draft/mcp/protocol"

const ASPECTS = new Set<string>(Object.keys(CANVAS_ASPECT_LABELS))

const FONT_WEIGHTS = new Set<FontWeight>([
  "regular",
  "medium",
  "semibold",
  "bold",
])
const TEXT_ALIGNS = new Set<TextAlign>(["leading", "center", "trailing"])
const ORIENTATIONS = new Set<DeviceOrientation>(["portrait", "landscape"])
const REORDER_ACTIONS = new Set(["front", "back", "forward", "backward"])

export type MutationResult = {
  document: PocketDraftDocument
  summary: ProjectInspection
  warnings: string[]
  command: MutationCommand
  copyMap?: Record<string, string>
  steps?: Array<
    ReturnType<typeof projectChanges> & {
      command: MutationCommand
      index: number
      as?: string
      copyMap?: Record<string, string>
    }
  >
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PocketDraftMcpError(
      "invalid_input",
      `${key} must be a non-empty string.`
    )
  }
  return value
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function parseLocale(input: Record<string, unknown>): string {
  return asString(input.locale) ?? "zh"
}

function isZh(locale: string): boolean {
  return locale.startsWith("zh")
}

function parseCommand(value: unknown): MutationCommand {
  if (
    typeof value === "string" &&
    (MUTATION_COMMANDS as readonly string[]).includes(value)
  ) {
    return value as MutationCommand
  }
  throw new PocketDraftMcpError(
    "unsupported_command",
    `Unknown command. Supported: ${MUTATION_COMMANDS.join(", ")}`
  )
}

function parseColor(value: unknown, fallback?: Color): Color | undefined {
  if (typeof value === "string") return colorFromHex(value)
  if (!isRecord(value)) return fallback
  return {
    r: clamp(optionalNumber(value.r) ?? fallback?.r ?? 0, 0, 1),
    g: clamp(optionalNumber(value.g) ?? fallback?.g ?? 0, 0, 1),
    b: clamp(optionalNumber(value.b) ?? fallback?.b ?? 0, 0, 1),
    a: clamp(optionalNumber(value.a) ?? fallback?.a ?? 1, 0, 1),
  }
}

function parsePoint(value: unknown, fallback: Point): Point {
  if (!isRecord(value)) return fallback
  return {
    x: optionalNumber(value.x) ?? fallback.x,
    y: optionalNumber(value.y) ?? fallback.y,
  }
}

function parseTransform(
  value: unknown,
  fallback: LayerTransform
): LayerTransform {
  if (!isRecord(value)) return fallback
  return {
    center: parsePoint(value.center, fallback.center),
    scale: clamp(
      optionalNumber(value.scale) ?? fallback.scale,
      SCALE_RANGE.min,
      SCALE_RANGE.max
    ),
    rotation: optionalNumber(value.rotation) ?? fallback.rotation,
  }
}

function parseAspect(value: unknown): CanvasAspect {
  if (typeof value === "string" && ASPECTS.has(value))
    return value as CanvasAspect
  throw new PocketDraftMcpError("invalid_input", "Unknown canvas aspect.")
}

function parseDisplay(value: unknown): AppStoreDisplay {
  if (value === "65" || value === "69") return value
  if (value === undefined) return "69"
  throw new PocketDraftMcpError("invalid_input", "display must be 69 or 65.")
}

function requireDocument(input: Record<string, unknown>): PocketDraftDocument {
  return parseDocumentFromInput(input, true)!
}

function mapCanvas(
  project: Project,
  canvasId: string,
  mapper: (canvas: ProjectCanvas) => ProjectCanvas
): Project {
  const nextCanvases = project.canvases.map((canvas) =>
    canvas.id === canvasId ? mapper(canvas) : canvas
  )
  return syncActiveCanvasToProject({ ...project, canvases: nextCanvases })
}

function resolveCanvasId(
  project: Project,
  input: Record<string, unknown>
): string {
  const id = asString(input.canvasId) ?? project.activeCanvasId
  if (!project.canvases.some((canvas) => canvas.id === id)) {
    throw new PocketDraftMcpError("not_found", `Unknown canvas: ${id}`)
  }
  return id
}

function findLayerInCanvas(canvas: ProjectCanvas, layerId: string): Layer {
  const layer = canvas.layers.find((item) => item.id === layerId)
  if (!layer) {
    throw new PocketDraftMcpError("not_found", `Unknown layer: ${layerId}`)
  }
  return layer
}

function parseBackgroundFill(
  input: Record<string, unknown>,
  current?: BackgroundFill
): BackgroundFill {
  if (typeof input.presetId === "string") {
    const preset = GRADIENT_PRESETS.find((item) => item.id === input.presetId)
    if (!preset) {
      throw new PocketDraftMcpError(
        "not_found",
        `Unknown gradient: ${input.presetId}`
      )
    }
    return preset.kind === "radial"
      ? { kind: "radialGradient", stops: preset.stops }
      : { kind: "linearGradient", stops: preset.stops, angle: preset.angle }
  }
  if (input.color !== undefined)
    return { kind: "solid", color: parseColor(input.color)! }
  const fill = input.fill
  if (!isRecord(fill) || typeof fill.kind !== "string") {
    if (current) return current
    throw new PocketDraftMcpError(
      "invalid_input",
      "fill, color, or presetId is required."
    )
  }
  if (fill.kind === "solid") {
    const color = parseColor(fill.color)
    if (!color)
      throw new PocketDraftMcpError("invalid_input", "solid fill needs color.")
    return { kind: "solid", color }
  }
  if (fill.kind === "linearGradient" || fill.kind === "radialGradient") {
    const stops = Array.isArray(fill.stops)
      ? fill.stops.flatMap((stop) => {
          if (!isRecord(stop)) return []
          const color = parseColor(stop.color)
          const location = optionalNumber(stop.location)
          if (!color || location === undefined) return []
          return [{ color, location }]
        })
      : []
    if (stops.length < 2) {
      throw new PocketDraftMcpError(
        "invalid_input",
        "Gradient needs at least two stops."
      )
    }
    if (fill.kind === "radialGradient") {
      return { kind: "radialGradient", stops }
    }
    return {
      kind: "linearGradient",
      stops,
      angle: optionalNumber(fill.angle) ?? 180,
    }
  }
  if (fill.kind === "image") {
    const assetRef = asString(fill.assetRef)
    if (!assetRef) {
      throw new PocketDraftMcpError(
        "invalid_input",
        "image fill needs assetRef."
      )
    }
    return {
      kind: "image",
      assetRef,
      blurRadius: optionalNumber(fill.blurRadius) ?? 0,
      dimming: optionalNumber(fill.dimming) ?? 0,
    }
  }
  throw new PocketDraftMcpError("invalid_input", "Unsupported background fill.")
}

async function attachToDocument(
  document: PocketDraftDocument,
  source: string
): Promise<{
  document: PocketDraftDocument
  ref: string
  width: number
  height: number
}> {
  const resolved = await resolveAssetSource(source)
  return {
    document: {
      ...document,
      assets: {
        ...document.assets,
        [resolved.ref]:
          callContext()?.assetMode === "reference" &&
          !source.startsWith("data:")
            ? source
            : resolved.dataUrl,
      },
    },
    ref: resolved.ref,
    width: resolved.width ?? 1,
    height: resolved.height ?? 1,
  }
}

function finish(
  command: MutationCommand,
  document: PocketDraftDocument,
  warnings: string[] = []
): MutationResult {
  const next = parseDocument(pruneDocumentAssets(document))
  let summary: ReturnType<typeof inspectDocument> | undefined
  return {
    command,
    document: next,
    // A batch only consumes its final summary; keep intermediate steps validation-only.
    get summary() {
      return (summary ??= inspectDocument(next))
    },
    warnings,
  }
}

async function runCommand(
  command: MutationCommand,
  input: Record<string, unknown>
): Promise<MutationResult> {
  const locale = parseLocale(input)
  const warnings: string[] = []

  if (GEOMETRY_COMMANDS.has(command)) {
    const document = requireDocument(input),
      evaluate = callContext()?.evaluate
    if (!evaluate)
      operationError(
        "browser_required",
        "This operation requires the paired browser's geometry and fonts."
      )
    return finish(command, {
      ...document,
      project: await evaluate(document, command, input),
    })
  }
  if (
    [
      "canvases.duplicate",
      "canvases.reorder",
      "layers.duplicate",
      "devices.clearScreenshot",
      "layout.sync",
    ].includes(command)
  ) {
    const document = requireDocument(input),
      extra = extraCommand(command, document, input)!
    return {
      ...finish(command, { ...document, project: extra.project }),
      copyMap: extra.copyMap,
    }
  }
  switch (command) {
    case "projects.create": {
      const aspect = input.aspect ? parseAspect(input.aspect) : "portrait45"
      const name = asString(input.name) ?? ""
      return finish(command, createEmptyDocument(aspect, name))
    }
    case "projects.rename": {
      const document = requireDocument(input)
      const name = requireString(input, "name").trim()
      return finish(command, {
        ...document,
        project: { ...document.project, name },
      })
    }
    case "projects.import": {
      const raw = input.package ?? input.document ?? input
      if (!isRecord(raw)) {
        throw new PocketDraftMcpError(
          "invalid_input",
          "package must be an object."
        )
      }
      if (raw.type === "pocket-draft-project" && isRecord(raw.project)) {
        if (raw.version !== 1)
          throw new PocketDraftMcpError(
            "invalid_input",
            "Unsupported package version."
          )
        return finish(
          command,
          parseDocument({
            schemaVersion: 1,
            project: raw.project,
            assets: raw.assets ?? {},
          })
        )
      }
      return finish(command, parseDocument(raw))
    }
    case "canvases.add": {
      const document = requireDocument(input)
      if (document.project.canvases.length >= MAXIMUM_CANVAS_COUNT) {
        throw new PocketDraftMcpError("limit_reached", "Canvas limit reached.")
      }
      const active = activeCanvasOf(document.project)
      const name =
        asString(input.name) ??
        (isZh(locale)
          ? `画布 ${document.project.canvases.length + 1}`
          : `Canvas ${document.project.canvases.length + 1}`)
      let canvas: ProjectCanvas
      if (input.duplicate === true) {
        canvas = structuredClone(active)
        canvas.id = crypto.randomUUID()
        canvas.name = name
        canvas.layers = canvas.layers.map((layer) => ({
          ...layer,
          id: crypto.randomUUID(),
        }))
      } else {
        canvas = createBlankCanvas(
          active.canvasAspect,
          name,
          active.canvasLogicalSize
        )
      }
      const project = syncActiveCanvasToProject({
        ...document.project,
        canvases: [...document.project.canvases, canvas],
        activeCanvasId: canvas.id,
      })
      return {
        ...finish(command, { ...document, project }),
        ...(input.duplicate
          ? {
              copyMap: Object.fromEntries([
                [active.id, canvas.id],
                ...active.layers.map((l, i) => [l.id, canvas.layers[i].id]),
              ]),
            }
          : {}),
      }
    }
    case "canvases.delete": {
      const document = requireDocument(input)
      const canvasId = requireString(input, "canvasId")
      if (document.project.canvases.length <= 1) {
        throw new PocketDraftMcpError(
          "limit_reached",
          "At least one canvas is required."
        )
      }
      if (!document.project.canvases.some((canvas) => canvas.id === canvasId)) {
        throw new PocketDraftMcpError(
          "not_found",
          `Unknown canvas: ${canvasId}`
        )
      }
      document.project.canvases
        .find((canvas) => canvas.id === canvasId)!
        .layers.forEach(editable)
      const canvases = document.project.canvases.filter(
        (canvas) => canvas.id !== canvasId
      )
      const activeCanvasId =
        document.project.activeCanvasId === canvasId
          ? canvases[0].id
          : document.project.activeCanvasId
      return finish(command, {
        ...document,
        project: syncActiveCanvasToProject({
          ...document.project,
          canvases,
          activeCanvasId,
        }),
      })
    }
    case "canvases.rename": {
      const document = requireDocument(input)
      const canvasId = requireString(input, "canvasId")
      const name = requireString(input, "name").trim()
      if (!document.project.canvases.some((canvas) => canvas.id === canvasId)) {
        throw new PocketDraftMcpError(
          "not_found",
          `Unknown canvas: ${canvasId}`
        )
      }
      const project = mapCanvas(document.project, canvasId, (canvas) => ({
        ...canvas,
        name,
      }))
      return finish(command, { ...document, project })
    }
    case "canvases.switch": {
      const document = requireDocument(input)
      const canvasId = requireString(input, "canvasId")
      if (!document.project.canvases.some((canvas) => canvas.id === canvasId)) {
        throw new PocketDraftMcpError(
          "not_found",
          `Unknown canvas: ${canvasId}`
        )
      }
      return finish(command, {
        ...document,
        project: syncActiveCanvasToProject({
          ...document.project,
          activeCanvasId: canvasId,
        }),
      })
    }
    case "canvases.setAspect": {
      const document = requireDocument(input)
      const canvasId = resolveCanvasId(document.project, input)
      const aspect = parseAspect(input.aspect)
      const canvas = document.project.canvases.find((c) => c.id === canvasId)!
      canvas.layers.forEach(editable)
      if (
        aspect !== "custom" &&
        (input.width !== undefined || input.height !== undefined)
      )
        operationError(
          "conflicting_fields",
          "width and height apply only to custom aspect.",
          canvasId,
          "aspect"
        )
      let size: Size
      if (aspect === "custom") {
        const custom = normalizedCustomSize(
          optionalNumber(input.width) ?? 1080,
          optionalNumber(input.height) ?? 1350
        )
        if (!custom) {
          throw new PocketDraftMcpError(
            "invalid_input",
            "Invalid custom canvas size."
          )
        }
        if (
          custom.width !== (input.width ?? 1080) ||
          custom.height !== (input.height ?? 1350)
        )
          operationError(
            "invalid_input",
            "Custom aspect ratio exceeds the supported range.",
            canvasId,
            "width"
          )
        size = custom
      } else {
        size = CANVAS_ASPECT_SIZES[aspect]
      }
      const width = clamp(
        Math.round(size.width),
        CANVAS_DIMENSION_RANGE.min,
        CANVAS_DIMENSION_RANGE.max
      )
      const height = clamp(
        Math.round(size.height),
        CANVAS_DIMENSION_RANGE.min,
        CANVAS_DIMENSION_RANGE.max
      )
      const project = mapCanvas(document.project, canvasId, (canvas) => ({
        ...canvas,
        canvasAspect: aspect,
        canvasLogicalSize: { width, height },
      }))
      return finish(command, { ...document, project })
    }
    case "templates.apply":
    case "templates.applySet": {
      const document = requireDocument(input)
      const templateId = requireString(input, "templateId")
      const template = TEMPLATES.find((item) => item.id === templateId)
      if (!template) {
        throw new PocketDraftMcpError(
          "not_found",
          `Unknown template: ${templateId}`
        )
      }
      const display = parseDisplay(input.display)
      const themeId = asString(input.themeId)
      if (themeId && !Object.hasOwn(GOLDIE_THEMES, themeId))
        operationError("not_found", "Unknown theme.", themeId, "themeId")
      if (template.kind === "set" || command === "templates.applySet") {
        if (template.kind !== "set") {
          throw new PocketDraftMcpError(
            "invalid_input",
            "templates.applySet requires a set template."
          )
        }
        if (input.canvasId !== undefined)
          operationError(
            "conflicting_fields",
            "Template sets target their full sequence; omit canvasId.",
            undefined,
            "canvasId"
          )
        const affected = (template.macSequence ?? template.sequence ?? [])
          .length
        document.project.canvases
          .slice(0, affected)
          .forEach((c) => c.layers.forEach(editable))
        const project = applyTemplateSetToProject(
          document.project,
          template,
          locale,
          display,
          themeId
        )
        return finish(command, { ...document, project })
      }
      const canvasId = resolveCanvasId(document.project, input)
      document.project.canvases
        .find((c) => c.id === canvasId)!
        .layers.forEach(editable)
      const project = mapCanvas(document.project, canvasId, (canvas) =>
        applyTemplateToCanvas(canvas, template, locale, { display, themeId })
      )
      return finish(command, { ...document, project })
    }
    case "layers.addDevice": {
      const document = requireDocument(input)
      const canvasId = resolveCanvasId(document.project, input)
      const canvas = document.project.canvases.find(
        (item) => item.id === canvasId
      )!
      if (canvas.layers.length >= MAXIMUM_LAYER_COUNT) {
        throw new PocketDraftMcpError("limit_reached", "Layer limit reached.")
      }
      if (deviceLayerCount(canvas) >= MAXIMUM_DEVICE_COPIES) {
        throw new PocketDraftMcpError("limit_reached", "Device limit reached.")
      }
      const deviceId = asString(input.deviceId) ?? DEFAULT_DEVICE_ID
      const device = getDevice(deviceId)
      if (!device) {
        throw new PocketDraftMcpError(
          "not_found",
          `Unknown device: ${deviceId}`
        )
      }
      const frameId = asString(input.frameId) ?? defaultFrameId(deviceId)
      if (!getFrame(deviceId, frameId)) {
        throw new PocketDraftMcpError("not_found", `Unknown frame: ${frameId}`)
      }
      let working = document
      let screenshotRef: string | null = null
      let orientation: DeviceOrientation =
        typeof input.orientation === "string" &&
        ORIENTATIONS.has(input.orientation as DeviceOrientation)
          ? (input.orientation as DeviceOrientation)
          : "portrait"
      const url = asString(input.url)
      if (url) {
        const attached = await attachToDocument(working, url)
        working = attached.document
        screenshotRef = attached.ref
        if (input.orientation === undefined)
          orientation = orientationForSize({
            width: attached.width,
            height: attached.height,
          })
      }
      const layer = createDeviceLayer({
        deviceId,
        frameId,
        orientation,
        name: uniqueLayerName(
          asString(input.name) ?? device.name,
          canvas.layers.map((item) => item.name)
        ),
      })
      const content = layer.content as DeviceContent
      content.screenshotRef = screenshotRef
      if (isRecord(input.transform)) {
        layer.transform = parseTransform(input.transform, layer.transform)
      }
      const project = mapCanvas(working.project, canvasId, (item) => ({
        ...item,
        layers: [...item.layers, layer],
      }))
      return finish(command, { ...working, project }, warnings)
    }
    case "layers.addText": {
      const document = requireDocument(input)
      const canvasId = resolveCanvasId(document.project, input)
      const canvas = document.project.canvases.find(
        (item) => item.id === canvasId
      )!
      if (canvas.layers.length >= MAXIMUM_LAYER_COUNT) {
        throw new PocketDraftMcpError("limit_reached", "Layer limit reached.")
      }
      const layer = createTextLayer({
        lineSpacing: optionalNumber(input.lineSpacing),
        kerning: optionalNumber(input.kerning),
        boxWidth: input.boxWidth as number | null | undefined,
        string:
          asString(input.string) ??
          (isZh(locale) ? "在此输入文字" : "Your text here"),
        fontSize:
          optionalNumber(input.fontSize) ??
          canvas.canvasLogicalSize.width * 0.06,
        name: uniqueLayerName(
          asString(input.name) ?? (isZh(locale) ? "文字" : "Text"),
          canvas.layers.map((item) => item.name)
        ),
        fontName: asString(input.fontName),
        color: parseColor(input.color),
        weight:
          typeof input.weight === "string" &&
          FONT_WEIGHTS.has(input.weight as FontWeight)
            ? (input.weight as FontWeight)
            : undefined,
        alignment:
          typeof input.alignment === "string" &&
          TEXT_ALIGNS.has(input.alignment as TextAlign)
            ? (input.alignment as TextAlign)
            : undefined,
      })
      if (isRecord(input.transform)) {
        layer.transform = parseTransform(input.transform, layer.transform)
      }
      if (layer.content.kind === "text") {
        if (
          layer.content.boxWidth != null &&
          layer.content.boxWidth < layer.content.fontSize * 1.5
        )
          operationError(
            "invalid_input",
            "boxWidth must be at least 1.5 times fontSize. Use texts.fit to fit the text.",
            layer.id,
            "boxWidth"
          )
        for (const key of ["stroke", "shadow", "pill"] as const) {
          const value = input[key] as Record<string, unknown> | null | undefined
          if (value !== undefined)
            Object.assign(layer.content, {
              [key]:
                value === null
                  ? null
                  : { ...value, color: parseColor(value.color) },
            })
        }
        if (layer.content.fontSize * 1.25 + layer.content.lineSpacing <= 0)
          operationError(
            "invalid_input",
            "Line height must be positive.",
            layer.id,
            "lineSpacing"
          )
      }
      const project = mapCanvas(document.project, canvasId, (item) => ({
        ...item,
        layers: [...item.layers, layer],
      }))
      return finish(command, { ...document, project })
    }
    case "layers.addImage": {
      const document = requireDocument(input)
      const canvasId = resolveCanvasId(document.project, input)
      const canvas = document.project.canvases.find(
        (item) => item.id === canvasId
      )!
      if (canvas.layers.length >= MAXIMUM_LAYER_COUNT) {
        throw new PocketDraftMcpError("limit_reached", "Layer limit reached.")
      }
      const url = requireString(input, "url")
      const attached = await attachToDocument(document, url)
      const aspectRatio = Math.max(
        0.01,
        attached.width / Math.max(1, attached.height)
      )
      const layer = createImageLayer({
        assetRef: attached.ref,
        aspectRatio,
        name: uniqueLayerName(
          asString(input.name) ?? (isZh(locale) ? "图片" : "Image"),
          canvas.layers.map((item) => item.name)
        ),
        cornerRadius: optionalNumber(input.cornerRadius),
      })
      if (isRecord(input.transform)) {
        layer.transform = parseTransform(input.transform, layer.transform)
      }
      const project = mapCanvas(
        attached.document.project,
        canvasId,
        (item) => ({
          ...item,
          layers: [...item.layers, layer],
        })
      )
      return finish(command, { ...attached.document, project })
    }
    case "layers.update": {
      const document = requireDocument(input)
      const canvasId = resolveCanvasId(document.project, input)
      const layerId = requireString(input, "layerId")
      const canvas = document.project.canvases.find(
        (item) => item.id === canvasId
      )!
      const current = findLayerInCanvas(canvas, layerId)
      const patch = validateLayerPatch(current, input)
      const nextLayer: Layer = {
        ...current,
        name: asString(input.name)?.trim() || current.name,
        opacity: clamp(optionalNumber(input.opacity) ?? current.opacity, 0, 1),
        isVisible:
          typeof input.isVisible === "boolean"
            ? input.isVisible
            : current.isVisible,
        isLocked:
          typeof input.isLocked === "boolean"
            ? input.isLocked
            : current.isLocked,
        transform: parseTransform(input.transform, current.transform),
        content: current.content,
      }
      if (nextLayer.content.kind === "text") {
        const content = nextLayer.content
        nextLayer.content = {
          ...content,
          string: asString(patch.string) ?? content.string,
          fontName: asString(patch.fontName) ?? content.fontName,
          fontSize: optionalNumber(patch.fontSize) ?? content.fontSize,
          weight:
            typeof patch.weight === "string" &&
            FONT_WEIGHTS.has(patch.weight as FontWeight)
              ? (patch.weight as FontWeight)
              : content.weight,
          alignment:
            typeof patch.alignment === "string" &&
            TEXT_ALIGNS.has(patch.alignment as TextAlign)
              ? (patch.alignment as TextAlign)
              : content.alignment,
          color: parseColor(patch.color, content.color) ?? content.color,
          ...Object.fromEntries(
            ["stroke", "shadow", "pill"]
              .filter((key) => patch[key] !== undefined)
              .map((key) => {
                const value = patch[key] as Record<string, unknown> | null
                return [
                  key,
                  value === null
                    ? null
                    : { ...value, color: parseColor(value.color) },
                ]
              })
          ),
          lineSpacing: optionalNumber(patch.lineSpacing) ?? content.lineSpacing,
          kerning: optionalNumber(patch.kerning) ?? content.kerning,
          boxWidth:
            patch.boxWidth === null
              ? null
              : (optionalNumber(patch.boxWidth) ?? content.boxWidth),
        } satisfies TextContent
      } else if (nextLayer.content.kind === "device") {
        const content = nextLayer.content
        const deviceId = asString(patch.deviceId) ?? content.deviceId
        if (!getDevice(deviceId)) {
          throw new PocketDraftMcpError(
            "not_found",
            `Unknown device: ${deviceId}`
          )
        }
        const frameId =
          asString(patch.frameId) ??
          (deviceId === content.deviceId
            ? content.frameId
            : defaultFrameId(deviceId))
        if (!getFrame(deviceId, frameId))
          operationError(
            "not_found",
            `Unknown frame ${frameId} for ${deviceId}.`,
            current.id,
            "frameId"
          )
        const resolvedFrame = frameId
        nextLayer.content = {
          ...content,
          deviceId,
          wasManuallyTransformed:
            JSON.stringify(nextLayer.transform) !==
            JSON.stringify(current.transform)
              ? true
              : content.wasManuallyTransformed,
          frameId: resolvedFrame,
          orientation:
            typeof patch.orientation === "string" &&
            ORIENTATIONS.has(patch.orientation as DeviceOrientation)
              ? (patch.orientation as DeviceOrientation)
              : content.orientation,
          screenshotZoom: clamp(
            optionalNumber(patch.screenshotZoom) ?? content.screenshotZoom,
            SCREENSHOT_ZOOM_RANGE.min,
            SCREENSHOT_ZOOM_RANGE.max
          ),
          screenshotOffset: parsePoint(
            patch.screenshotOffset,
            content.screenshotOffset
          ),
          shadowIntensity: clamp(
            optionalNumber(patch.shadowIntensity) ?? content.shadowIntensity,
            0,
            1
          ),
        } satisfies DeviceContent
      } else if (nextLayer.content.kind === "image") {
        const content = nextLayer.content
        nextLayer.content = {
          ...content,
          aspectRatio: optionalNumber(patch.aspectRatio) ?? content.aspectRatio,
          cornerRadius:
            optionalNumber(patch.cornerRadius) ?? content.cornerRadius,
        } satisfies ImageContent
      }
      if (
        nextLayer.content.kind === "text" &&
        nextLayer.content.fontSize * 1.25 + nextLayer.content.lineSpacing <= 0
      )
        operationError(
          "invalid_input",
          "Line height must be positive.",
          layerId,
          "lineSpacing"
        )
      if (
        nextLayer.content.kind === "text" &&
        (patch.boxWidth !== undefined || patch.fontSize !== undefined) &&
        nextLayer.content.boxWidth != null &&
        nextLayer.content.boxWidth < nextLayer.content.fontSize * 1.5
      )
        operationError(
          "invalid_input",
          "boxWidth must be at least 1.5 times fontSize. Use texts.fit to fit the text.",
          layerId,
          "boxWidth"
        )
      let project = mapCanvas(document.project, canvasId, (item) => ({
        ...item,
        layers: item.layers.map((layer) =>
          layer.id === layerId ? nextLayer : layer
        ),
      }))
      if (
        nextLayer.content.kind === "device" &&
        ["screenshotOffset", "screenshotZoom", "orientation", "deviceId"].some(
          (key) => patch[key] !== undefined
        )
      ) {
        const evaluate = callContext()?.evaluate
        if (!evaluate)
          operationError(
            "browser_required",
            "Crop validation requires the paired browser.",
            layerId
          )
        project = await evaluate(
          { ...document, project },
          "devices.validateCrop",
          { canvasId, layerId }
        )
      }
      return finish(command, { ...document, project })
    }
    case "layers.delete": {
      const document = requireDocument(input)
      const canvasId = resolveCanvasId(document.project, input)
      const layerId = requireString(input, "layerId")
      const canvas = document.project.canvases.find(
        (item) => item.id === canvasId
      )!
      const layer = findLayerInCanvas(canvas, layerId)
      editable(layer)
      if (isBackground(layer)) {
        throw new PocketDraftMcpError(
          "invalid_input",
          "The background layer cannot be deleted."
        )
      }
      const project = mapCanvas(document.project, canvasId, (item) => ({
        ...item,
        layers: item.layers.filter((entry) => entry.id !== layerId),
      }))
      return finish(command, { ...document, project })
    }
    case "layers.reorder": {
      const document = requireDocument(input)
      const canvasId = resolveCanvasId(document.project, input)
      const layerId = requireString(input, "layerId")
      const canvas = document.project.canvases.find(
        (item) => item.id === canvasId
      )!
      const from = canvas.layers.findIndex((layer) => layer.id === layerId)
      if (from <= 0) {
        throw new PocketDraftMcpError(
          "invalid_input",
          "Background cannot be reordered, or layer was not found."
        )
      }
      editable(canvas.layers[from])
      if (input.action !== undefined && input.toIndex !== undefined)
        operationError(
          "conflicting_fields",
          "Choose action or toIndex.",
          layerId,
          "toIndex"
        )
      if (
        typeof input.toIndex === "number" &&
        input.toIndex >= canvas.layers.length
      )
        operationError(
          "invalid_input",
          "toIndex exceeds the layer list.",
          layerId,
          "toIndex"
        )
      let to = from
      const action = asString(input.action)
      if (action && REORDER_ACTIONS.has(action)) {
        if (action === "front") to = canvas.layers.length - 1
        if (action === "back") to = 1
        if (action === "forward")
          to = Math.min(canvas.layers.length - 1, from + 1)
        if (action === "backward") to = Math.max(1, from - 1)
      } else if (optionalNumber(input.toIndex) !== undefined) {
        to = Math.max(
          1,
          Math.min(canvas.layers.length - 1, optionalNumber(input.toIndex)!)
        )
      } else {
        throw new PocketDraftMcpError(
          "invalid_input",
          "action or toIndex is required."
        )
      }
      const project = mapCanvas(document.project, canvasId, (item) => {
        const layers = [...item.layers]
        const [moved] = layers.splice(from, 1)
        layers.splice(to, 0, moved)
        return { ...item, layers }
      })
      return finish(command, { ...document, project })
    }
    case "layers.setBackground": {
      const document = requireDocument(input)
      const canvasId = resolveCanvasId(document.project, input)
      const canvas = document.project.canvases.find(
        (item) => item.id === canvasId
      )!
      editable(canvas.layers[0])
      if (
        ["color", "presetId", "fill", "url"].filter(
          (key) => input[key] !== undefined
        ).length > 1
      )
        operationError(
          "conflicting_fields",
          "Choose one background source.",
          canvas.layers[0].id
        )
      const current =
        canvas.layers[0]?.content.kind === "background"
          ? canvas.layers[0].content.fill
          : undefined
      let working = document
      let fill = parseBackgroundFill(input, current)
      const url = asString(input.url)
      if (url || fill.kind === "image") {
        const source =
          url ??
          (fill.kind === "image" ? working.assets[fill.assetRef] : undefined)
        if (url) {
          const attached = await attachToDocument(working, url)
          working = attached.document
          fill = {
            kind: "image",
            assetRef: attached.ref,
            blurRadius:
              fill.kind === "image"
                ? fill.blurRadius
                : (optionalNumber(input.blurRadius) ?? 0),
            dimming:
              fill.kind === "image"
                ? fill.dimming
                : (optionalNumber(input.dimming) ?? 0),
          }
        } else if (
          fill.kind === "image" &&
          !source &&
          !callContext()?.availableAssets.has(fill.assetRef)
        ) {
          operationError(
            "missing_asset",
            `Background image ${fill.assetRef} is unavailable.`,
            fill.assetRef,
            "fill.assetRef"
          )
        }
      }
      if (fill.kind === "image")
        fill = {
          ...fill,
          blurRadius: optionalNumber(input.blurRadius) ?? fill.blurRadius,
          dimming: optionalNumber(input.dimming) ?? fill.dimming,
        }
      else if (input.blurRadius !== undefined || input.dimming !== undefined)
        operationError(
          "unsupported_property",
          "Blur and dimming require an image background.",
          canvas.layers[0].id
        )
      const project = mapCanvas(working.project, canvasId, (item) => {
        const background = item.layers[0]
        if (!background || background.content.kind !== "background") return item
        return {
          ...item,
          layers: [
            { ...background, content: { ...background.content, fill } },
            ...item.layers.slice(1),
          ],
        }
      })
      return finish(command, { ...working, project }, warnings)
    }
    case "layers.setDevicePadding": {
      const document = requireDocument(input)
      const canvasId = resolveCanvasId(document.project, input)
      const value = clamp(optionalNumber(input.value) ?? 0.08, 0, 0.5)
      editable(
        document.project.canvases.find((c) => c.id === canvasId)!.layers[0]
      )
      document.project.canvases
        .find((c) => c.id === canvasId)!
        .layers.filter(isDevice)
        .forEach(editable)
      const project = mapCanvas(document.project, canvasId, (item) => {
        const background = item.layers[0]
        if (!background || background.content.kind !== "background") return item
        return {
          ...item,
          layers: [
            {
              ...background,
              content: { ...background.content, devicePadding: value },
            },
            ...item.layers.slice(1),
          ],
        }
      })
      return finish(command, { ...document, project })
    }
    case "assets.attach": {
      const document = requireDocument(input)
      const canvasId = resolveCanvasId(document.project, input)
      const url = requireString(input, "url")
      const target = asString(input.target) ?? "screenshot"
      if (target !== "screenshot" && input.cropPolicy !== undefined)
        operationError(
          "unsupported_property",
          "cropPolicy applies only to screenshots.",
          asString(input.layerId),
          "cropPolicy"
        )
      const canvas = document.project.canvases.find(
        (item) => item.id === canvasId
      )!
      editable(
        uniqueTarget(
          canvas.layers,
          target === "screenshot"
            ? "device"
            : (target as "image" | "background"),
          asString(input.layerId)
        )
      )
      const attached = await attachToDocument(document, url)
      if (target === "background") {
        const project = mapCanvas(
          attached.document.project,
          canvasId,
          (item) => {
            const background = item.layers[0]
            if (!background || background.content.kind !== "background")
              return item
            editable(background)
            const current = background.content.fill
            return {
              ...item,
              layers: [
                {
                  ...background,
                  content: {
                    ...background.content,
                    fill: {
                      kind: "image",
                      assetRef: attached.ref,
                      blurRadius:
                        current.kind === "image" ? current.blurRadius : 0,
                      dimming: current.kind === "image" ? current.dimming : 0,
                    },
                  },
                },
                ...item.layers.slice(1),
              ],
            }
          }
        )
        return finish(command, { ...attached.document, project })
      }
      if (target === "image") {
        const layerId = asString(input.layerId)
        const layer = uniqueTarget(canvas.layers, "image", layerId)
        editable(layer)
        const aspectRatio = Math.max(
          0.01,
          attached.width / Math.max(1, attached.height)
        )
        const project = mapCanvas(
          attached.document.project,
          canvasId,
          (item) => ({
            ...item,
            layers: item.layers.map((entry) =>
              entry.id === layer.id && entry.content.kind === "image"
                ? {
                    ...entry,
                    content: {
                      ...entry.content,
                      assetRef: attached.ref,
                      aspectRatio,
                    },
                  }
                : entry
            ),
          })
        )
        return finish(command, { ...attached.document, project })
      }
      const layerId = asString(input.layerId)
      const layer = uniqueTarget(canvas.layers, "device", layerId)
      editable(layer)
      const deviceLayerId = layer.id
      const project = mapCanvas(
        attached.document.project,
        canvasId,
        (item) => ({
          ...item,
          layers: item.layers.map((entry) =>
            entry.id === deviceLayerId && entry.content.kind === "device"
              ? {
                  ...entry,
                  content: {
                    ...entry.content,
                    screenshotRef: attached.ref,
                    ...(input.cropPolicy === "preserve"
                      ? {}
                      : {
                          screenshotZoom: 1,
                          screenshotOffset: { x: 0, y: 0 },
                        }),
                  },
                }
              : entry
          ),
        })
      )
      if (input.cropPolicy === "preserve") {
        const evaluate = callContext()?.evaluate
        if (!evaluate)
          operationError(
            "browser_required",
            "Preserving crop requires browser validation.",
            layer.id
          )
        return finish(command, {
          ...attached.document,
          project: await evaluate(
            { ...attached.document, project },
            "devices.validateCrop",
            { canvasId, layerId: layer.id }
          ),
        })
      }
      return finish(command, { ...attached.document, project })
    }
  }
  return operationError(
    "unsupported_command",
    `Unsupported command ${command}.`
  )
}

export async function previewMutation(
  commandValue: unknown,
  inputValue: unknown
): Promise<MutationResult> {
  const command = parseCommand(commandValue)
  if (!isRecord(inputValue)) {
    throw new PocketDraftMcpError("invalid_input", "input must be an object.")
  }
  if (
    inputValue.schemaVersion !== undefined &&
    inputValue.schemaVersion !== 1
  ) {
    throw new PocketDraftMcpError(
      "invalid_input",
      "input.schemaVersion must be 1."
    )
  }
  const input = validate(COMMAND_SCHEMAS[command], inputValue)
  return withCallContext(() => runCommand(command, input), {
    assetMode: input.assetMode === "reference" ? "reference" : "inline",
  })
}

export async function batchMutation(input: {
  document?: Record<string, unknown>
  commands: BatchStep[]
  assetMode?: "inline" | "reference"
}): Promise<MutationResult> {
  if (!input.commands.length || input.commands.length > 50)
    throw new PocketDraftMcpError(
      "invalid_input",
      "Batch requires 1–50 commands."
    )
  return withCallContext(
    async () => {
      let document = input.document
      let result: MutationResult | undefined
      const warnings: string[] = []
      const references = new Map<string, BatchReference>()
      const steps: NonNullable<MutationResult["steps"]> = []
      for (const [index, step] of input.commands.entries()) {
        try {
          callContext()?.signal.throwIfAborted()
          if (
            ["document", "project", "assets", "assetMode"].some(
              (k) => k in step.input
            )
          )
            throw new PocketDraftMcpError(
              "invalid_input",
              "Batch steps cannot override the working document or asset mode."
            )
          if (
            index > 0 &&
            ["projects.create", "projects.import"].includes(step.command)
          )
            throw new PocketDraftMcpError(
              "invalid_input",
              "Create/import must be the first step."
            )
          if (
            document &&
            ["projects.create", "projects.import"].includes(step.command)
          )
            throw new PocketDraftMcpError(
              "invalid_input",
              "Create/import cannot replace an initial document."
            )
          if (step.as && references.has(step.as))
            operationError(
              "invalid_reference",
              `Duplicate batch alias ${step.as}.`,
              undefined,
              "as"
            )
          const before = document ? parseDocument(document).project : undefined
          const resolvedInput = resolveBatchInput(step.input, references)
          result = await previewMutation(step.command, {
            ...resolvedInput,
            ...(document ? { document } : {}),
          })
          const delta = projectChanges(before, result.document.project)
          if (step.as) {
            if (
              ["canvases.add", "canvases.duplicate"].includes(step.command) &&
              delta.created.canvases.length === 1
            ) {
              const id = delta.created.canvases[0]
              references.set(step.as, { kind: "canvas", id, canvasId: id })
            } else if (
              [
                "layers.addDevice",
                "layers.addText",
                "layers.addImage",
                "layers.duplicate",
              ].includes(step.command) &&
              delta.created.layers.length === 1
            ) {
              const created = delta.created.layers[0]
              references.set(step.as, {
                kind: "layer",
                id: created.layerId,
                canvasId: created.canvasId,
              })
            } else
              operationError(
                "invalid_reference",
                "as is supported only for a command creating one layer or canvas.",
                undefined,
                "as"
              )
          }
          steps.push({
            ...delta,
            command: step.command,
            index,
            ...(step.as ? { as: step.as } : {}),
            ...(result.copyMap ? { copyMap: result.copyMap } : {}),
          })
          document = result.document as unknown as Record<string, unknown>
          warnings.push(...result.warnings)
        } catch (error) {
          const data = errorData(error)
          const failure = new PocketDraftMcpError(
            data.code,
            data.message,
            data.details,
            index
          )
          failure.candidates = data.candidates
          failure.objectId =
            data.objectId ??
            (typeof step.input.layerId === "string"
              ? step.input.layerId
              : undefined)
          failure.hint =
            data.hint ??
            "Correct this command and retry the complete batch against a fresh revision."
          throw failure
        }
      }
      return { ...result!, warnings, steps }
    },
    { assetMode: input.assetMode ?? "reference" }
  )
}
