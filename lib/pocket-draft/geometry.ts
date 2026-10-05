import { canvasFont } from "@/lib/pocket-draft/fonts"
import { geometryFor } from "@/lib/pocket-draft/catalog"
import {
  backgroundContent,
  clamp,
  type Layer,
  type Point,
  type Project,
  type ProjectCanvas,
  type Rect,
  type Size,
  type TextContent,
} from "@/lib/pocket-draft/models"

export { clamp }

export const CANVAS_ASPECT_RANGE = { min: 0.25, max: 4 }

let measureContext: CanvasRenderingContext2D | null = null

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null
  if (!measureContext) {
    const canvas = document.createElement("canvas")
    measureContext = canvas.getContext("2d")
  }
  return measureContext
}

export function fittedCanvas(
  logical: Size,
  container: Size,
  margin = 24
): Rect {
  const available = {
    width: Math.max(1, container.width - margin * 2),
    height: Math.max(1, container.height - margin * 2),
  }
  const scale = Math.min(
    available.width / logical.width,
    available.height / logical.height
  )
  const width = logical.width * scale
  const height = logical.height * scale
  return {
    x: (container.width - width) / 2,
    y: (container.height - height) / 2,
    width,
    height,
  }
}

export function viewPoint(normalized: Point, canvasSize: Size): Point {
  return { x: normalized.x * canvasSize.width, y: normalized.y * canvasSize.height }
}

export function normalizedPoint(point: Point, canvasSize: Size): Point {
  return {
    x: canvasSize.width === 0 ? 0 : point.x / canvasSize.width,
    y: canvasSize.height === 0 ? 0 : point.y / canvasSize.height,
  }
}

export function devicePaddingOf(target: Project | ProjectCanvas): number {
  return backgroundContent(target)?.devicePadding ?? 0.08
}

export type WrappedLine = { text: string; start: number }

/**
 * 折行判断用的行宽。
 *
 * CSS 的 `white-space: pre-wrap` 会把行尾空白「悬挂」在行盒之外——它既不
 * 触发折行，也不计入内容宽度。canvas 的 measureText 则会把这些空白算进去。
 * 编辑态是 DOM 排版、非编辑态是 canvas 排版，若这里不对齐，行尾带空格的
 * 文字就会出现「编辑时一行、退出后两行」。
 */
function lineWidth(ctx: CanvasRenderingContext2D, text: string): number {
  return ctx.measureText(text.replace(/[ \t]+$/, "")).width
}

/**
 * CJK / 假名 / 谚文 / 全角字符：这些字之间到处都是可断点，
 * 不像拉丁文只能在空格处断。
 */
const CJK_PATTERN =
  /[⺀-〿぀-ヿ㄀-ㄯ㄰-㆏ㆠ-ㆿㇰ-ㇿ㐀-䶿一-鿿ꀀ-꓏가-힯豈-﫿︰-﹏＀-｠￠-￦]/

/** 行首禁则：这些标点不能出现在行首，必须跟着上一个字 */
const NO_BREAK_BEFORE = "、。，．：；？！）〕］｝〉》」』】〞’”·…‥"
/** 行尾禁则：这些标点不能出现在行尾，必须跟着下一个字 */
const NO_BREAK_AFTER = "（〔［｛〈《「『【〝‘“"

function isCjk(char: string): boolean {
  return CJK_PATTERN.test(char)
}

/** 两个相邻字符之间是否允许断行（近似 CSS 的 line-break 行为） */
function canBreakBetween(before: string, after: string): boolean {
  if (!before) return false
  // 空白始终跟着前一个字（CSS 的 pre-wrap 把行尾空白悬挂在行盒外），
  // 连续空白也整体留在行尾，不会有一个孤立空格跑到行首
  if (/\s/.test(after)) return false
  if (/\s/.test(before)) return true
  if (NO_BREAK_BEFORE.includes(after)) return false
  if (NO_BREAK_AFTER.includes(before)) return false
  // CJK 与任意字符之间都可断（含中英混排的边界）
  if (isCjk(before) || isCjk(after)) return true
  // 拉丁单词内部不可断
  return false
}

