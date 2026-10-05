import { DEFAULT_DEVICE_ID, defaultFrameId } from "@/lib/pocket-draft/catalog"
import { baseSize } from "@/lib/pocket-draft/geometry"
import {
  APP_STORE_DISPLAYS,
  composeGoldieLayout,
  DEFAULT_GOLDIE_THEME_ID,
  getGoldieTheme,
  GOLDIE_BACKGROUND,
  GOLDIE_DEVICE_PADDING,
  GOLDIE_LAYOUT_I18N,
  GOLDIE_LAYOUTS,
  GOLDIE_LAYOUT_KEYS,
  GOLDIE_SET_I18N,
  GOLDIE_SET_KEYS,
  GOLDIE_SETS,
  GOLDIE_THEMES,
  goldieCanvasForLayout,
  goldieNeedsSecondCapture,
  isGoldieLayoutKey,
  type AppStoreDisplay,
  type GoldieLayoutKey,
  type GoldieThemeId,
} from "@/lib/pocket-draft/goldie-layouts"
import {
  MAXIMUM_CANVAS_COUNT,
  CANVAS_ASPECT_SIZES,
  createBackgroundLayer,
  createBlankCanvas,
  createDeviceLayer,
  createTextLayer,
  isDevice,
  isText,
  type BackgroundFill,
  type CanvasAspect,
  type DeviceContent,
  type Layer,
  type LayerTransform,
  type Project,
  type ProjectCanvas,
  type TextContent,
} from "@/lib/pocket-draft/models"

export type { AppStoreDisplay, GoldieThemeId }

export type TemplateTextSlot = {
  id: string
  name: string
  textZh?: string
  textEn?: string
  transform: LayerTransform
  content: Partial<TextContent> & { string: string; fontSize: number }
}

export type SnapFrameTemplate = {
  id: string
  nameZh: string
  nameEn: string
  descriptionZh: string
  descriptionEn: string
  deviceCount: number
  canvasAspect: CanvasAspect
  background: BackgroundFill
  deviceTransforms: LayerTransform[]
  textSlots: TemplateTextSlot[]
  kind?: "layout" | "set"
  platform?: "ios" | "macos"
  layoutKey?: GoldieLayoutKey
  macLayoutKey?: string
  sequence?: GoldieLayoutKey[]
  macSequence?: string[]
}

function previewTransforms(key: GoldieLayoutKey): LayerTransform[] {
  return GOLDIE_LAYOUTS[key].devices.map((device) => ({
    center: { x: device.x, y: device.y },
    scale: device.widthRatio,
    rotation: (device.rotate * Math.PI) / 180,
  }))
}

const LAYOUT_TEMPLATES: SnapFrameTemplate[] = GOLDIE_LAYOUT_KEYS.map((key) => {
  const spec = GOLDIE_LAYOUTS[key]
  const i18n = GOLDIE_LAYOUT_I18N[key]
  const canvas = goldieCanvasForLayout(spec, "69")
  return {
    id: `layout-${key}`,
    kind: "layout" as const,
    platform: "ios" as const,
    layoutKey: key,
    nameZh: i18n.nameZh,
    nameEn: i18n.nameEn,
    descriptionZh: i18n.descriptionZh,
    descriptionEn: i18n.descriptionEn,
    deviceCount: spec.devices.length,
    canvasAspect: canvas.aspect,
    background: GOLDIE_BACKGROUND,
    deviceTransforms: previewTransforms(key),
    textSlots: [],
  }
})

const SET_TEMPLATES: SnapFrameTemplate[] = GOLDIE_SET_KEYS.map((key) => {
  const set = GOLDIE_SETS[key]
  const i18n = GOLDIE_SET_I18N[key]
  return {
    id: `set-${key}`,
    kind: "set" as const,
    platform: "ios" as const,
    sequence: set.sequence,
    nameZh: i18n.nameZh,
    nameEn: i18n.nameEn,
    descriptionZh: i18n.descriptionZh,
    descriptionEn: i18n.descriptionEn,
    deviceCount: Math.max(
      ...set.sequence.map((layout) => GOLDIE_LAYOUTS[layout].devices.length)
    ),
    canvasAspect: "appStore69",
    background: GOLDIE_BACKGROUND,
    deviceTransforms: [],
    textSlots: [],
  }
})

