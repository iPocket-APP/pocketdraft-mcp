export type FontCategory = "sans" | "serif" | "rounded" | "mono" | "display" | "local"

export type FontLanguage = "all" | "zh" | "en" | "ja" | "ko"

export type DraftFont = {
  id: string
  nameZh: string
  nameEn: string
  category: FontCategory
  languages: FontLanguage[]
  css: string
  isLocal?: boolean
  bundled?: boolean
}

export const FONT_SAMPLE_TEXT: Record<FontLanguage, string> = {
  all: "极简设计 PocketDraft 123",
  zh: "极简设计 · 随心而作 123",
  en: "Crafting beautiful designs 123",
  ja: "美しいグラフィックデザイン 123",
  ko: "아름다운 그래픽 디자인 123",
}

const CJK_FALLBACK = '"PingFang SC", "Noto Sans SC", "Microsoft YaHei"'

const GOLDIE_FONTS: DraftFont[] = [
  {
    id: "merriweather",
    nameZh: "Merriweather",
    nameEn: "Merriweather",
    category: "serif",
    languages: ["en"],
    css: `"Merriweather", ${CJK_FALLBACK}, Georgia, serif`,
    bundled: true,
  },
  {
    id: "dm-sans",
    nameZh: "DM Sans",
    nameEn: "DM Sans",
    category: "sans",
    languages: ["en"],
    css: `"DM Sans", ${CJK_FALLBACK}, system-ui, sans-serif`,
    bundled: true,
  },
  {
    id: "lato",
    nameZh: "Lato",
    nameEn: "Lato",
    category: "sans",
    languages: ["en"],
    css: `"Lato", ${CJK_FALLBACK}, system-ui, sans-serif`,
    bundled: true,
  },
  {
    id: "montserrat",
    nameZh: "Montserrat",
    nameEn: "Montserrat",
    category: "sans",
    languages: ["en"],
    css: `"Montserrat", ${CJK_FALLBACK}, system-ui, sans-serif`,
    bundled: true,
  },
  {
    id: "dm-mono",
    nameZh: "DM Mono",
    nameEn: "DM Mono",
    category: "mono",
    languages: ["en"],
    css: `"DM Mono", ${CJK_FALLBACK}, ui-monospace, Menlo, monospace`,
    bundled: true,
  },
]