/**
 * 把一段文字切成「可断单元」：单元之间允许换行，单元内部不允许。
 *
 * 之前这里是按 /(\s+)/ 切词，于是一整串没有空格的中文会被当成**一个**
 * 不可断的「词」。它放不下时，代码会先把当前行提前吐出去（于是出现
 * 「把一张 App」独占一行、「—」独占一行），再退到逐字硬折，还会把
 * 「，」甩到行首——这正是画布与编辑态 textarea 折行不一致的根因。
 */
export function breakUnits(text: string): WrappedLine[] {
  const units: WrappedLine[] = []
  let previous = ""
  let index = 0
  for (const char of text) {
    if (units.length === 0 || canBreakBetween(previous, char)) {
      units.push({ text: char, start: index })
    } else {
      units[units.length - 1].text += char
    }
    previous = char
    index += char.length
  }
  return units
}

export function minTextBoxWidth(content: TextContent): number {
  return Math.max(8, content.fontSize) * 1.5
}

export function textLayout(
  content: TextContent,
  canvasLogicalSize: Size
): { width: number; height: number; lines: WrappedLine[]; lineHeight: number } {
  const fontSize = Math.max(8, content.fontSize)
  const minWidth = minTextBoxWidth(content)
  const defaultMax = canvasLogicalSize.width * 0.95
  const maxWidth = content.boxWidth
    ? Math.max(minWidth, content.boxWidth)
    : defaultMax
  const lines = wrapLines(content, maxWidth)
  const lineHeight = fontSize * 1.25 + content.lineSpacing
  const measuredWidth = measureLongestLine(content, lines)
  const width = content.boxWidth
    ? Math.max(minWidth, content.boxWidth)
    : Math.min(maxWidth, Math.max(minWidth, Math.ceil(measuredWidth) + 2))
  const height = Math.max(
    lineHeight,
    lines.length * lineHeight
  )
  return { width, height, lines, lineHeight }
}

function wrapLines(content: TextContent, maxWidth: number): WrappedLine[] {
  const raw = content.string.length === 0 ? " " : content.string
  const paragraphs = raw.split("\n")
  const ctx = getMeasureContext()
  const result: WrappedLine[] = []
  let offset = 0
  if (!ctx) {
    for (const paragraph of paragraphs) {
      result.push({ text: paragraph.length === 0 ? " " : paragraph, start: offset })
      offset += paragraph.length + 1
    }
    return result
  }
  ctx.font = canvasFont(content.fontName, content.fontSize, content.weight)
  ctx.letterSpacing = `${content.kerning}px`
  for (const paragraph of paragraphs) {
    const paragraphStart = offset
    offset += paragraph.length + 1
    if (paragraph.length === 0) {
      result.push({ text: " ", start: paragraphStart })
      continue
    }
    // 如果段落未超过 maxWidth，直接保留为单行
    const totalWidth = lineWidth(ctx, paragraph)
    if (totalWidth <= maxWidth) {
      result.push({ text: paragraph, start: paragraphStart })
      continue
    }
    let current = ""
    let currentStart = paragraphStart
    for (const unit of breakUnits(paragraph)) {
      const unitStart = paragraphStart + unit.start
      if (current.length === 0) {
        // 单个单元自己就超宽（例如一串很长的英文），只能逐字硬折
        if (lineWidth(ctx, unit.text) > maxWidth) {
          const broken = breakGraphemes(ctx, unit.text, maxWidth, unitStart)
          // 末行留下继续与后续单元拼接，避免每个超长词都强制独占整行
          const tail = broken.pop()
          result.push(...broken)
          current = tail?.text ?? ""
          currentStart = tail ? tail.start : unitStart
          continue
        }
        current = unit.text
        currentStart = unitStart
        continue
      }
      const next = current + unit.text
      if (lineWidth(ctx, next) > maxWidth) {
        result.push({ text: current, start: currentStart })
        current = unit.text
        currentStart = unitStart
      } else {
        current = next
      }
    }
    if (current.length > 0) result.push({ text: current, start: currentStart })
  }
  return result.length > 0 ? result : [{ text: " ", start: 0 }]
}