export const MAC_LAYOUT_TEMPLATES: SnapFrameTemplate[] = [
  {
    id: "mac-hero-center",
    kind: "layout",
    platform: "macos",
    macLayoutKey: "mac-hero-center",
    nameZh: "MacBook 居中旗舰",
    nameEn: "MacBook Hero Center",
    descriptionZh: "16:10 官方标准尺寸，居中 MacBook Pro 完整展示桌面级应用",
    descriptionEn: "16:10 Retina standard with centered MacBook Pro for desktop apps",
    deviceCount: 1,
    canvasAspect: "macAppStore",
    background: GOLDIE_BACKGROUND,
    deviceTransforms: [
      {
        center: { x: 0.5, y: 0.59 },
        scale: 0.86,
        rotation: 0,
      },
    ],
    textSlots: [],
  },
  {
    id: "mac-floating-window",
    kind: "layout",
    platform: "macos",
    macLayoutKey: "mac-floating-window",
    nameZh: "macOS 极简悬浮窗口",
    nameEn: "macOS Floating Window",
    descriptionZh: "原生交通灯红黄绿窗口与柔和弥散阴影，空间利用率高达 85%+",
    descriptionEn: "Native macOS traffic lights window with soft shadow, maximizing UI detail",
    deviceCount: 1,
    canvasAspect: "macAppStore",
    background: GOLDIE_BACKGROUND,
    deviceTransforms: [
      {
        center: { x: 0.5, y: 0.60 },
        scale: 0.84,
        rotation: 0,
      },
    ],
    textSlots: [],
  },
  {
    id: "mac-dual-split",
    kind: "layout",
    platform: "macos",
    macLayoutKey: "mac-dual-split",
    nameZh: "双窗口分屏对比",
    nameEn: "Dual Window Split",
    descriptionZh: "左右两张错落浮动窗口，展示多面板协作或深浅模式对比",
    descriptionEn: "Dual staggered floating windows showcasing multi-panel or dark/light modes",
    deviceCount: 2,
    canvasAspect: "macAppStore",
    background: GOLDIE_BACKGROUND,
    deviceTransforms: [
      {
        center: { x: 0.32, y: 0.60 },
        scale: 0.58,
        rotation: 0,
      },
      {
        center: { x: 0.68, y: 0.58 },
        scale: 0.58,
        rotation: 0,
      },
    ],
    textSlots: [],
  },
  {
    id: "mac-panorama-flow",
    kind: "layout",
    platform: "macos",
    macLayoutKey: "mac-panorama-flow",
    nameZh: "Mac 全景超宽长卷",
    nameEn: "Mac Panorama Flow",
    descriptionZh: "跨越 2 张 16:10 画布的超宽桌面工作台，无缝向右延展",
    descriptionEn: "Ultra-wide continuous desktop workspace across 2 standard 16:10 canvases",
    deviceCount: 1,
    canvasAspect: "macAppStore",
    background: GOLDIE_BACKGROUND,
    deviceTransforms: [
      {
        center: { x: 0.5, y: 0.58 },
        scale: 0.92,
        rotation: 0,
      },
    ],
    textSlots: [],
  },
  {
    id: "mac-feature-callout",
    kind: "layout",
    platform: "macos",
    macLayoutKey: "mac-feature-callout",
    nameZh: "特性聚焦与特写",
    nameEn: "Feature Spotlight",
    descriptionZh: "主窗口居左，右侧预留特性要点与快捷键（⌘K）标注区",
    descriptionEn: "Main window on the left with dedicated right-side callout feature space",
    deviceCount: 1,
    canvasAspect: "macAppStore",
    background: GOLDIE_BACKGROUND,
    deviceTransforms: [
      {
        center: { x: 0.54, y: 0.60 },
        scale: 0.78,
        rotation: 0,
      },
    ],
    textSlots: [],
  },
  {
    id: "mac-multi-device",
    kind: "layout",
    platform: "macos",
    macLayoutKey: "mac-multi-device",
    nameZh: "Mac + iPhone 跨端协同",
    nameEn: "Mac + iPhone Continuity",
    descriptionZh: "Mac 窗口与 iPhone 手机并列，完美展现 iCloud 同步与跨端生态",
    descriptionEn: "MacBook window paired with iPhone to showcase multi-platform iCloud continuity",
    deviceCount: 2,
    canvasAspect: "macAppStore",
    background: GOLDIE_BACKGROUND,
    deviceTransforms: [
      {
        center: { x: 0.40, y: 0.59 },
        scale: 0.68,
        rotation: 0,
      },
      {
        center: { x: 0.82, y: 0.58 },
        scale: 0.28,
        rotation: 0,
      },
    ],
    textSlots: [],
  },
]

