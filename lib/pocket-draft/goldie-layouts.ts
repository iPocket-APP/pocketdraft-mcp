/**
 * Goldie screenshot layouts, ported from
 * https://github.com/kacperkapusciak/goldie/blob/main/src/layouts.ts
 *
 * Fractions are relative to a single store tile. PocketDraft maps a span-2
 * layout onto one wide canvas (two tiles side by side) instead of slicing.
 */
import {
  CANVAS_ASPECT_SIZES,
  SCALE_RANGE,
  clamp,
  colorFromHex,
  type BackgroundFill,
  type CanvasAspect,
  type Color,
  type FontWeight,
  type LayerTransform,
  type Size,
  type TextAlign,
  type TextContent,
} from "@/lib/pocket-draft/models"

export const GOLDIE_LAYOUT_KEYS = [
  "classic",
  "copy-below",
  "hero",
  "offset",
  "tilt",
  "tilt-right",
  "duo",
  "duo-tilt",
  "panorama",
  "panorama-duo",
  "minimal",
] as const

export type GoldieLayoutKey = (typeof GOLDIE_LAYOUT_KEYS)[number]

export const GOLDIE_SET_KEYS = [
  "editorial",
  "showcase",
  "magazine",
  "storyboard",
  "dynamic",
  "minimalist",
  "feature-focus",
  "panorama-flow",
  "bold-diagonal",
  "app-preview",
] as const

export type GoldieSetKey = (typeof GOLDIE_SET_KEYS)[number]

export type GoldieCopyAlign = "center" | "left"
export type GoldieCopyPosition = "top" | "bottom" | "none"

export type GoldieDevicePlacement = {
  widthRatio: number
  x: number
  y: number
  rotate: number
  capture: "primary" | "secondary"
  fitBelowCopy?: boolean
}

export type GoldieLayoutSpec = {
  key: GoldieLayoutKey
  label: string
  description: string
  span: 1 | 2
  copy: {
    position: GoldieCopyPosition
    align: GoldieCopyAlign
    heightRatio?: number
    x?: number
    widthRatio?: number
  }
  devices: GoldieDevicePlacement[]
}

export const GOLDIE_TYPE = {
  headlineSize: 0.082,
  headlineLineHeight: 1.08,
  headlineTracking: -0.0016,
  headlineWeight: 700,
  subheadSize: 0.038,
  subheadLineHeight: 1.3,
  subheadWeight: 400,
  padX: 0.09,
  padTop: 0.055,
  padBottom: 0.05,
  gap: 0.014,
} as const

export const GOLDIE_CLASSIC_BOTTOM_MARGIN = 0.03
export const GOLDIE_CLASSIC_COPY_HEIGHT = 0.24
export const GOLDIE_CLASSIC_DEVICE_WIDTH = 0.84
export const GOLDIE_DEVICE_PADDING = 0.06
export const GOLDIE_DEFAULT_FONT = "merriweather"

export type GoldieThemeId =
  | "arctic"
  | "peach"
  | "mint"
  | "lavender"
  | "ocean"
  | "ember"
  | "sunset"
  | "midnight"
  | "graphite"
  | "pure-white"
  | "pure-black"

export type GoldieTheme = {
  id: GoldieThemeId
  nameZh: string
  nameEn: string
  isDark: boolean
  background: BackgroundFill
  headlineColor: Color
  subheadColor: Color
  previewCss: string
}