function breakGraphemes(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startOffset: number
): WrappedLine[] {
  const lines: WrappedLine[] = []
  let current = ""
  let currentStart = startOffset
  let consumed = 0
  for (const char of text) {
    const next = current + char
    if (current && lineWidth(ctx, next) > maxWidth) {
      lines.push({ text: current, start: currentStart })
      current = char
      currentStart = startOffset + consumed
    } else {
      current = next
    }
    consumed += char.length
  }
  if (current) lines.push({ text: current, start: currentStart })
  return lines
}

export function measureLongestLine(content: TextContent, lines: WrappedLine[]): number {
  const ctx = getMeasureContext()
  if (!ctx) return content.fontSize * 8
  ctx.font = canvasFont(content.fontName, content.fontSize, content.weight)
  ctx.letterSpacing = `${content.kerning}px`
  return Math.max(...lines.map((line) => lineWidth(ctx, line.text)), 1)
}

/**
 * 将画布显示坐标下的点换算为文字图层内部（逻辑单位、含胶囊内边距、
 * 已抵消旋转与缩放）的局部坐标，原点为图层框左上角。
 */
export function textLocalPoint(
  point: Point,
  layer: Layer,
  target: Project | ProjectCanvas,
  canvasSize: Size
): Point {
  const frame = displayedFrame(layer, target, canvasSize)
  const cx = frame.x + frame.width / 2
  const cy = frame.y + frame.height / 2
  const angle = -layer.transform.rotation
  const dx = point.x - cx
  const dy = point.y - cy
  const localX = dx * Math.cos(angle) - dy * Math.sin(angle) + frame.width / 2
  const localY = dx * Math.sin(angle) + dy * Math.cos(angle) + frame.height / 2
  const logical = target.canvasLogicalSize
  const unit = Math.min(
    canvasSize.width / Math.max(logical.width, 1),
    canvasSize.height / Math.max(logical.height, 1)
  )
  const factor = Math.max(layer.transform.scale * unit, 1e-6)
  return { x: localX / factor, y: localY / factor }
}

/**
 * 用与画布渲染完全相同的换行与测量，把图层局部坐标映射为字符串中的
 * 光标索引，实现「点哪里光标落哪里」。
 */
export function caretIndexAtPoint(
  content: TextContent,
  canvasLogicalSize: Size,
  local: Point
): number {
  const layout = textLayout(content, canvasLogicalSize)
  const ctx = getMeasureContext()
  if (!ctx) return content.string.length
  ctx.font = canvasFont(content.fontName, Math.max(8, content.fontSize), content.weight)
  ctx.letterSpacing = `${content.kerning}px`
  const x = local.x - (content.pill?.paddingX ?? 0)
  const y = local.y - (content.pill?.paddingY ?? 0)
  const row = clamp(
    Math.floor(y / Math.max(layout.lineHeight, 1)),
    0,
    layout.lines.length - 1
  )
  const line = layout.lines[row]
  // 空段落被合成为单个空格占位，该空格并不存在于原始字符串中
  const sourceLength = Math.max(
    0,
    Math.min(line.text.length, content.string.length - line.start)
  )
  const lineWidth = ctx.measureText(line.text).width
  const lineX0 =
    content.alignment === "leading"
      ? 0
      : content.alignment === "trailing"
        ? layout.width - lineWidth
        : (layout.width - lineWidth) / 2
  const target = x - lineX0
  if (target <= 0) return line.start
  if (target >= lineWidth) return line.start + sourceLength
  let prevWidth = 0
  let consumed = 0
  for (const char of line.text) {
    const nextConsumed = consumed + char.length
    const width = ctx.measureText(line.text.slice(0, nextConsumed)).width
    if (target <= (prevWidth + width) / 2) {
      return line.start + Math.min(consumed, sourceLength)
    }
    prevWidth = width
    consumed = nextConsumed
  }
  return line.start + Math.min(consumed, sourceLength)
}