export const PRESET_FONTS: DraftFont[] = [
  // 1. 无衬线 / 黑体 (Sans-Serif)
  {
    id: "system-sans",
    nameZh: "系统默认黑体",
    nameEn: "System Default",
    category: "sans",
    languages: ["zh", "en"],
    css: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  },
  ...GOLDIE_FONTS,
  {
    id: "pingfang",
    nameZh: "苹方 (PingFang SC)",
    nameEn: "PingFang SC",
    category: "sans",
    languages: ["zh", "en"],
    css: '"PingFang SC", -apple-system, "SF Pro Display", "Microsoft YaHei", sans-serif',
  },
  {
    id: "sf-pro",
    nameZh: "Apple San Francisco",
    nameEn: "SF Pro Display",
    category: "sans",
    languages: ["en"],
    css: '"SF Pro Display", -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
  },
  {
    id: "noto-sans-sc",
    nameZh: "思源黑体",
    nameEn: "Source Han Sans",
    category: "sans",
    languages: ["zh", "en"],
    css: '"Source Han Sans SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  {
    id: "yahei",
    nameZh: "微软雅黑",
    nameEn: "Microsoft YaHei",
    category: "sans",
    languages: ["zh", "en"],
    css: '"Microsoft YaHei", "PingFang SC", sans-serif',
  },
  {
    id: "helvetica",
    nameZh: "Helvetica / Arial",
    nameEn: "Helvetica",
    category: "sans",
    languages: ["en"],
    css: '"Helvetica Neue", Helvetica, Arial, "PingFang SC", sans-serif',
  },
  {
    id: "impact",
    nameZh: "Impact 紧凑粗体",
    nameEn: "Impact",
    category: "sans",
    languages: ["en"],
    css: 'Impact, "SF Pro Display", "PingFang SC", sans-serif',
  },

  // 2. 衬线 / 宋体 (Serif)
  {
    id: "songti",
    nameZh: "华文宋体 / 宋体",
    nameEn: "Songti SC",
    category: "serif",
    languages: ["zh", "en"],
    css: '"Songti SC", "SimSun", "STSong", "Source Han Serif SC", serif',
  },
  {
    id: "noto-serif-sc",
    nameZh: "思源宋体",
    nameEn: "Source Han Serif",
    category: "serif",
    languages: ["zh", "en"],
    css: '"Source Han Serif SC", "Noto Serif SC", "Songti SC", serif',
  },
  {
    id: "kaiti",
    nameZh: "楷体 (Kaiti)",
    nameEn: "KaiTi SC",
    category: "serif",
    languages: ["zh", "en"],
    css: '"Kaiti SC", "STKaiti", "KaiTi", "Songti SC", serif',
  },
  {
    id: "new-york",
    nameZh: "New York / Georgia",
    nameEn: "New York",
    category: "serif",
    languages: ["en"],
    css: '"New York", Georgia, "Times New Roman", "Songti SC", serif',
  },
  {
    id: "times",
    nameZh: "Times New Roman",
    nameEn: "Times New Roman",
    category: "serif",
    languages: ["en"],
    css: '"Times New Roman", Times, "Songti SC", serif',
  },

  // 3. 圆体 (Rounded)
  {
    id: "sf-rounded",
    nameZh: "Apple SF Rounded",
    nameEn: "SF Pro Rounded",
    category: "rounded",
    languages: ["en"],
    css: '"SF Pro Rounded", ui-rounded, "PingFang SC", sans-serif',
  },
  {
    id: "yuanti",
    nameZh: "圆体-简 (Yuanti)",
    nameEn: "Yuanti SC",
    category: "rounded",
    languages: ["zh", "en"],
    css: '"Yuanti SC", "YouYuan", "SF Pro Rounded", "PingFang SC", sans-serif',
  },

  // 4. 等宽 / 代码 (Monospace)
  {
    id: "sf-mono",
    nameZh: "Apple SF Mono",
    nameEn: "SF Mono",
    category: "mono",
    languages: ["en"],
    css: '"SF Mono", SFMono-Regular, "Cascadia Code", Menlo, monospace',
  },
  {
    id: "menlo",
    nameZh: "Menlo / Monaco",
    nameEn: "Menlo",
    category: "mono",
    languages: ["en"],
    css: 'Menlo, Monaco, Consolas, "Courier New", monospace',
  },
  {
    id: "cascadia",
    nameZh: "Cascadia Code",
    nameEn: "Cascadia Code",
    category: "mono",
    languages: ["en"],
    css: '"Cascadia Code", "SF Mono", Consolas, monospace',
  },

  // 5. 艺术 / 手写 (Display)
  {
    id: "xingkai",
    nameZh: "华文行楷",
    nameEn: "STXingkai",
    category: "display",
    languages: ["zh", "en"],
    css: '"STXingkai", "Xingkai SC", "Kaiti SC", cursive',
  },
]

export const FONT_WEIGHT_CSS: Record<string, number> = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
}

const BINARY_WEIGHT_FONT_IDS = new Set([
  "merriweather",
  "dm-sans",
  "lato",
  "montserrat",
  "noto-sans-sc",
])

function resolveFont(idOrFamily: string): DraftFont | undefined {
  const lower = idOrFamily.toLowerCase()
  return allAvailableFonts().find(
    (font) =>
      font.id === idOrFamily ||
      font.nameEn.toLowerCase() === lower ||
      font.nameZh.toLowerCase() === lower
  )
}

export function fontWeightValue(fontName: string, weight: string): number {
  const font = resolveFont(fontName)
  if (font?.id === "dm-mono") {
    return weight === "regular" ? 400 : 500
  }
  if (font && BINARY_WEIGHT_FONT_IDS.has(font.id)) {
    return weight === "regular" || weight === "medium" ? 400 : 700
  }
  return FONT_WEIGHT_CSS[weight] ?? 600
}