export const MAC_SET_TEMPLATES: SnapFrameTemplate[] = [
  {
    id: "mac-set-flagship",
    kind: "set",
    platform: "macos",
    macSequence: [
      "mac-hero-center",
      "mac-floating-window",
      "mac-dual-split",
      "mac-multi-device",
    ],
    nameZh: "Mac 旗舰工作流套系",
    nameEn: "Mac Flagship Workflow",
    descriptionZh: "MacBook 旗舰主视 + 极简窗口特写 + 双窗口分屏 + Mac & iPhone 跨端协同",
    descriptionEn: "Hero MacBook opener, floating feature window, dual comparison, and continuity suite",
    deviceCount: 2,
    canvasAspect: "macAppStore",
    background: GOLDIE_BACKGROUND,
    deviceTransforms: [],
    textSlots: [],
  },
  {
    id: "mac-set-panorama",
    kind: "set",
    platform: "macos",
    macSequence: [
      "mac-panorama-flow",
      "mac-feature-callout",
    ],
    nameZh: "Mac 全景长卷与特写套系",
    nameEn: "Mac Panorama & Spotlight",
    descriptionZh: "跨 2 张 16:10 画布的超宽长卷 + 特性聚焦与快捷键标注",
    descriptionEn: "Ultra-wide 2-canvas continuous desktop workspace plus dedicated spotlight callout",
    deviceCount: 1,
    canvasAspect: "macAppStore",
    background: GOLDIE_BACKGROUND,
    deviceTransforms: [],
    textSlots: [],
  },
  {
    id: "mac-set-minimal",
    kind: "set",
    platform: "macos",
    macSequence: [
      "mac-floating-window",
      "mac-dual-split",
      "mac-hero-center",
    ],
    nameZh: "macOS 极简质感套系",
    nameEn: "macOS Pure & Focused",
    descriptionZh: "极简悬浮窗口 + 双窗口分屏对比 + MacBook 居中收尾",
    descriptionEn: "Floating window, dual mode comparison, and MacBook center closer",
    deviceCount: 2,
    canvasAspect: "macAppStore",
    background: GOLDIE_BACKGROUND,
    deviceTransforms: [],
    textSlots: [],
  },
]

export const MAC_TEMPLATES: SnapFrameTemplate[] = [
  ...MAC_SET_TEMPLATES,
  ...MAC_LAYOUT_TEMPLATES,
]

export const TEMPLATES: SnapFrameTemplate[] = [
  ...SET_TEMPLATES,
  ...LAYOUT_TEMPLATES,
  ...MAC_TEMPLATES,
]

const PLACEHOLDER_TEXT = new Set([
  "",
  "Text",
  "Headline",
  "标题",
  "标题文字",
  "在此输入文字",
  "Your text here",
  "突出核心卖点",
  "Benefit-led headline",
  "一句补充说明，把价值讲清楚。",
  "One short sentence expanding the headline.",
])

function screenshotRefsOf(canvas: ProjectCanvas): string[] {
  const refs: string[] = []
  for (const layer of canvas.layers) {
    if (layer.content.kind === "device" && layer.content.screenshotRef) {
      refs.push(layer.content.screenshotRef)
    }
  }
  return refs
}