export function baseSize(layer: Layer, target: Project | ProjectCanvas): Size {
  const canvas = target.canvasLogicalSize
  const padding = devicePaddingOf(target)
  switch (layer.content.kind) {
    case "background":
      return canvas
    case "device": {
      const ratio = geometryFor(
        layer.content.deviceId,
        layer.content.orientation
      ).imageAspectRatio
      if (layer.content.orientation === "landscape") {
        const maxWidth = canvas.width * Math.max(0.45, 0.88 - padding * 1.5)
        const maxHeight = canvas.height * Math.max(0.35, 0.65 - padding * 1.5)
        let width = maxWidth
        let height = width / Math.max(0.01, ratio)
        if (height > maxHeight) {
          height = maxHeight
          width = height * ratio
        }
        return { width, height }
      } else {
        const height = canvas.height * Math.max(0.45, 0.82 - padding * 1.5)
        return { width: height * ratio, height }
      }
    }
    case "text": {
      const layout = textLayout(layer.content, canvas)
      let width = layout.width
      let height = layout.height
      if (layer.content.pill) {
        width += (layer.content.pill.paddingX ?? 24) * 2
        height += (layer.content.pill.paddingY ?? 12) * 2
      }
      return { width, height }
    }
    case "image": {
      const width = canvas.width * 0.5
      return { width, height: width / Math.max(0.01, layer.content.aspectRatio) }
    }
  }
}

export function displayedFrame(
  layer: Layer,
  target: Project | ProjectCanvas,
  canvasSize: Size
): Rect {
  const logical = target.canvasLogicalSize
  const base = baseSize(layer, target)
  const unit = Math.min(
    canvasSize.width / logical.width,
    canvasSize.height / logical.height
  )
  const width = base.width * layer.transform.scale * unit
  const height = base.height * layer.transform.scale * unit
  const center = viewPoint(layer.transform.center, canvasSize)
  return {
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
  }
}

export function rotatedBoundingBox(frame: Rect, radians: number): Rect {
  const sinValue = Math.abs(Math.sin(radians))
  const cosValue = Math.abs(Math.cos(radians))
  const width = frame.width * cosValue + frame.height * sinValue
  const height = frame.width * sinValue + frame.height * cosValue
  return {
    x: frame.x + frame.width / 2 - width / 2,
    y: frame.y + frame.height / 2 - height / 2,
    width,
    height,
  }
}

export function hitTestLayer(
  point: Point,
  layer: Layer,
  target: Project | ProjectCanvas,
  canvasSize: Size,
  expansion = 0
): boolean {
  if (!layer.isVisible || layer.content.kind === "background") return false
  const extra = layer.content.kind === "text" ? expansion + 8 : expansion
  const frame = displayedFrame(layer, target, canvasSize)
  const padded = {
    x: frame.x - extra,
    y: frame.y - extra,
    width: frame.width + extra * 2,
    height: frame.height + extra * 2,
  }
  const center = {
    x: padded.x + padded.width / 2,
    y: padded.y + padded.height / 2,
  }
  const dx = point.x - center.x
  const dy = point.y - center.y
  const angle = -layer.transform.rotation
  const localX = dx * Math.cos(angle) - dy * Math.sin(angle)
  const localY = dx * Math.sin(angle) + dy * Math.cos(angle)
  return Math.abs(localX) <= padded.width / 2 && Math.abs(localY) <= padded.height / 2
}

