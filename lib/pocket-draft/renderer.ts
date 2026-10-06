import {
  frameCacheKey,
  geometryFor,
  screenCornerRadii,
} from "@/lib/pocket-draft/catalog"
import { canvasFont } from "@/lib/pocket-draft/fonts"
import {
  aspectFillSize,
  baseSize,
  displayedFrame,
  outputDimensions,
  textLayout,
  rotatedBoundingBox,
} from "@/lib/pocket-draft/geometry"
import type { ImageSource } from "@/lib/pocket-draft/assets"
import { imageSize } from "@/lib/pocket-draft/assets"
import {
  colorToCss,
  type BackgroundFill,
  type DeviceContent,
  type GradientStop,
  type ImageContent,
  type Layer,
  type Project,
  type ProjectCanvas,
  type Rect,
  type Size,
  type TextContent,
} from "@/lib/pocket-draft/models"

import { appStoreAssetSpec, assertAssetExport } from "./app-store-assets"
import { encodeOpaquePng, pngInfo } from "./opaque-png"

export type RenderImages = Record<string, ImageSource | undefined>

export type DrawOptions = {
  width: number
  height: number
  isExport?: boolean
  transparentBackground?: boolean
  omittedLayerId?: string | null
  previewQuality?: boolean
  opaqueBackground?: boolean
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number | number[]
) {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath()
    ctx.roundRect(x, y, width, height, radius)
    ctx.closePath()
    return
  }
  const r = typeof radius === "number" ? radius : (radius[0] ?? 0)
  const clr = Math.max(0, Math.min(r, width / 2, height / 2))
  ctx.beginPath()
  ctx.moveTo(x + clr, y)
  ctx.arcTo(x + width, y, x + width, y + height, clr)
  ctx.arcTo(x + width, y + height, x, y + height, clr)
  ctx.arcTo(x, y + height, x, y, clr)
  ctx.arcTo(x, y, x + width, y, clr)
  ctx.closePath()
}

function fillStops(gradient: CanvasGradient, stops: GradientStop[]) {
  for (const stop of stops) {
    gradient.addColorStop(
      Math.min(1, Math.max(0, stop.location)),
      colorToCss(stop.color)
    )
  }
}

function drawFill(
  ctx: CanvasRenderingContext2D,
  fill: BackgroundFill,
  size: Size,
  images: RenderImages,
  displayScale: number,
  previewQuality: boolean
) {
  switch (fill.kind) {
    case "solid":
      ctx.fillStyle = colorToCss(fill.color)
      ctx.fillRect(0, 0, size.width, size.height)
      break
    case "linearGradient": {
      const rad = (fill.angle * Math.PI) / 180
      const cx = size.width / 2
      const cy = size.height / 2
      const len = Math.hypot(size.width, size.height) / 2
      const gradient = ctx.createLinearGradient(
        cx - Math.cos(rad) * len,
        cy - Math.sin(rad) * len,
        cx + Math.cos(rad) * len,
        cy + Math.sin(rad) * len
      )
      fillStops(gradient, fill.stops)
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, size.width, size.height)
      break
    }
    case "radialGradient": {
      const gradient = ctx.createRadialGradient(
        size.width / 2,
        size.height / 2,
        0,
        size.width / 2,
        size.height / 2,
        Math.hypot(size.width, size.height) * 0.58
      )
      fillStops(gradient, fill.stops)
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, size.width, size.height)
      break
    }
    case "image": {
      const image = images[fill.assetRef]
      if (!image) {
        ctx.fillStyle = "#6b7280"
        ctx.fillRect(0, 0, size.width, size.height)
        break
      }
      const source = imageSize(image)
      const scale = Math.max(
        size.width / source.width,
        size.height / source.height
      )
      const drawW = source.width * scale
      const drawH = source.height * scale
      const dx = (size.width - drawW) / 2
      const dy = (size.height - drawH) / 2
      const blur = fill.blurRadius * displayScale
      ctx.save()
      if (blur > 0) {
        ctx.filter = `blur(${previewQuality ? blur * 0.35 : blur}px)`
      }
      ctx.drawImage(image, dx, dy, drawW, drawH)
      ctx.filter = "none"
      if (fill.dimming > 0) {
        ctx.fillStyle = `rgba(0,0,0,${fill.dimming})`
        ctx.fillRect(0, 0, size.width, size.height)
      }
      ctx.restore()
      break
    }
  }
}