function keepCustomString(previous: string | undefined, fallback: string): string {
  const value = previous?.trim() ?? ""
  if (value.length === 0 || PLACEHOLDER_TEXT.has(value)) return fallback
  return previous ?? fallback
}

function applyLayoutToCanvas(
  canvas: ProjectCanvas,
  key: GoldieLayoutKey,
  locale: string,
  options?: {
    display?: AppStoreDisplay
    themeId?: string
    secondaryScreenshotRef?: string | null
  }
): ProjectCanvas {
  const spec = GOLDIE_LAYOUTS[key]
  const display = options?.display ?? "69"
  const theme = getGoldieTheme(options?.themeId)
  const { aspect, size } = goldieCanvasForLayout(spec, display)
  const existingDevices = canvas.layers.filter(isDevice)
  const existingImages = canvas.layers.filter((layer) => layer.content.kind === "image")
  const existingTexts = canvas.layers.filter(isText)
  const existingShots = screenshotRefsOf(canvas)
  const isZh = locale.startsWith("zh")

  const firstDevice = existingDevices[0]
  const deviceId =
    firstDevice?.content.kind === "device" ? firstDevice.content.deviceId : DEFAULT_DEVICE_ID
  const frameId =
    firstDevice?.content.kind === "device"
      ? firstDevice.content.frameId
      : defaultFrameId(deviceId)
  const orientation =
    firstDevice?.content.kind === "device" ? firstDevice.content.orientation : "portrait"

  const stubDevice = createDeviceLayer({
    deviceId,
    frameId,
    orientation,
    name: "tmp",
  })
  const stubBackground = createBackgroundLayer(theme.background)
  if (stubBackground.content.kind === "background") {
    stubBackground.content.devicePadding = GOLDIE_DEVICE_PADDING
  }
  const stubCanvas: ProjectCanvas = {
    ...canvas,
    canvasAspect: aspect,
    canvasLogicalSize: { ...size },
    layers: [stubBackground, stubDevice],
  }
  const composed = composeGoldieLayout(spec, size, baseSize(stubDevice, stubCanvas), { theme })

  const background = createBackgroundLayer(theme.background)
  if (background.content.kind === "background") {
    background.content.devicePadding = GOLDIE_DEVICE_PADDING
  }

  const primaryShot = existingShots[0] ?? null
  const secondaryShot =
    options?.secondaryScreenshotRef ?? existingShots[1] ?? primaryShot

  const deviceLayers: Layer[] = composed.devices.map((item, index) => {
    const prev = existingDevices[index] ?? existingDevices[0]
    const id =
      prev?.content.kind === "device" ? prev.content.deviceId : deviceId
    const frame =
      prev?.content.kind === "device" ? prev.content.frameId : defaultFrameId(id)
    const orient =
      prev?.content.kind === "device" ? prev.content.orientation : orientation
    const layer = createDeviceLayer({
      deviceId: id,
      frameId: frame,
      orientation: orient,
      name: `iPhone ${index + 1}`,
    })
    layer.transform = { ...item.transform }
    const content = layer.content as DeviceContent
    content.screenshotRef = item.capture === "secondary" ? secondaryShot : primaryShot
    content.wasManuallyTransformed = true
    return layer
  })

  const textLayers: Layer[] = composed.texts.map((slot, index) => {
    const defaultText = isZh ? slot.textZh : slot.textEn
    const previous =
      existingTexts[index]?.content.kind === "text"
        ? existingTexts[index].content.string
        : undefined
    const layer = createTextLayer({
      string: keepCustomString(previous, defaultText),
      fontSize: slot.content.fontSize,
      name: isZh ? (slot.id === "headline" ? "标题" : "副标题") : slot.name,
      color: slot.content.color,
      weight: slot.content.weight,
      fontName: slot.content.fontName,
      alignment: slot.content.alignment,
      kerning: slot.content.kerning,
      lineSpacing: slot.content.lineSpacing,
      boxWidth: slot.content.boxWidth,
    })
    layer.transform = { ...slot.transform }
    return layer
  })

  return {
    ...canvas,
    canvasAspect: aspect,
    canvasLogicalSize: { ...size },
    layers: [background, ...deviceLayers, ...textLayers, ...existingImages],
  }
}