export function hitTestTopDown(
  point: Point,
  target: Project | ProjectCanvas,
  canvasSize: Size,
  skip?: string | readonly string[] | null
): Layer | undefined {
  const skipped =
    skip == null ? null : typeof skip === "string" ? [skip] : skip
  for (let index = target.layers.length - 1; index >= 0; index -= 1) {
    const layer = target.layers[index]
    if (skipped?.includes(layer.id)) continue
    if (hitTestLayer(point, layer, target, canvasSize)) return layer
  }
  return undefined
}

export type ImageDropAction =
  | { kind: "replace-device"; layerId: string }
  | { kind: "add-image" }

/**
 * 外部图片拖入画布时，只有最上层命中的 device 才能被直接替换。
 * 普通图片、文字、背景与空白区域都必须走新增图片，避免一次拖入
 * 在没有明确替换入口的情况下覆盖已有内容。
 */
export function resolveImageDropAction(
  point: Point,
  target: Project | ProjectCanvas,
  canvasSize: Size
): ImageDropAction {
  const hit = hitTestTopDown(point, target, canvasSize)
  return hit?.content.kind === "device"
    ? { kind: "replace-device", layerId: hit.id }
    : { kind: "add-image" }
}

/** 该点上是否还压着一个层级高于 `layer` 的图层 */
export function isOccludedAbove(
  point: Point,
  layer: Layer,
  target: Project | ProjectCanvas,
  canvasSize: Size
): boolean {
  const index = target.layers.findIndex((item) => item.id === layer.id)
  if (index < 0) return false
  return target.layers.some(
    (item, itemIndex) =>
      itemIndex > index && hitTestLayer(point, item, target, canvasSize)
  )
}

/**
 * 同一位置连续点击时向下穿透选择的游标：记录本轮已选过的图层。
 * 位置一变、或选中态被画布之外的入口（图层列表、快捷键、撤销等）改掉，本轮即作废。
 */
export type ClickCycle = { x: number; y: number; consumed: string[] } | null

/** 同一位置连续点击视作同一轮穿透的最大偏移（屏幕像素） */
export const CYCLE_SLOP_PX = 4

/**
 * 决定一次按下应该选中哪一层。
 *
 * 默认取该点最上面一层；只有在同一位置连续点击、且上一次点击选中的图层
 * 仍是当前选中态时，才继续往下穿透，穿透到底后回到顶层重新开始。
 * 后一个条件很关键：选中态若是从画布之外改的（图层列表、快捷键、新建、撤销），
 * 本轮穿透必须作废，否则「点一下」会选中并拖走下面那一层。
 */
export function pickLayerAt(args: {
  point: Point
  client: Point
  target: Project | ProjectCanvas
  canvasSize: Size
  selectedLayerId: string | null
  cycle: ClickCycle
}): { layer: Layer | undefined; cycle: ClickCycle } {
  const { point, client, target, canvasSize, selectedLayerId, cycle } = args
  const sameSpot =
    cycle != null &&
    Math.hypot(client.x - cycle.x, client.y - cycle.y) <= CYCLE_SLOP_PX
  const consumed =
    sameSpot && cycle.consumed.at(-1) === selectedLayerId ? cycle.consumed : []
  const deeper =
    consumed.length > 0
      ? hitTestTopDown(point, target, canvasSize, consumed)
      : undefined
  const layer = deeper ?? hitTestTopDown(point, target, canvasSize)
  return {
    layer,
    cycle: layer
      ? {
          x: client.x,
          y: client.y,
          consumed: deeper ? [...consumed, layer.id] : [layer.id],
        }
      : null,
  }
}

export function aspectFillSize(
  image: Size,
  container: Size,
  zoom = 1
): Size {
  if (
    image.width <= 0 ||
    image.height <= 0 ||
    container.width <= 0 ||
    container.height <= 0
  ) {
    return container
  }
  const scale =
    Math.max(container.width / image.width, container.height / image.height) *
    zoom
  return { width: image.width * scale, height: image.height * scale }
}

