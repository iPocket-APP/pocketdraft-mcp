export type Point = { x: number; y: number }
export type Size = { width: number; height: number }
export type Rect = { x: number; y: number; width: number; height: number }
export type Color = { r: number; g: number; b: number; a: number }

export type LayerTransform = {
  center: Point
  scale: number
  rotation: number
}

export type CanvasAspect =
  | "square"
  | "portrait45"
  | "portrait34"
  | "portrait23"
  | "story916"
  | "landscape43"
  | "landscape32"
  | "landscape169"
  | "appStore69"
  | "appStore65"
  | "macAppStore"
  | "custom"

export type DeviceOrientation = "portrait" | "landscape"
export type FontWeight = "regular" | "medium" | "semibold" | "bold"
export type TextAlign = "leading" | "center" | "trailing"

export type GradientStop = { color: Color; location: number }

export type BackgroundFill =
  | { kind: "solid"; color: Color }
  | { kind: "linearGradient"; stops: GradientStop[]; angle: number }
  | { kind: "radialGradient"; stops: GradientStop[] }
  | { kind: "image"; assetRef: string; blurRadius: number; dimming: number }

export type BackgroundContent = {
  kind: "background"
  fill: BackgroundFill
  devicePadding: number
}

export type DeviceContent = {
  kind: "device"
  deviceId: string
  frameId: string
  orientation: DeviceOrientation
  screenshotRef: string | null
  screenshotZoom: number
  screenshotOffset: Point
  shadowIntensity: number
  wasManuallyTransformed: boolean
}

export type TextStroke = {
  color: Color
  width: number
}

export type TextShadow = {
  color: Color
  radius: number
  offsetX: number
  offsetY: number
}

export type TextPill = {
  color: Color
  paddingX: number
  paddingY: number
  cornerRadius: number
}

export type TextContent = {
  kind: "text"
  string: string
  fontName: string
  fontSize: number
  weight: FontWeight
  color: Color
  alignment: TextAlign
  lineSpacing: number
  kerning: number
  stroke?: TextStroke | null
  shadow?: TextShadow | null
  pill?: TextPill | null
  boxWidth?: number | null
}

export type ImageContent = {
  kind: "image"
  assetRef: string
  aspectRatio: number
  cornerRadius: number
}

export type LayerContent =
  | BackgroundContent
  | DeviceContent
  | TextContent
  | ImageContent

export type Layer = {
  id: string
  name: string
  transform: LayerTransform
  opacity: number
  isVisible: boolean
  isLocked: boolean
  content: LayerContent
}

export type ProjectCanvas = {
  id: string
  name: string
  canvasAspect: CanvasAspect
  canvasLogicalSize: Size
  layers: Layer[]
}

export type Project = {
  id: string
  name: string
  schemaVersion: 2
  canvases: ProjectCanvas[]
  activeCanvasId: string
  // Backward compatibility convenience fields mirroring the active canvas
  canvasAspect: CanvasAspect
  canvasLogicalSize: Size
  layers: Layer[]
}

export const MAXIMUM_LAYER_COUNT = 50
export const MAXIMUM_DEVICE_COPIES = 4
export const MAXIMUM_CANVAS_COUNT = 10
export const SCALE_RANGE = { min: 0.1, max: 8 }
export const SCREENSHOT_ZOOM_RANGE = { min: 1, max: 3 }
export const CANVAS_DIMENSION_RANGE = { min: 64, max: 4096 }
export const MAX_EXPORT_EDGE = 8192
export const MAX_EXPORT_PIXELS = 8192 * 8192
export const PREVIEW_IMAGE_MAX_EDGE = 2048

export const CANVAS_ASPECT_SIZES: Record<Exclude<CanvasAspect, "custom">, Size> =
  {
    square: { width: 1080, height: 1080 },
    portrait45: { width: 1080, height: 1350 },
    portrait34: { width: 1080, height: 1440 },
    portrait23: { width: 1080, height: 1620 },
    story916: { width: 1080, height: 1920 },
    landscape43: { width: 1440, height: 1080 },
    landscape32: { width: 1620, height: 1080 },
    landscape169: { width: 1920, height: 1080 },
    appStore69: { width: 1320, height: 2868 },
    appStore65: { width: 1284, height: 2778 },
    macAppStore: { width: 2880, height: 1800 },
  }

export const CANVAS_ASPECT_LABELS: Record<CanvasAspect, string> = {
  square: "1:1",
  portrait45: "4:5",
  portrait34: "3:4",
  portrait23: "2:3",
  story916: "9:16",
  landscape43: "4:3",
  landscape32: "3:2",
  landscape169: "16:9",
  appStore69: "6.9″",
  appStore65: "6.5″",
  macAppStore: "Mac (16:10)",
  custom: "Custom",
}

export function createId(): string {
  return crypto.randomUUID()
}