export const GOLDIE_THEMES: Record<GoldieThemeId, GoldieTheme> = {
  arctic: {
    id: "arctic",
    nameZh: "极地冰蓝",
    nameEn: "Arctic",
    isDark: false,
    background: {
      kind: "linearGradient",
      angle: 160,
      stops: [
        { color: colorFromHex("#E8F1FF"), location: 0 },
        { color: colorFromHex("#F7FAFF"), location: 0.55 },
        { color: colorFromHex("#FFFFFF"), location: 1 },
      ],
    },
    headlineColor: colorFromHex("#0E1B2A"),
    subheadColor: colorFromHex("#5A6A7D"),
    previewCss: "linear-gradient(160deg, #E8F1FF 0%, #F7FAFF 55%, #FFFFFF 100%)",
  },
  peach: {
    id: "peach",
    nameZh: "暖阳蜜桃",
    nameEn: "Peach",
    isDark: false,
    background: {
      kind: "linearGradient",
      angle: 160,
      stops: [
        { color: colorFromHex("#FFE8D6"), location: 0 },
        { color: colorFromHex("#FFF7F0"), location: 0.55 },
        { color: colorFromHex("#FFFFFF"), location: 1 },
      ],
    },
    headlineColor: colorFromHex("#1C1917"),
    subheadColor: colorFromHex("#78716C"),
    previewCss: "linear-gradient(160deg, #FFE8D6 0%, #FFF7F0 55%, #FFFFFF 100%)",
  },
  mint: {
    id: "mint",
    nameZh: "清新薄荷",
    nameEn: "Mint",
    isDark: false,
    background: {
      kind: "linearGradient",
      angle: 160,
      stops: [
        { color: colorFromHex("#D9F9EF"), location: 0 },
        { color: colorFromHex("#F2FDF9"), location: 0.55 },
        { color: colorFromHex("#FFFFFF"), location: 1 },
      ],
    },
    headlineColor: colorFromHex("#064E3B"),
    subheadColor: colorFromHex("#047857"),
    previewCss: "linear-gradient(160deg, #D9F9EF 0%, #F2FDF9 55%, #FFFFFF 100%)",
  },
  lavender: {
    id: "lavender",
    nameZh: "柔紫熏衣",
    nameEn: "Lavender",
    isDark: false,
    background: {
      kind: "linearGradient",
      angle: 160,
      stops: [
        { color: colorFromHex("#E9E4FF"), location: 0 },
        { color: colorFromHex("#F7F5FF"), location: 0.55 },
        { color: colorFromHex("#FFFFFF"), location: 1 },
      ],
    },
    headlineColor: colorFromHex("#2E1065"),
    subheadColor: colorFromHex("#6D28D9"),
    previewCss: "linear-gradient(160deg, #E9E4FF 0%, #F7F5FF 55%, #FFFFFF 100%)",
  },
  ocean: {
    id: "ocean",
    nameZh: "深邃海洋",
    nameEn: "Ocean",
    isDark: true,
    background: {
      kind: "linearGradient",
      angle: 160,
      stops: [
        { color: colorFromHex("#0EA5E9"), location: 0 },
        { color: colorFromHex("#2563EB"), location: 1 },
      ],
    },
    headlineColor: colorFromHex("#FFFFFF"),
    subheadColor: colorFromHex("#E0F2FE"),
    previewCss: "linear-gradient(160deg, #0EA5E9 0%, #2563EB 100%)",
  },
  ember: {
    id: "ember",
    nameZh: "烈火余烬",
    nameEn: "Ember",
    isDark: true,
    background: {
      kind: "linearGradient",
      angle: 160,
      stops: [
        { color: colorFromHex("#F97316"), location: 0 },
        { color: colorFromHex("#DC2626"), location: 1 },
      ],
    },
    headlineColor: colorFromHex("#FFFFFF"),
    subheadColor: colorFromHex("#FEE2E2"),
    previewCss: "linear-gradient(160deg, #F97316 0%, #DC2626 100%)",
  },
  sunset: {
    id: "sunset",
    nameZh: "暮光霞落",
    nameEn: "Sunset",
    isDark: true,
    background: {
      kind: "linearGradient",
      angle: 160,
      stops: [
        { color: colorFromHex("#F59E0B"), location: 0 },
        { color: colorFromHex("#EF4444"), location: 0.55 },
        { color: colorFromHex("#7C3AED"), location: 1 },
      ],
    },
    headlineColor: colorFromHex("#FFFFFF"),
    subheadColor: colorFromHex("#FED7AA"),
    previewCss: "linear-gradient(160deg, #F59E0B 0%, #EF4444 55%, #7C3AED 100%)",
  },
  midnight: {
    id: "midnight",
    nameZh: "午夜沉夜",
    nameEn: "Midnight",
    isDark: true,
    background: {
      kind: "linearGradient",
      angle: 160,
      stops: [
        { color: colorFromHex("#1E293B"), location: 0 },
        { color: colorFromHex("#0F172A"), location: 1 },
      ],
    },
    headlineColor: colorFromHex("#FFFFFF"),
    subheadColor: colorFromHex("#D9E1EA"),
    previewCss: "linear-gradient(160deg, #1E293B 0%, #0F172A 100%)",
  },
  graphite: {
    id: "graphite",
    nameZh: "石墨炭灰",
    nameEn: "Graphite",
    isDark: true,
    background: {
      kind: "linearGradient",
      angle: 160,
      stops: [
        { color: colorFromHex("#3F3F46"), location: 0 },
        { color: colorFromHex("#18181B"), location: 1 },
      ],
    },
    headlineColor: colorFromHex("#FFFFFF"),
    subheadColor: colorFromHex("#E4E4E7"),
    previewCss: "linear-gradient(160deg, #3F3F46 0%, #18181B 100%)",
  },
  "pure-white": {
    id: "pure-white",
    nameZh: "极简纯白",
    nameEn: "Pure White",
    isDark: false,
    background: { kind: "solid", color: colorFromHex("#FFFFFF") },
    headlineColor: colorFromHex("#0E1B2A"),
    subheadColor: colorFromHex("#5A6A7D"),
    previewCss: "#FFFFFF",
  },
  "pure-black": {
    id: "pure-black",
    nameZh: "深邃黑夜",
    nameEn: "Pure Black",
    isDark: true,
    background: { kind: "solid", color: colorFromHex("#000000") },
    headlineColor: colorFromHex("#FFFFFF"),
    subheadColor: colorFromHex("#A1A1AA"),
    previewCss: "#000000",
  },
}