function withLayerTransform(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  target: Project | ProjectCanvas,
  canvasSize: Size,
  draw: (frame: Rect) => void
) {
  const frame = displayedFrame(layer, target, canvasSize)
  ctx.save()
  ctx.globalAlpha *= layer.opacity
  ctx.translate(frame.x + frame.width / 2, frame.y + frame.height / 2)
  ctx.rotate(layer.transform.rotation)
  ctx.translate(-frame.width / 2, -frame.height / 2)
  draw(frame)
  ctx.restore()
}

function drawDevice(
  ctx: CanvasRenderingContext2D,
  content: DeviceContent,
  frame: Rect,
  images: RenderImages
) {
  const geo = geometryFor(content.deviceId, content.orientation)
  const w = frame.width
  const h = frame.height
  const screen = {
    x: w * geo.frame.x,
    y: h * geo.frame.y,
    width: w * geo.frame.width,
    height: h * geo.frame.height,
  }
  const radius = screenCornerRadii(geo, screen.width)
  const isMacWindow = content.deviceId === "macos-window"

  const frameImage =
    images[
      frameCacheKey(content.deviceId, content.frameId, content.orientation)
    ]

  if (content.shadowIntensity > 0) {
    ctx.save()
    const shadowMul = isMacWindow ? 1.4 : 1
    ctx.shadowColor = `rgba(0,0,0,${content.shadowIntensity * 0.42})`
    ctx.shadowBlur = w * 0.09 * content.shadowIntensity * shadowMul
    ctx.shadowOffsetY = w * 0.045 * content.shadowIntensity * shadowMul

    // 屏幕区域自然投射阴影
    roundRect(ctx, screen.x, screen.y, screen.width, screen.height, radius)
    ctx.fillStyle = "rgba(0,0,0,0.7)"
    ctx.fill()

    // 若有真实外壳贴图，利用真实 PNG alpha 通道自然投射精确外壳轮廓与底座阴影
    if (frameImage) {
      ctx.drawImage(frameImage, 0, 0, w, h)
    }
    ctx.restore()
  }

  roundRect(ctx, screen.x, screen.y, screen.width, screen.height, radius)
  ctx.fillStyle = "#050505"
  ctx.fill()

  const shot = content.screenshotRef ? images[content.screenshotRef] : undefined
  if (shot) {
    const source = imageSize(shot)
    const filled = aspectFillSize(source, screen, content.screenshotZoom)
    const dx =
      screen.x +
      (screen.width - filled.width) / 2 +
      content.screenshotOffset.x * screen.width
    const dy =
      screen.y +
      (screen.height - filled.height) / 2 +
      content.screenshotOffset.y * screen.height
    ctx.save()
    roundRect(ctx, screen.x, screen.y, screen.width, screen.height, radius)
    ctx.clip()
    ctx.drawImage(shot, dx, dy, filled.width, filled.height)
    ctx.restore()
  } else {
    ctx.save()
    roundRect(ctx, screen.x, screen.y, screen.width, screen.height, radius)
    ctx.clip()
    const gradient = ctx.createLinearGradient(
      screen.x,
      screen.y,
      screen.x + screen.width,
      screen.y + screen.height
    )
    gradient.addColorStop(0, "rgba(255,255,255,0.2)")
    gradient.addColorStop(1, "rgba(0,0,0,0.18)")
    ctx.fillStyle = gradient
    ctx.fillRect(screen.x, screen.y, screen.width, screen.height)
    ctx.restore()
  }

  // 绘制真实设备外壳（或 macOS 原生悬浮交通灯窗口）
  if (frameImage) {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(frameImage, 0, 0, w, h)
  } else if (isMacWindow) {
    drawMacosWindowFrame(ctx, screen, content.frameId)
  }
}