function applyMacTemplateToCanvas(
  canvas: ProjectCanvas,
  template: SnapFrameTemplate,
  locale: string,
  options?: {
    themeId?: string
  }
): ProjectCanvas {
  const isZh = locale.startsWith("zh")
  const existingShots = screenshotRefsOf(canvas)
  const existingImages = canvas.layers.filter((layer) => layer.content.kind === "image")
  const existingTexts = canvas.layers.filter(isText)
  const isPano = template.macLayoutKey === "mac-panorama-flow"

  const size = isPano
    ? { width: 5760, height: 1800 }
    : { ...CANVAS_ASPECT_SIZES.macAppStore }

  const theme = getGoldieTheme(options?.themeId)
  const background = createBackgroundLayer(theme.background)

  const isDarkBg = theme.isDark

  const headlineColor = theme.headlineColor
  const subheadColor = theme.subheadColor

  // 1. 文案图层（适合 16:10 宽屏）
  const defaultHead = isZh ? "重构生产力工作流" : "Supercharge Your Mac Workflow"
  const defaultSub = isZh
    ? "专为 macOS 打造的高性能沉浸式体验"
    : "Designed exclusively for a seamless, blazing-fast macOS experience"

  const prevHead = existingTexts[0]?.content.kind === "text" ? existingTexts[0].content.string : undefined
  const prevSub = existingTexts[1]?.content.kind === "text" ? existingTexts[1].content.string : undefined

  const isLeftAlign = template.macLayoutKey === "mac-feature-callout"

  const headLayer = createTextLayer({
    string: keepCustomString(prevHead, defaultHead),
    fontSize: isPano ? 110 : 84,
    name: isZh ? "标题" : "Headline",
    color: headlineColor,
    weight: "bold",
    alignment: isLeftAlign ? "leading" : "center",
    boxWidth: isLeftAlign ? 1200 : isPano ? 2800 : 2200,
  })
  headLayer.transform = {
    center: isLeftAlign ? { x: 0.28, y: 0.11 } : { x: 0.5, y: 0.11 },
    scale: 1,
    rotation: 0,
  }

  const subLayer = createTextLayer({
    string: keepCustomString(prevSub, defaultSub),
    fontSize: isPano ? 48 : 38,
    name: isZh ? "副标题" : "Subheadline",
    color: subheadColor,
    weight: "regular",
    alignment: isLeftAlign ? "leading" : "center",
    boxWidth: isLeftAlign ? 1200 : isPano ? 2400 : 2000,
  })
  subLayer.transform = {
    center: isLeftAlign ? { x: 0.28, y: 0.19 } : { x: 0.5, y: 0.19 },
    scale: 1,
    rotation: 0,
  }

  // 2. 设备图层生成
  const primaryShot = existingShots[0] ?? null
  const secondaryShot = existingShots[1] ?? primaryShot

  const deviceLayers: Layer[] = template.deviceTransforms.map((t, idx) => {
    let deviceId = "macos-window"
    let frameId = isDarkBg ? "dark" : "light"
    let orient: "portrait" | "landscape" = "landscape"

    if (template.macLayoutKey === "mac-hero-center") {
      deviceId = "macbook-pro-16"
      frameId = isDarkBg ? "space-black" : "silver"
    } else if (template.macLayoutKey === "mac-multi-device" && idx === 1) {
      deviceId = "iphone-17-pro"
      frameId = isDarkBg ? "black" : "silver"
      orient = "portrait"
    }

    const layer = createDeviceLayer({
      deviceId,
      frameId,
      orientation: orient,
      name: `Device ${idx + 1}`,
    })
    layer.transform = { ...t }
    const content = layer.content as DeviceContent
    content.screenshotRef = idx === 1 ? secondaryShot : primaryShot
    content.wasManuallyTransformed = true
    return layer
  })

  return {
    ...canvas,
    canvasAspect: "macAppStore",
    canvasLogicalSize: size,
    layers: [background, ...deviceLayers, headLayer, subLayer, ...existingImages],
  }
}