export function screenshotOffsetBounds(
  imageSize: Size,
  screenSize: Size,
  zoom: number
): Point {
  const filled = aspectFillSize(imageSize, screenSize, zoom)
  return {
    x: Math.max(0, (filled.width - screenSize.width) / 2 / Math.max(screenSize.width, 1)),
    y: Math.max(
      0,
      (filled.height - screenSize.height) / 2 / Math.max(screenSize.height, 1)
    ),
  }
}

export function clampScreenshotOffset(
  offset: Point,
  imageSize: Size,
  screenSize: Size,
  zoom: number
): Point {
  const bounds = screenshotOffsetBounds(imageSize, screenSize, zoom)
  return {
    x: clamp(offset.x, -bounds.x, bounds.x),
    y: clamp(offset.y, -bounds.y, bounds.y),
  }
}

export function rubberBandScreenshotOffset(
  offset: Point,
  imageSize: Size,
  screenSize: Size,
  zoom: number,
  resistance = 0.3
): Point {
  const bounds = screenshotOffsetBounds(imageSize, screenSize, zoom)
  return {
    x: rubberBand(offset.x, bounds.x, resistance),
    y: rubberBand(offset.y, bounds.y, resistance),
  }
}

function rubberBand(value: number, limit: number, resistance: number): number {
  if (value > limit) return limit + (value - limit) * resistance
  if (value < -limit) return -limit + (value + limit) * resistance
  return value
}

export function snapRotation(radians: number): { value: number; snapped: boolean } {
  const deg = (radians * 180) / Math.PI
  const targets = [0, 45, -45, 90, -90, 135, -135, 180, -180]
  for (const target of targets) {
    if (Math.abs(deg - target) <= 3) {
      return { value: (target * Math.PI) / 180, snapped: true }
    }
  }
  return { value: radians, snapped: false }
}

export function normalizedCustomSize(width: number, height: number): Size | null {
  const pixelWidth = Math.round(width)
  const pixelHeight = Math.round(height)
  if (
    pixelWidth < 64 ||
    pixelHeight < 64 ||
    pixelWidth > 4096 ||
    pixelHeight > 4096
  ) {
    return null
  }
  const aspect = pixelWidth / pixelHeight
  if (aspect < CANVAS_ASPECT_RANGE.min || aspect > CANVAS_ASPECT_RANGE.max) {
    return null
  }
  return { width: pixelWidth, height: pixelHeight }
}

export function outputDimensions(
  logical: Size,
  scale: number
): { width: number; height: number; scale: number } | null {
  if (logical.width <= 0 || logical.height <= 0 || !Number.isFinite(scale)) {
    return null
  }
  const longest = Math.max(logical.width, logical.height)
  const resolvedScale = Math.min(Math.max(0.05, scale), 8192 / longest)
  const width = Math.round(logical.width * resolvedScale)
  const height = Math.round(logical.height * resolvedScale)
  if (width <= 0 || height <= 0 || width * height > 8192 * 8192) return null
  return { width, height, scale: resolvedScale }
}

export function intersectRatio(box: Rect, canvas: Size): number {
  const x0 = Math.max(box.x, 0)
  const y0 = Math.max(box.y, 0)
  const x1 = Math.min(box.x + box.width, canvas.width)
  const y1 = Math.min(box.y + box.height, canvas.height)
  const w = Math.max(0, x1 - x0)
  const h = Math.max(0, y1 - y0)
  const area = box.width * box.height
  if (area <= 0) return 0
  return (w * h) / area
}

export function pullLayerOnCanvas(
  layer: Layer,
  target: Project | ProjectCanvas,
  canvasSize: Size
): Point {
  const frame = displayedFrame(layer, target, canvasSize)
  const box = rotatedBoundingBox(frame, layer.transform.rotation)
  if (intersectRatio(box, canvasSize) >= 0.2) return layer.transform.center
  return {
    x: clamp(layer.transform.center.x, 0.12, 0.88),
    y: clamp(layer.transform.center.y, 0.12, 0.88),
  }
}