function drawMacosWindowFrame(
  ctx: CanvasRenderingContext2D,
  screen: Rect,
  frameId: string
) {
  const isLight = frameId === "light"
  const titleBarHeight = Math.max(16, screen.width * 0.038)

  ctx.save()
  // 1. 窗口标题栏背景
  roundRect(ctx, screen.x, screen.y, screen.width, titleBarHeight, [
    screen.width * 0.022,
    screen.width * 0.022,
    0,
    0,
  ])
  ctx.fillStyle = isLight ? "#EAEAEA" : "#24252A"
  ctx.fill()

  // 标题栏下边框细线
  ctx.strokeStyle = isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(screen.x, screen.y + titleBarHeight)
  ctx.lineTo(screen.x + screen.width, screen.y + titleBarHeight)
  ctx.stroke()

  // 2. 交通灯圆点
  const dotRadius = Math.max(3.5, titleBarHeight * 0.22)
  const dotY = screen.y + titleBarHeight / 2
  const startX = screen.x + titleBarHeight * 0.7
  const dotSpacing = dotRadius * 2.8

  const colors = [
    { fill: "#FF5F56", border: "#E0443E" }, // 关闭红
    { fill: "#FFBD2E", border: "#DEA123" }, // 最小化黄
    { fill: "#27C93F", border: "#1AAB29" }, // 全屏绿
  ]

  colors.forEach((c, i) => {
    const cx = startX + i * dotSpacing
    ctx.beginPath()
    ctx.arc(cx, dotY, dotRadius, 0, Math.PI * 2)
    ctx.fillStyle = c.fill
    ctx.fill()
    ctx.strokeStyle = c.border
    ctx.lineWidth = 0.5
    ctx.stroke()
  })

  // 3. 窗口外框高光 (Subtle stroke)
  roundRect(
    ctx,
    screen.x,
    screen.y,
    screen.width,
    screen.height,
    screen.width * 0.022
  )
  ctx.strokeStyle = isLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.14)"
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
}

function drawText(
  ctx: CanvasRenderingContext2D,
  content: TextContent,
  frame: Rect,
  target: Project | ProjectCanvas
) {
  const logical = target.canvasLogicalSize
  const base = baseSize({ content } as Layer, target)
  const scale = frame.width / Math.max(base.width, 1)
  const layout = textLayout(content, logical)
  const fontSize = content.fontSize * scale
  const lineHeight = (content.fontSize * 1.25 + content.lineSpacing) * scale
  const padX = (content.pill?.paddingX ?? 0) * scale
  const padY = (content.pill?.paddingY ?? 0) * scale

  // 1. Draw Pill background if enabled
  if (content.pill) {
    const corner = (content.pill.cornerRadius ?? 16) * scale
    ctx.save()
    ctx.fillStyle = colorToCss(content.pill.color)
    roundRect(ctx, 0, 0, frame.width, frame.height, corner)
    ctx.fill()
    ctx.restore()
  }

  // 2. Setup Font & Alignment
  ctx.save()
  ctx.font = canvasFont(content.fontName, fontSize, content.weight)
  ctx.letterSpacing = `${content.kerning * scale}px`
  ctx.textAlign =
    content.alignment === "leading"
      ? "left"
      : content.alignment === "trailing"
        ? "right"
        : "center"
  const x =
    content.alignment === "leading"
      ? padX
      : content.alignment === "trailing"
        ? frame.width - padX
        : frame.width / 2

  // CSS 行盒模型：内容区高度 = 字体真实 ascent + descent（通常 > fontSize），
  // 行高与内容区的差值上下平分（half-leading），基线 = 行顶 + (lineHeight + A − D) / 2。
  // canvas 的 textBaseline="top" 用的是归一化 em 方框（A+D 恰为 1em），与 CSS 不一致，
  // 会让编辑态 textarea 里的文字相对画布下移数像素。这里改用与 DOM 同源的
  // fontBoundingBox 度量按 alphabetic 基线绘制，保证进出编辑态文字不跳动。
  const probe = ctx.measureText(
    content.string.length > 0 ? content.string.slice(0, 400) : " "
  )
  const ascent = probe.fontBoundingBoxAscent
  const descent = probe.fontBoundingBoxDescent
  let firstLineY: number
  if (Number.isFinite(ascent) && Number.isFinite(descent)) {
    ctx.textBaseline = "alphabetic"
    firstLineY = padY + (lineHeight + ascent - descent) / 2
  } else {
    // 旧浏览器缺少 fontBoundingBox 度量时退回 em 方框近似
    ctx.textBaseline = "top"
    firstLineY = padY + (lineHeight - fontSize) / 2
  }

  // 3. Draw Shadow
  if (content.shadow) {
    ctx.shadowColor = colorToCss(content.shadow.color)
    ctx.shadowBlur = content.shadow.radius * scale
    ctx.shadowOffsetX = content.shadow.offsetX * scale
    ctx.shadowOffsetY = content.shadow.offsetY * scale
  }

  // 4. Draw Stroke if enabled
  if (content.stroke && content.stroke.width > 0) {
    ctx.strokeStyle = colorToCss(content.stroke.color)
    ctx.lineWidth = content.stroke.width * scale
    ctx.lineJoin = "round"
    layout.lines.forEach((line, index) => {
      ctx.strokeText(line.text, x, firstLineY + index * lineHeight)
    })
  }

  // 5. Draw Fill
  ctx.fillStyle = colorToCss(content.color)
  layout.lines.forEach((line, index) => {
    ctx.fillText(line.text, x, firstLineY + index * lineHeight)
  })

  ctx.restore()
}