export const DEFAULT_GOLDIE_THEME_ID: GoldieThemeId = "arctic"

export const GOLDIE_BACKGROUND: BackgroundFill = GOLDIE_THEMES.arctic.background
export const GOLDIE_HEADLINE_COLOR = GOLDIE_THEMES.arctic.headlineColor
export const GOLDIE_SUBHEAD_COLOR = GOLDIE_THEMES.arctic.subheadColor

export function getGoldieTheme(id?: string | null): GoldieTheme {
  if (id && id in GOLDIE_THEMES) {
    return GOLDIE_THEMES[id as GoldieThemeId]
  }
  return GOLDIE_THEMES[DEFAULT_GOLDIE_THEME_ID]
}

export function isPanoramaCanvas(
  input: { width: number; height: number } | { canvasLogicalSize: { width: number; height: number } }
): boolean {
  const size = "canvasLogicalSize" in input ? input.canvasLogicalSize : input
  if (!size.width || !size.height) return false
  const ratio = size.width / size.height
  // 标准 App Store 截图比例约为 1:2.17，span 2 全景图宽高比约为 0.92 (2640/2868 或 2568/2778)
  return ratio > 0.8 && ratio < 1.1 && size.width > 2000
}

const single = (
  d: Partial<GoldieDevicePlacement> & Pick<GoldieDevicePlacement, "x" | "y">
): GoldieDevicePlacement[] => [
  { widthRatio: 0.84, rotate: 0, capture: "primary", ...d },
]