export function applyTemplateToCanvas(
  canvas: ProjectCanvas,
  template: SnapFrameTemplate,
  locale = "zh",
  options?: {
    display?: AppStoreDisplay
    themeId?: string
    secondaryScreenshotRef?: string | null
  }
): ProjectCanvas {
  if (template.platform === "macos" || template.macLayoutKey) {
    return applyMacTemplateToCanvas(canvas, template, locale, options)
  }
  const key = template.layoutKey
  if (key && isGoldieLayoutKey(key)) {
    return applyLayoutToCanvas(canvas, key, locale, options)
  }
  return canvas
}

export function applyTemplateSetToProject(
  project: Project,
  template: SnapFrameTemplate,
  locale = "zh",
  display: AppStoreDisplay = "69",
  themeId?: string
): Project {
  const isZh = locale.startsWith("zh")

  // 1. 处理 Mac 成套序列
  if (template.platform === "macos" && template.macSequence) {
    const macSeq = template.macSequence
    const needed = Math.min(macSeq.length, MAXIMUM_CANVAS_COUNT)
    const canvases = [...project.canvases]
    const defaultSize = CANVAS_ASPECT_SIZES.macAppStore

    while (canvases.length < needed) {
      const name = isZh
        ? `画布 ${canvases.length + 1}`
        : `Canvas ${canvases.length + 1}`
      canvases.push(createBlankCanvas("macAppStore", name, defaultSize))
    }

    const next = canvases.map((canvas, index) => {
      if (index >= needed) return canvas
      const layoutId = macSeq[index]
      const subTemplate = MAC_LAYOUT_TEMPLATES.find(
        (t) => t.id === layoutId || t.macLayoutKey === layoutId
      )
      if (!subTemplate) return canvas

      const applied = applyMacTemplateToCanvas(canvas, subTemplate, locale, { themeId })
      const subName = isZh ? subTemplate.nameZh : subTemplate.nameEn
      return {
        ...applied,
        name: `${index + 1} · ${subName}`,
      }
    })

    return {
      ...project,
      canvases: next,
      activeCanvasId: next[0]?.id ?? project.activeCanvasId,
      canvasAspect: next[0]?.canvasAspect ?? project.canvasAspect,
      canvasLogicalSize: next[0]
        ? { ...next[0].canvasLogicalSize }
        : project.canvasLogicalSize,
      layers: next[0]?.layers ?? project.layers,
    }
  }

  // 2. 处理 iOS 成套序列
  const sequence = template.sequence ?? []
  if (sequence.length === 0) return project

  const needed = Math.min(sequence.length, MAXIMUM_CANVAS_COUNT)
  const tile = APP_STORE_DISPLAYS[display]
  const canvases = [...project.canvases]
  while (canvases.length < needed) {
    const name = isZh
      ? `画布 ${canvases.length + 1}`
      : `Canvas ${canvases.length + 1}`
    canvases.push(createBlankCanvas(tile.aspect, name, tile.size))
  }

  const shots = canvases.map((canvas) => screenshotRefsOf(canvas)[0] ?? null)
  const next = canvases.map((canvas, index) => {
    if (index >= needed) return canvas
    const key = sequence[index]
    const spec = GOLDIE_LAYOUTS[key]
    const i18n = GOLDIE_LAYOUT_I18N[key]
    const secondary = goldieNeedsSecondCapture(spec)
      ? shots[(index + 1) % needed]
      : null
    const applied = applyLayoutToCanvas(canvas, key, locale, {
      display,
      themeId,
      secondaryScreenshotRef: secondary,
    })
    return {
      ...applied,
      name: isZh ? `${index + 1} · ${i18n.nameZh}` : `${index + 1} · ${i18n.nameEn}`,
    }
  })

  return {
    ...project,
    canvases: next,
    activeCanvasId: next[0]?.id ?? project.activeCanvasId,
    canvasAspect: next[0]?.canvasAspect ?? project.canvasAspect,
    canvasLogicalSize: next[0]
      ? { ...next[0].canvasLogicalSize }
      : project.canvasLogicalSize,
    layers: next[0]?.layers ?? project.layers,
  }
}