export function cloneProject(project: Project): Project {
  return structuredClone(project)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function colorFromHex(hex: string): Color {
  const value = hex.replace("#", "").trim()
  const n = Number.parseInt(value, 16)
  if (value.length === 8) {
    return {
      r: ((n >> 24) & 255) / 255,
      g: ((n >> 16) & 255) / 255,
      b: ((n >> 8) & 255) / 255,
      a: (n & 255) / 255,
    }
  }
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
    a: 1,
  }
}

export function colorToCss(color: Color): string {
  const r = Math.round(clamp(color.r, 0, 1) * 255)
  const g = Math.round(clamp(color.g, 0, 1) * 255)
  const b = Math.round(clamp(color.b, 0, 1) * 255)
  const a = clamp(color.a, 0, 1)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

export function colorToHex(color: Color): string {
  const hex = [color.r, color.g, color.b]
    .map((channel) =>
      Math.round(clamp(channel, 0, 1) * 255)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")
  return `#${hex}`
}

export const COLOR_WHITE: Color = { r: 1, g: 1, b: 1, a: 1 }
export const COLOR_BLACK: Color = { r: 0, g: 0, b: 0, a: 1 }
export const COLOR_GRAPHITE: Color = colorFromHex("#17181C")

export function identityTransform(): LayerTransform {
  return { center: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0 }
}

export function createBackgroundLayer(fill?: BackgroundFill): Layer {
  return {
    id: createId(),
    name: "Background",
    transform: identityTransform(),
    opacity: 1,
    isVisible: true,
    isLocked: false,
    content: {
      kind: "background",
      fill: fill ?? { kind: "solid", color: COLOR_WHITE },
      devicePadding: 0.08,
    },
  }
}

export function createBlankCanvas(
  aspect: CanvasAspect = "portrait45",
  name = "Canvas 1",
  sizeOverride?: Size
): ProjectCanvas {
  const size =
    sizeOverride ??
    (aspect === "custom"
      ? CANVAS_ASPECT_SIZES.portrait45
      : CANVAS_ASPECT_SIZES[aspect])
  return {
    id: createId(),
    name,
    canvasAspect: aspect,
    canvasLogicalSize: { ...size },
    layers: [createBackgroundLayer()],
  }
}

export function createBlankProject(aspect: CanvasAspect = "portrait45"): Project {
  const canvas = createBlankCanvas(aspect, "Canvas 1")
  return {
    id: createId(),
    name: "",
    schemaVersion: 2,
    canvases: [canvas],
    activeCanvasId: canvas.id,
    canvasAspect: canvas.canvasAspect,
    canvasLogicalSize: { ...canvas.canvasLogicalSize },
    layers: canvas.layers,
  }
}

export function syncActiveCanvasToProject(project: Project): Project {
  const canvas =
    project.canvases.find((c) => c.id === project.activeCanvasId) ||
    project.canvases[0]
  if (!canvas) return project
  return {
    ...project,
    activeCanvasId: canvas.id,
    canvasAspect: canvas.canvasAspect,
    canvasLogicalSize: canvas.canvasLogicalSize,
    layers: canvas.layers,
  }
}

export function createDeviceLayer(input: {
  deviceId: string
  frameId: string
  orientation?: DeviceOrientation
  name: string
}): Layer {
  return {
    id: createId(),
    name: input.name,
    transform: identityTransform(),
    opacity: 1,
    isVisible: true,
    isLocked: false,
    content: {
      kind: "device",
      deviceId: input.deviceId,
      frameId: input.frameId,
      orientation: input.orientation ?? "portrait",
      screenshotRef: null,
      screenshotZoom: 1,
      screenshotOffset: { x: 0, y: 0 },
      shadowIntensity: 0.35,
      wasManuallyTransformed: false,
    },
  }
}

export function createTextLayer(input: {
  string: string
  fontSize: number
  name: string
  color?: Color
  weight?: FontWeight
  fontName?: string
  alignment?: TextAlign
  kerning?: number
  lineSpacing?: number
  boxWidth?: number | null
}): Layer {
  return {
    id: createId(),
    name: input.name,
    transform: { center: { x: 0.5, y: 0.14 }, scale: 1, rotation: 0 },
    opacity: 1,
    isVisible: true,
    isLocked: false,
    content: {
      kind: "text",
      string: input.string,
      fontName: input.fontName ?? "geist",
      fontSize: Math.max(8, input.fontSize),
      weight: input.weight ?? "semibold",
      color: input.color ?? COLOR_GRAPHITE,
      alignment: input.alignment ?? "center",
      lineSpacing: input.lineSpacing ?? 0,
      kerning: input.kerning ?? 0,
      stroke: null,
      shadow: null,
      pill: null,
      boxWidth: input.boxWidth ?? null,
    },
  }
}

export function createImageLayer(input: {
  assetRef: string
  aspectRatio: number
  name?: string
  cornerRadius?: number
}): Layer {
  return {
    id: createId(),
    name: input.name ?? "Image",
    transform: { center: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0 },
    opacity: 1,
    isVisible: true,
    isLocked: false,
    content: {
      kind: "image",
      assetRef: input.assetRef,
      aspectRatio: input.aspectRatio,
      cornerRadius: input.cornerRadius ?? 0,
    },
  }
}

/**
 * 把一个缩放因子折算进文字内容的所有像素属性（字号、行距、字距、
 * 描边、阴影、胶囊内边距、文本框宽度），配合 transform.scale 归一，
 * 保证视觉不变的同时让面板字号数值与所见一致。
 */
export function scaleTextContent(
  content: TextContent,
  factor: number
): TextContent {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return content
  return {
    ...content,
    fontSize: content.fontSize * factor,
    lineSpacing: content.lineSpacing * factor,
    kerning: content.kerning * factor,
    boxWidth: content.boxWidth ? content.boxWidth * factor : content.boxWidth,
    stroke: content.stroke
      ? { ...content.stroke, width: content.stroke.width * factor }
      : content.stroke,
    shadow: content.shadow
      ? {
          ...content.shadow,
          radius: content.shadow.radius * factor,
          offsetX: content.shadow.offsetX * factor,
          offsetY: content.shadow.offsetY * factor,
        }
      : content.shadow,
    pill: content.pill
      ? {
          ...content.pill,
          paddingX: content.pill.paddingX * factor,
          paddingY: content.pill.paddingY * factor,
          cornerRadius: content.pill.cornerRadius * factor,
        }
      : content.pill,
  }
}

export function isBackground(layer: Layer): boolean {
  return layer.content.kind === "background"
}

export function isDevice(layer: Layer): boolean {
  return layer.content.kind === "device"
}

export function isText(layer: Layer): boolean {
  return layer.content.kind === "text"
}

export function isImage(layer: Layer): boolean {
  return layer.content.kind === "image"
}

export function backgroundLayer(project: Project | ProjectCanvas): Layer | undefined {
  return project.layers[0]
}

export function backgroundContent(
  project: Project | ProjectCanvas
): BackgroundContent | null {
  const layer = project.layers[0]
  return layer?.content.kind === "background" ? layer.content : null
}

export function deviceLayerCount(project: Project | ProjectCanvas): number {
  return project.layers.filter(isDevice).length
}

export function findLayer(
  project: Project | ProjectCanvas,
  id: string | null
): Layer | undefined {
  if (!id) return undefined
  return project.layers.find((layer) => layer.id === id)
}

export function activeCanvasOf(project: Project): ProjectCanvas {
  return (
    project.canvases.find((c) => c.id === project.activeCanvasId) ||
    project.canvases[0] ||
    createBlankCanvas()
  )
}

/** 一组图层引用到的资源 ref（背景图 / 设备截图 / 图片） */
export function layerAssetRefs(layers: Iterable<Layer>): Set<string> {
  const refs = new Set<string>()
  for (const layer of layers) {
    const content = layer.content
    if (content.kind === "background" && content.fill.kind === "image") {
      refs.add(content.fill.assetRef)
    }
    if (content.kind === "device" && content.screenshotRef) {
      refs.add(content.screenshotRef)
    }
    if (content.kind === "image") {
      refs.add(content.assetRef)
    }
  }
  return refs
}

export function referencedAssets(project: Project): Set<string> {
  const refs = new Set<string>()
  for (const canvas of project.canvases) {
    for (const ref of layerAssetRefs(canvas.layers)) refs.add(ref)
  }
  return refs
}

export function uniqueLayerName(
  proposed: string,
  existing: Iterable<string>
): string {
  const names = new Set(
    [...existing].map((name) => name.trim().toLowerCase())
  )
  const base = proposed.trim() || "Layer"
  if (!names.has(base.toLowerCase())) return base
  let index = 2
  while (names.has(`${base} ${index}`.toLowerCase())) index += 1
  return `${base} ${index}`
}

export function mapLayer(
  project: Project,
  id: string,
  mapper: (layer: Layer) => Layer
): Project {
  const nextCanvases = project.canvases.map((canvas) => {
    if (canvas.id !== project.activeCanvasId) return canvas
    return {
      ...canvas,
      layers: canvas.layers.map((layer) =>
        layer.id === id ? mapper(layer) : layer
      ),
    }
  })
  const activeCanvas = nextCanvases.find((c) => c.id === project.activeCanvasId)!
  return {
    ...project,
    canvases: nextCanvases,
    layers: activeCanvas.layers,
  }
}

export function replaceLayerContent(
  layer: Layer,
  content: LayerContent
): Layer {
  return { ...layer, content }
}