export const GOLDIE_LAYOUTS: Record<GoldieLayoutKey, GoldieLayoutSpec> = {
  classic: {
    key: "classic",
    label: "Classic",
    description: "Centred copy above a centred device.",
    span: 1,
    copy: { position: "top", align: "center" },
    devices: single({ x: 0.5, y: 0.5, fitBelowCopy: true }),
  },
  "copy-below": {
    key: "copy-below",
    label: "Copy below",
    description: "Device hanging from the top edge, copy underneath.",
    span: 1,
    copy: { position: "bottom", align: "center", heightRatio: 0.24 },
    devices: single({ widthRatio: 0.84, x: 0.5, y: 0.34 }),
  },
  hero: {
    key: "hero",
    label: "Hero",
    description: "Copy on top, a large device running off the bottom.",
    span: 1,
    copy: { position: "top", align: "center", heightRatio: 0.24 },
    devices: single({ widthRatio: 0.95, x: 0.5, y: 0.74 }),
  },
  offset: {
    key: "offset",
    label: "Offset",
    description: "Left-aligned copy, device pushed to the bottom right.",
    span: 1,
    copy: { position: "top", align: "left", heightRatio: 0.26 },
    devices: single({ widthRatio: 0.9, x: 0.62, y: 0.76 }),
  },
  tilt: {
    key: "tilt",
    label: "Tilt",
    description: "Copy on top, device tilted and running off the bottom.",
    span: 1,
    copy: { position: "top", align: "center", heightRatio: 0.24 },
    devices: single({ widthRatio: 0.9, x: 0.5, y: 0.75, rotate: -8 }),
  },
  "tilt-right": {
    key: "tilt-right",
    label: "Tilt right",
    description: "Left-aligned copy, device tilted into the bottom right corner.",
    span: 1,
    copy: { position: "top", align: "left", heightRatio: 0.26 },
    devices: single({ widthRatio: 0.9, x: 0.64, y: 0.78, rotate: 10 }),
  },
  duo: {
    key: "duo",
    label: "Duo",
    description: "Two screens: a smaller one behind on the left, the main one in front.",
    span: 1,
    copy: { position: "top", align: "center", heightRatio: 0.24 },
    devices: [
      { widthRatio: 0.62, x: 0.3, y: 0.62, rotate: 0, capture: "secondary" },
      { widthRatio: 0.7, x: 0.64, y: 0.72, rotate: 0, capture: "primary" },
    ],
  },
  "duo-tilt": {
    key: "duo-tilt",
    label: "Duo tilt",
    description: "Two tilted screens stepping down diagonally.",
    span: 1,
    copy: { position: "top", align: "center", heightRatio: 0.24 },
    devices: [
      { widthRatio: 0.64, x: 0.3, y: 0.6, rotate: -6, capture: "secondary" },
      { widthRatio: 0.7, x: 0.66, y: 0.74, rotate: -6, capture: "primary" },
    ],
  },
  panorama: {
    key: "panorama",
    label: "Panorama",
    description: "Two tiles: copy on the left, one big tilted device across the seam.",
    span: 2,
    copy: {
      position: "top",
      align: "left",
      heightRatio: 0.3,
      x: 0.045,
      widthRatio: 0.86,
    },
    devices: single({ widthRatio: 1.1, x: 0.56, y: 0.7, rotate: -10 }),
  },
  "panorama-duo": {
    key: "panorama-duo",
    label: "Panorama duo",
    description: "Two tiles sharing one headline, a screen on each side leaning inward.",
    span: 2,
    copy: { position: "top", align: "center", heightRatio: 0.24, widthRatio: 1.6 },
    devices: [
      { widthRatio: 0.8, x: 0.27, y: 0.7, rotate: 6, capture: "primary" },
      { widthRatio: 0.8, x: 0.73, y: 0.7, rotate: -6, capture: "secondary" },
    ],
  },
  minimal: {
    key: "minimal",
    label: "Minimal",
    description: "No copy, just the device, large and centred.",
    span: 1,
    copy: { position: "none", align: "center" },
    devices: single({ widthRatio: 0.92, x: 0.5, y: 0.5 }),
  },
}