let localFontsCache: DraftFont[] = []

export function getLocalFontsCache(): DraftFont[] {
  if (localFontsCache.length > 0) return localFontsCache
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem("pocket_draft_local_fonts")
      if (stored) {
        localFontsCache = JSON.parse(stored) as DraftFont[]
      }
    } catch {
      // Ignore storage error
    }
  }
  return localFontsCache
}

export function saveLocalFontsCache(fonts: DraftFont[]) {
  localFontsCache = fonts
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("pocket_draft_local_fonts", JSON.stringify(fonts))
    } catch {
      // Ignore storage error
    }
  }
}

function detectFontLanguages(name: string): FontLanguage[] {
  const lower = name.toLowerCase()
  const hasChinese =
    /[\u4e00-\u9fa5]/.test(name) ||
    lower.includes("sc") ||
    lower.includes("tc") ||
    lower.includes("pingfang") ||
    lower.includes("song") ||
    lower.includes("hei") ||
    lower.includes("kai") ||
    lower.includes("yuan") ||
    lower.includes("ming") ||
    lower.includes("gothic") ||
    lower.includes("source han") ||
    lower.includes("noto sans cjk") ||
    lower.includes("noto serif cjk") ||
    lower.includes("yahei") ||
    lower.includes("simsun") ||
    lower.includes("kaiti")

  const hasJapanese =
    lower.includes("hiragino") ||
    lower.includes("meiryo") ||
    lower.includes("mincho") ||
    lower.includes("japanese") ||
    lower.includes("jp")

  const hasKorean =
    lower.includes("malgun") ||
    lower.includes("nanum") ||
    lower.includes("hangul") ||
    lower.includes("korean") ||
    lower.includes("kr")

  const langs: FontLanguage[] = ["en"]
  if (hasChinese) langs.unshift("zh")
  if (hasJapanese) langs.unshift("ja")
  if (hasKorean) langs.unshift("ko")
  return langs
}

/**
 * Request Local Fonts from Browser API (Chrome 103+ / Edge)
 */
export async function queryLocalSystemFonts(): Promise<DraftFont[]> {
  if (typeof window === "undefined" || !("queryLocalFonts" in window)) {
    return []
  }
  try {
    // @ts-expect-error queryLocalFonts is a modern Web API
    const available = await window.queryLocalFonts()
    const families = new Set<string>()
    const localFonts: DraftFont[] = []

    for (const font of available) {
      if (!families.has(font.family)) {
        families.add(font.family)
        localFonts.push({
          id: `local-${font.family.toLowerCase().replace(/\s+/g, "-")}`,
          nameZh: font.family,
          nameEn: font.family,
          category: "local",
          languages: detectFontLanguages(font.family),
          css: `"${font.family}", -apple-system, sans-serif`,
          isLocal: true,
        })
      }
    }

    // Sort alphabetically
    localFonts.sort((a, b) => a.nameEn.localeCompare(b.nameEn))
    saveLocalFontsCache(localFonts)
    return localFonts
  } catch {
    // User denied permission or not supported
    return []
  }
}

export function allAvailableFonts(): DraftFont[] {
  const local = getLocalFontsCache()
  return [...PRESET_FONTS, ...local]
}

export function fontCss(idOrFamily: string): string {
  // Check in presets
  const preset = PRESET_FONTS.find(
    (f) => f.id === idOrFamily || f.nameEn.toLowerCase() === idOrFamily.toLowerCase()
  )
  if (preset) return preset.css

  // Check in local cache
  const local = getLocalFontsCache().find(
    (f) => f.id === idOrFamily || f.nameEn.toLowerCase() === idOrFamily.toLowerCase()
  )
  if (local) return local.css

  // Fallback to directly treating as font family name
  return `"${idOrFamily}", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`
}

export function canvasFont(
  fontName: string,
  fontSize: number,
  weight: string
): string {
  const weightValue = fontWeightValue(fontName, weight)
  const family = fontCss(fontName)
  return `${weightValue} ${fontSize}px ${family}`
}