function drawImageLayer(
  ctx: CanvasRenderingContext2D,
  content: ImageContent,
  frame: Rect,
  images: RenderImages
) {
  const image = images[content.assetRef]
  if (!image) return
  const radius = content.cornerRadius * (frame.width / Math.max(image.width, 1))
  ctx.save()
  if (radius > 0) {
    roundRect(ctx, 0, 0, frame.width, frame.height, radius)
    ctx.clip()
  }
  ctx.drawImage(image, 0, 0, frame.width, frame.height)
  ctx.restore()
}

export function drawProject(
  ctx: CanvasRenderingContext2D,
  target: Project | ProjectCanvas,
  images: RenderImages,
  options: DrawOptions
) {
  const canvasSize = { width: options.width, height: options.height }
  const displayScale =
    options.width / Math.max(target.canvasLogicalSize.width, 1)
  ctx.save()
  ctx.clearRect(0, 0, options.width, options.height)
  if (options.opaqueBackground) {
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, options.width, options.height)
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"

  for (const layer of target.layers) {
    if (!layer.isVisible) continue
    if (options.omittedLayerId && layer.id === options.omittedLayerId) continue
    const content = layer.content
    if (content.kind === "background") {
      if (options.transparentBackground) continue
      drawFill(
        ctx,
        content.fill,
        canvasSize,
        images,
        displayScale,
        options.previewQuality ?? false
      )
      continue
    }
    withLayerTransform(ctx, layer, target, canvasSize, (frame) => {
      if (content.kind === "device") drawDevice(ctx, content, frame, images)
      if (content.kind === "text") drawText(ctx, content, frame, target)
      if (content.kind === "image") drawImageLayer(ctx, content, frame, images)
    })
  }
  ctx.restore()
}

export async function renderCanvasBlob(
  canvas: ProjectCanvas | Project,
  images: RenderImages,
  options: {
    scale: number
    format: "png" | "jpeg"
    quality?: number
    transparentBackground?: boolean
    region?: Rect
    showBounds?: boolean
    preview?: boolean
  }
): Promise<Blob> {
  if (!options.preview) assertAssetExport(canvas, options)
  const spec = appStoreAssetSpec(canvas.canvasAspect)
  const opaque = options.format === "jpeg" || !options.transparentBackground
  const region = options.region ?? { x: 0, y: 0, ...canvas.canvasLogicalSize }
  if (
    region.x < 0 ||
    region.y < 0 ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.x + region.width > canvas.canvasLogicalSize.width ||
    region.y + region.height > canvas.canvasLogicalSize.height
  )
    throw new Error("invalid_region: region must be inside the canvas")
  const dims = outputDimensions(region, options.scale)
  if (!dims) throw new Error("Invalid export size")
  const htmlCanvas = document.createElement("canvas")
  htmlCanvas.width = dims.width
  htmlCanvas.height = dims.height
  const ctx = htmlCanvas.getContext("2d", {
    alpha: !opaque,
    colorSpace: "srgb",
  })
  if (!ctx) throw new Error("Canvas unsupported")
  ctx.translate(-region.x * dims.scale, -region.y * dims.scale)
  drawProject(ctx, canvas, images, {
    width: canvas.canvasLogicalSize.width * dims.scale,
    height: canvas.canvasLogicalSize.height * dims.scale,
    isExport: true,
    transparentBackground:
      options.format === "png" && options.transparentBackground,
    opaqueBackground: opaque,
  })
  if (options.showBounds) {
    ctx.save()
    ctx.scale(options.scale, options.scale)
    ctx.strokeStyle = "#ff00cc"
    ctx.lineWidth = 1 / options.scale
    for (const layer of canvas.layers) {
      if (!layer.isVisible || layer.content.kind === "background") continue
      const bounds = rotatedBoundingBox(
        displayedFrame(layer, canvas, canvas.canvasLogicalSize),
        layer.transform.rotation
      )
      ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height)
    }
    ctx.restore()
  }
  const mime = options.format === "jpeg" ? "image/jpeg" : "image/png"
  const quality =
    options.format === "jpeg" ? (options.quality ?? 0.92) : undefined
  const blob =
    !options.preview && spec?.opaque && options.format === "png"
      ? await encodeOpaquePng(ctx.getImageData(0, 0, dims.width, dims.height))
      : await new Promise<Blob | null>((resolve) =>
          htmlCanvas.toBlob(resolve, mime, quality)
        )
  if (!blob) throw new Error("Export failed")
  if (!options.preview && spec?.maxBytes && blob.size > spec.maxBytes)
    throw new Error("asset_file_size: image exceeds 500 MB")
  if (!options.preview && spec?.opaque && options.format === "png") {
    const info = pngInfo(new Uint8Array(await blob.arrayBuffer()))
    if (
      info.colorType !== 2 ||
      info.transparency ||
      info.width !== dims.width ||
      info.height !== dims.height
    )
      throw new Error("asset_encoding: RGB PNG verification failed")
  }
  return blob
}