export const GOLDIE_SETS: Record<
  GoldieSetKey,
  { key: GoldieSetKey; label: string; description: string; sequence: GoldieLayoutKey[] }
> = {
  editorial: {
    key: "editorial",
    label: "Editorial",
    description: "A panorama opener, then a hero, an offset, a breather and a tilt.",
    sequence: ["panorama", "hero", "offset", "minimal", "tilt"],
  },
  showcase: {
    key: "showcase",
    label: "Showcase",
    description: "Hero first, then tilted and paired screens, ending on a breather.",
    sequence: ["hero", "tilt", "duo", "tilt-right", "minimal"],
  },
  magazine: {
    key: "magazine",
    label: "Magazine",
    description: "Left-aligned copy and copy-below tiles alternating with big devices.",
    sequence: ["offset", "copy-below", "tilt-right", "hero", "minimal"],
  },
  storyboard: {
    key: "storyboard",
    label: "Storyboard",
    description: "A two-screen panorama, then a copy-below, a hero and a breather.",
    sequence: ["panorama-duo", "copy-below", "hero", "minimal", "tilt"],
  },
  dynamic: {
    key: "dynamic",
    label: "Dynamic",
    description: "Everything tilted: a tilt, a tilted pair, a panorama, a breather.",
    sequence: ["tilt", "duo-tilt", "panorama", "minimal", "tilt-right"],
  },
  minimalist: {
    key: "minimalist",
    label: "Minimalist",
    description: "Clean and elegant: begins and ends with spacious breathable frames.",
    sequence: ["minimal", "classic", "hero", "offset", "minimal"],
  },
  "feature-focus": {
    key: "feature-focus",
    label: "Feature Focus",
    description: "Multi-screen flow highlighting key features with dual and hero devices.",
    sequence: ["hero", "duo", "copy-below", "duo-tilt", "classic"],
  },
  "panorama-flow": {
    key: "panorama-flow",
    label: "Panorama Flow",
    description: "Dual panoramic experience with maximum visual impact across screens.",
    sequence: ["panorama", "tilt", "panorama-duo", "hero", "minimal"],
  },
  "bold-diagonal": {
    key: "bold-diagonal",
    label: "Bold Diagonal",
    description: "High tension angles and tilted screens creating a modern punchy look.",
    sequence: ["tilt-right", "hero", "duo-tilt", "offset", "classic"],
  },
  "app-preview": {
    key: "app-preview",
    label: "App Tour",
    description: "Classic app tour: centered intro, feature below, paired screens, hero finale.",
    sequence: ["classic", "copy-below", "duo", "hero", "tilt-right"],
  },
}

export const GOLDIE_LAYOUT_I18N: Record<
  GoldieLayoutKey,
  { nameZh: string; nameEn: string; descriptionZh: string; descriptionEn: string }
> = {
  classic: {
    nameZh: "经典居中",
    nameEn: "Classic",
    descriptionZh: "标题居中在上，设备在标题区下方居中铺满。",
    descriptionEn: GOLDIE_LAYOUTS.classic.description,
  },
  "copy-below": {
    nameZh: "文案在下",
    nameEn: "Copy below",
    descriptionZh: "设备从顶边垂下，标题和副标题落在下方。",
    descriptionEn: GOLDIE_LAYOUTS["copy-below"].description,
  },
  hero: {
    nameZh: "大图出血",
    nameEn: "Hero",
    descriptionZh: "上方文案，超大设备从底边出血。",
    descriptionEn: GOLDIE_LAYOUTS.hero.description,
  },
  offset: {
    nameZh: "左文右机",
    nameEn: "Offset",
    descriptionZh: "左对齐文案，设备推向右下角。",
    descriptionEn: GOLDIE_LAYOUTS.offset.description,
  },
  tilt: {
    nameZh: "左倾出血",
    nameEn: "Tilt",
    descriptionZh: "上方文案，设备微倾并从底部出血。",
    descriptionEn: GOLDIE_LAYOUTS.tilt.description,
  },
  "tilt-right": {
    nameZh: "右倾",
    nameEn: "Tilt right",
    descriptionZh: "左对齐文案，设备右倾探入右下角。",
    descriptionEn: GOLDIE_LAYOUTS["tilt-right"].description,
  },
  duo: {
    nameZh: "双机叠放",
    nameEn: "Duo",
    descriptionZh: "左后右前两台设备，主屏幕在前。",
    descriptionEn: GOLDIE_LAYOUTS.duo.description,
  },
  "duo-tilt": {
    nameZh: "双机斜向",
    nameEn: "Duo tilt",
    descriptionZh: "两台微倾设备沿对角线错开。",
    descriptionEn: GOLDIE_LAYOUTS["duo-tilt"].description,
  },
  panorama: {
    nameZh: "跨页全景",
    nameEn: "Panorama",
    descriptionZh: "宽画幅：左侧文案，一台大倾角设备跨过中缝。",
    descriptionEn: GOLDIE_LAYOUTS.panorama.description,
  },
  "panorama-duo": {
    nameZh: "跨页双机",
    nameEn: "Panorama duo",
    descriptionZh: "宽画幅共享标题，两侧设备向内倾斜。",
    descriptionEn: GOLDIE_LAYOUTS["panorama-duo"].description,
  },
  minimal: {
    nameZh: "无字留白",
    nameEn: "Minimal",
    descriptionZh: "没有文案，只放一台居中的大设备。",
    descriptionEn: GOLDIE_LAYOUTS.minimal.description,
  },
}

export const GOLDIE_SET_I18N: Record<
  GoldieSetKey,
  { nameZh: string; nameEn: string; descriptionZh: string; descriptionEn: string }
> = {
  editorial: {
    nameZh: "编辑风",
    nameEn: "Editorial",
    descriptionZh: "全景开场，再接大图、偏移、留白和倾斜。",
    descriptionEn: GOLDIE_SETS.editorial.description,
  },
  showcase: {
    nameZh: "展示风",
    nameEn: "Showcase",
    descriptionZh: "大图开头，倾斜与双机穿插，留白收尾。",
    descriptionEn: GOLDIE_SETS.showcase.description,
  },
  magazine: {
    nameZh: "杂志风",
    nameEn: "Magazine",
    descriptionZh: "左对齐与文案在下交替，穿插大设备。",
    descriptionEn: GOLDIE_SETS.magazine.description,
  },
  storyboard: {
    nameZh: "分镜风",
    nameEn: "Storyboard",
    descriptionZh: "双机全景开场，再接文案在下、大图和留白。",
    descriptionEn: GOLDIE_SETS.storyboard.description,
  },
  dynamic: {
    nameZh: "动感风",
    nameEn: "Dynamic",
    descriptionZh: "全程倾斜：单倾、双倾、全景、留白、右倾。",
    descriptionEn: GOLDIE_SETS.dynamic.description,
  },
  minimalist: {
    nameZh: "极简气质",
    nameEn: "Minimalist",
    descriptionZh: "清爽留白开场与收尾，突出产品高雅纯粹品质。",
    descriptionEn: GOLDIE_SETS.minimalist.description,
  },
  "feature-focus": {
    nameZh: "功能聚焦",
    nameEn: "Feature Focus",
    descriptionZh: "大图开场接双机穿插，全面呈现核心功能亮点。",
    descriptionEn: GOLDIE_SETS["feature-focus"].description,
  },
  "panorama-flow": {
    nameZh: "全景流动",
    nameEn: "Panorama Flow",
    descriptionZh: "双全景跨页组合，极具视觉张力与沉浸感。",
    descriptionEn: GOLDIE_SETS["panorama-flow"].description,
  },
  "bold-diagonal": {
    nameZh: "张力对角",
    nameEn: "Bold Diagonal",
    descriptionZh: "多角度大倾角斜向构图，营造强烈的现代动感。",
    descriptionEn: GOLDIE_SETS["bold-diagonal"].description,
  },
  "app-preview": {
    nameZh: "应用巡礼",
    nameEn: "App Tour",
    descriptionZh: "经典导览序列：居中开场、细节展开、双屏对比、大图收尾。",
    descriptionEn: GOLDIE_SETS["app-preview"].description,
  },
}