/**
 * 将 2-span 全景画布等宽切分成左右两张独立的标准 App Store 截图
 */
export async function renderCanvasSlicesBlob(
  canvas: ProjectCanvas | Project,
  images: RenderImages,
  options: {
    scale: number
    format: "png" | "jpeg"
    quality?: number
    transparentBackground?: boolean
  }
): Promise<[Blob, Blob]> {
  assertAssetExport(canvas, { ...options, slices: true })
  const dims = outputDimensions(canvas.canvasLogicalSize, options.scale)
  if (!dims) throw new Error("Invalid export size")

  const fullCanvas = document.createElement("canvas")
  fullCanvas.width = dims.width
  fullCanvas.height = dims.height
  const fullCtx = fullCanvas.getContext("2d")
  if (!fullCtx) throw new Error("Canvas unsupported")

  if (options.format === "jpeg" || !options.transparentBackground) {
    fullCtx.fillStyle = "#ffffff"
    fullCtx.fillRect(0, 0, dims.width, dims.height)
  }

  drawProject(fullCtx, canvas, images, {
    width: dims.width,
    height: dims.height,
    isExport: true,
    transparentBackground:
      options.format === "png" && options.transparentBackground,
  })

  const halfWidth = Math.round(dims.width / 2)
  const mime = options.format === "jpeg" ? "image/jpeg" : "image/png"
  const quality =
    options.format === "jpeg" ? (options.quality ?? 0.92) : undefined

  async function sliceToBlob(sx: number, sw: number): Promise<Blob> {
    const sliceCanvas = document.createElement("canvas")
    sliceCanvas.width = sw
    sliceCanvas.height = dims!.height
    const sliceCtx = sliceCanvas.getContext("2d")
    if (!sliceCtx) throw new Error("Canvas unsupported")

    sliceCtx.drawImage(
      fullCanvas,
      sx,
      0,
      sw,
      dims!.height,
      0,
      0,
      sw,
      dims!.height
    )

    const blob = await new Promise<Blob | null>((resolve) =>
      sliceCanvas.toBlob(resolve, mime, quality)
    )
    if (!blob) throw new Error("Export slice failed")
    return blob
  }

  const [leftBlob, rightBlob] = await Promise.all([
    sliceToBlob(0, halfWidth),
    sliceToBlob(halfWidth, dims.width - halfWidth),
  ])

  return [leftBlob, rightBlob]
}

export async function renderProjectBlob(
  project: Project,
  images: RenderImages,
  options: {
    scale: number
    format: "png" | "jpeg"
    quality?: number
    transparentBackground?: boolean
  }
): Promise<Blob> {
  const active =
    project.canvases.find((c) => c.id === project.activeCanvasId) ||
    project.canvases[0] ||
    project
  return renderCanvasBlob(active, images, options)
}