export function isGoldieLayoutKey(key: string): key is GoldieLayoutKey {
  return (GOLDIE_LAYOUT_KEYS as readonly string[]).includes(key)
}

export function isGoldieSetKey(key: string): key is GoldieSetKey {
  return (GOLDIE_SET_KEYS as readonly string[]).includes(key)
}

export type AppStoreDisplay = "65" | "69"

export const APP_STORE_DISPLAYS: Record<
  AppStoreDisplay,
  { aspect: Exclude<CanvasAspect, "custom">; size: Size; inches: string }
> = {
  "69": {
    aspect: "appStore69",
    size: CANVAS_ASPECT_SIZES.appStore69,
    inches: "6.9",
  },
  "65": {
    aspect: "appStore65",
    size: CANVAS_ASPECT_SIZES.appStore65,
    inches: "6.5",
  },
}

export function goldieCanvasForLayout(
  spec: GoldieLayoutSpec,
  display: AppStoreDisplay = "69"
): {
  aspect: CanvasAspect
  size: Size
} {
  const tile = APP_STORE_DISPLAYS[display].size
  if (spec.span === 2) {
    return {
      aspect: "custom",
      size: { width: tile.width * 2, height: tile.height },
    }
  }
  return { aspect: APP_STORE_DISPLAYS[display].aspect, size: { ...tile } }
}

export function goldieNeedsSecondCapture(spec: GoldieLayoutSpec): boolean {
  return spec.devices.some((device) => device.capture === "secondary")
}

export type GoldieTextSlot = {
  id: "headline" | "subhead"
  name: string
  textZh: string
  textEn: string
  transform: LayerTransform
  content: Partial<TextContent> & { string: string; fontSize: number }
}

export type GoldieComposeResult = {
  devices: Array<{
    transform: LayerTransform
    capture: "primary" | "secondary"
  }>
  texts: GoldieTextSlot[]
}

function weightFromCss(value: number): FontWeight {
  return value >= 700 ? "bold" : "regular"
}

function pocketLineSpacing(fontSize: number, goldieLineHeight: number): number {
  return fontSize * goldieLineHeight - fontSize * 1.25
}

export function composeGoldieLayout(
  spec: GoldieLayoutSpec,
  composition: Size,
  deviceBase: Size,
  options?: {
    theme?: GoldieTheme
  }
): GoldieComposeResult {
  const span = spec.span
  const tileW = composition.width / span
  const tileH = composition.height
  const isClassic = spec.key === "classic"
  const theme = options?.theme ?? GOLDIE_THEMES[DEFAULT_GOLDIE_THEME_ID]
  const headlineColor = theme.headlineColor
  const subheadColor = theme.subheadColor
  const copyHeight =
    spec.copy.position === "none"
      ? 0
      : tileH * (isClassic ? GOLDIE_CLASSIC_COPY_HEIGHT : (spec.copy.heightRatio ?? 0.24))

  const devices = spec.devices.map((placement) => {
    const widthRatio = isClassic ? GOLDIE_CLASSIC_DEVICE_WIDTH : placement.widthRatio
    let scale = (tileW * widthRatio) / Math.max(deviceBase.width, 1)
    let centerX = placement.x
    let centerY = placement.y
    if (placement.fitBelowCopy) {
      const bottomMargin = tileH * GOLDIE_CLASSIC_BOTTOM_MARGIN
      const available = Math.max(1, tileH - copyHeight - bottomMargin)
      scale = Math.min(scale, available / Math.max(deviceBase.height, 1))
      const top = copyHeight + (available - deviceBase.height * scale) / 2
      centerX = 0.5
      centerY = (top + (deviceBase.height * scale) / 2) / tileH
    }
    return {
      capture: placement.capture,
      transform: {
        center: { x: centerX, y: centerY },
        scale: clamp(scale, SCALE_RANGE.min, SCALE_RANGE.max),
        rotation: (placement.rotate * Math.PI) / 180,
      },
    }
  })

  const texts: GoldieTextSlot[] = []
  if (spec.copy.position !== "none") {
    const padX = tileW * GOLDIE_TYPE.padX
    const maxWidth = spec.copy.widthRatio
      ? tileW * spec.copy.widthRatio
      : Math.max(8, tileW - 2 * padX)
    const align: TextAlign = spec.copy.align === "left" ? "leading" : "center"
    const anchorX =
      spec.copy.x !== undefined
        ? composition.width * spec.copy.x
        : spec.copy.align === "left"
          ? padX
          : composition.width / 2
    const centerX =
      spec.copy.align === "left"
        ? (anchorX + maxWidth / 2) / composition.width
        : anchorX / composition.width

    const headlineSize = tileW * GOLDIE_TYPE.headlineSize
    const subheadSize = tileW * GOLDIE_TYPE.subheadSize
    const headlineBox = headlineSize * GOLDIE_TYPE.headlineLineHeight
    const subheadBox = subheadSize * GOLDIE_TYPE.subheadLineHeight
    const padTop = tileH * GOLDIE_TYPE.padTop
    const padBottom = tileH * GOLDIE_TYPE.padBottom
    // Pin headline to the top of the copy band and subhead to the bottom so
    // wrapped headlines still leave room instead of colliding on the first line.
    const headlineY =
      spec.copy.position === "top"
        ? padTop + headlineBox / 2
        : tileH - copyHeight + padTop + headlineBox / 2
    const subheadY =
      spec.copy.position === "top"
        ? copyHeight - padBottom * 0.35 - subheadBox / 2
        : tileH - padBottom - subheadBox / 2

    const headline: GoldieTextSlot = {
      id: "headline",
      name: "Headline",
      textZh: "突出核心卖点",
      textEn: "Benefit-led headline",
      transform: {
        center: { x: centerX, y: headlineY / composition.height },
        scale: 1,
        rotation: 0,
      },
      content: {
        string: "突出核心卖点",
        fontSize: headlineSize,
        fontName: GOLDIE_DEFAULT_FONT,
        weight: weightFromCss(GOLDIE_TYPE.headlineWeight),
        color: headlineColor,
        alignment: align,
        kerning: tileW * GOLDIE_TYPE.headlineTracking,
        lineSpacing: pocketLineSpacing(headlineSize, GOLDIE_TYPE.headlineLineHeight),
        boxWidth: maxWidth,
      },
    }
    const subhead: GoldieTextSlot = {
      id: "subhead",
      name: "Subhead",
      textZh: "一句补充说明，把价值讲清楚。",
      textEn: "One short sentence expanding the headline.",
      transform: {
        center: {
          x: centerX,
          y: subheadY / composition.height,
        },
        scale: 1,
        rotation: 0,
      },
      content: {
        string: "一句补充说明，把价值讲清楚。",
        fontSize: subheadSize,
        fontName: GOLDIE_DEFAULT_FONT,
        weight: weightFromCss(GOLDIE_TYPE.subheadWeight),
        color: subheadColor,
        alignment: align,
        kerning: 0,
        lineSpacing: pocketLineSpacing(subheadSize, GOLDIE_TYPE.subheadLineHeight),
        boxWidth: maxWidth,
      },
    }
    texts.push(headline, subhead)
  }

  return { devices, texts }
}
