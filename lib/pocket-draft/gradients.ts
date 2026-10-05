import { colorFromHex, type GradientStop } from "@/lib/pocket-draft/models"

function stops(a: string, b: string, c?: string): GradientStop[] {
  if (c) {
    return [
      { color: colorFromHex(a), location: 0 },
      { color: colorFromHex(b), location: 0.5 },
      { color: colorFromHex(c), location: 1 },
    ]
  }
  return [
    { color: colorFromHex(a), location: 0 },
    { color: colorFromHex(b), location: 1 },
  ]
}

export type GradientCategory = "all" | "minimal" | "vibrant" | "dark" | "radial"

export type GradientPreset = {
  id: string
  nameZh: string
  nameEn: string
  category: "minimal" | "vibrant" | "dark" | "radial"
  kind: "linear" | "radial"
  angle: number
  stops: GradientStop[]
}

export const GRADIENT_PRESETS: GradientPreset[] = [
  // 浅色与极简 (minimal)
  { id: "paper", nameZh: "素纸", nameEn: "Paper", category: "minimal", kind: "linear", angle: 180, stops: stops("#f8fafc", "#e2e8f0") },
  { id: "ivory", nameZh: "暖白", nameEn: "Warm Ivory", category: "minimal", kind: "linear", angle: 135, stops: stops("#fff7ed", "#fed7aa") },
  { id: "mist", nameZh: "晨雾", nameEn: "Morning Mist", category: "minimal", kind: "linear", angle: 160, stops: stops("#f0fdf4", "#dcfce7") },
  { id: "ice-blue", nameZh: "冰蓝", nameEn: "Ice Blue", category: "minimal", kind: "linear", angle: 145, stops: stops("#f0f9ff", "#e0f2fe") },
  { id: "lavender-soft", nameZh: "薰衣草", nameEn: "Soft Lavender", category: "minimal", kind: "linear", angle: 135, stops: stops("#faf5ff", "#f3e8ff") },

  // 活力与高饱和 (vibrant)
  { id: "ocean", nameZh: "深邃海洋", nameEn: "Ocean", category: "vibrant", kind: "linear", angle: 135, stops: stops("#0ea5e9", "#0369a1") },
  { id: "azure", nameZh: "蔚蓝天空", nameEn: "Azure", category: "vibrant", kind: "linear", angle: 160, stops: stops("#38bdf8", "#2563eb") },
  { id: "indigo", nameZh: "极光靛青", nameEn: "Indigo", category: "vibrant", kind: "linear", angle: 150, stops: stops("#6366f1", "#312e81") },
  { id: "violet", nameZh: "暗夜罗兰", nameEn: "Violet", category: "vibrant", kind: "linear", angle: 140, stops: stops("#a78bfa", "#6d28d9") },
  { id: "pink", nameZh: "樱花绯红", nameEn: "Pink Blossom", category: "vibrant", kind: "linear", angle: 120, stops: stops("#fb7185", "#db2777") },
  { id: "sunset", nameZh: "日落余晖", nameEn: "Sunset", category: "vibrant", kind: "linear", angle: 30, stops: stops("#fb923c", "#ec4899") },
  { id: "mango", nameZh: "芒果暖橙", nameEn: "Mango Heat", category: "vibrant", kind: "linear", angle: 45, stops: stops("#f59e0b", "#ef4444") },
  { id: "aurora", nameZh: "北极光", nameEn: "Aurora", category: "vibrant", kind: "linear", angle: 120, stops: stops("#22d3ee", "#a855f7", "#f472b6") },
  { id: "mint", nameZh: "清凉薄荷", nameEn: "Cool Mint", category: "vibrant", kind: "linear", angle: 150, stops: stops("#5eead4", "#0f766e") },
  { id: "cosmic", nameZh: "宇宙光芒", nameEn: "Cosmic Glow", category: "vibrant", kind: "linear", angle: 155, stops: stops("#243D65", "#D66A2C") },

  // 深色与高冷 (dark)
  { id: "midnight", nameZh: "午夜蓝黑", nameEn: "Midnight", category: "dark", kind: "linear", angle: 160, stops: stops("#0f172a", "#1e293b") },
  { id: "graphite", nameZh: "石墨炭灰", nameEn: "Graphite", category: "dark", kind: "linear", angle: 180, stops: stops("#111827", "#374151") },
  { id: "obsidian", nameZh: "黑曜石", nameEn: "Obsidian", category: "dark", kind: "linear", angle: 135, stops: stops("#090a0f", "#181a20") },
  { id: "dusk", nameZh: "暮光深紫", nameEn: "Dusk Velvet", category: "dark", kind: "linear", angle: 200, stops: stops("#1e1b4b", "#9d174d") },
  { id: "cyber-dark", nameZh: "赛博幽绿", nameEn: "Cyber Pine", category: "dark", kind: "linear", angle: 180, stops: stops("#062018", "#123f31") },

  // 径向光晕 (radial)
  { id: "peach-radial", nameZh: "蜜桃光晕", nameEn: "Peach Glow", category: "radial", kind: "radial", angle: 0, stops: stops("#fed7aa", "#fb7185") },
  { id: "glow-radial", nameZh: "星云紫光", nameEn: "Nebula Glow", category: "radial", kind: "radial", angle: 0, stops: stops("#fde68a", "#7c3aed") },
  { id: "ice-radial", nameZh: "冰核透光", nameEn: "Ice Core", category: "radial", kind: "radial", angle: 0, stops: stops("#e0f2fe", "#1d4ed8") },
  { id: "halo-radial", nameZh: "珍珠光环", nameEn: "Pearl Halo", category: "radial", kind: "radial", angle: 0, stops: stops("#ffffff", "#94a3b8") },
  { id: "ember-radial", nameZh: "余烬聚光", nameEn: "Ember Spot", category: "radial", kind: "radial", angle: 0, stops: stops("#fecaca", "#7f1d1d") },
]

export type SwatchGroup = {
  id: string
  labelZh: string
  labelEn: string
  colors: { hex: string; nameZh: string; nameEn: string }[]
}

export const SWATCH_GROUPS: SwatchGroup[] = [
  {
    id: "neutrals",
    labelZh: "经典黑白与中性色",
    labelEn: "Classic Neutrals",
    colors: [
      { hex: "#FFFFFF", nameZh: "纯白", nameEn: "Pure White" },
      { hex: "#F5F5F7", nameZh: "苹果灰白", nameEn: "Apple Gray" },
      { hex: "#E8E8ED", nameZh: "浅灰", nameEn: "Soft Silver" },
      { hex: "#FAF7F2", nameZh: "羊脂白", nameEn: "Ivory" },
      { hex: "#94A3B8", nameZh: "板岩灰", nameEn: "Slate" },
      { hex: "#334155", nameZh: "深石墨", nameEn: "Dark Slate" },
      { hex: "#1D1D1F", nameZh: "太空黑", nameEn: "Space Black" },
      { hex: "#000000", nameZh: "纯黑", nameEn: "Pure Black" },
    ],
  },
  {
    id: "apple_finishes",
    labelZh: "iPhone 17 & Air 机身原色",
    labelEn: "Apple Device Finishes",
    colors: [
      { hex: "#E8DFD1", nameZh: "浅金色", nameEn: "Light Gold" },
      { hex: "#AFC7DB", nameZh: "天蓝色", nameEn: "Sky Blue" },
      { hex: "#F0EFF4", nameZh: "云白色", nameEn: "Cloud White" },
      { hex: "#D66A2C", nameZh: "宇宙橙", nameEn: "Cosmic Orange" },
      { hex: "#243D65", nameZh: "深海蓝", nameEn: "Deep Blue" },
      { hex: "#8FA8C8", nameZh: "钛金属银", nameEn: "Natural Titanium" },
      { hex: "#9BA994", nameZh: "鼠尾草绿", nameEn: "Sage Green" },
      { hex: "#B7A7CF", nameZh: "薰衣草紫", nameEn: "Lavender" },
    ],
  },
  {
    id: "accents",
    labelZh: "设计高亮与流行色",
    labelEn: "Modern Accent Palette",
    colors: [
      { hex: "#0071E3", nameZh: "经典蓝", nameEn: "Apple Blue" },
      { hex: "#2563EB", nameZh: "电光蓝", nameEn: "Electric Blue" },
      { hex: "#7C3AED", nameZh: "高贵紫", nameEn: "Royal Violet" },
      { hex: "#DB2777", nameZh: "火烈鸟粉", nameEn: "Flamingo Pink" },
      { hex: "#EA580C", nameZh: "赤橙色", nameEn: "Sunset Orange" },
      { hex: "#CA8A04", nameZh: "琥珀黄", nameEn: "Amber Gold" },
      { hex: "#16A34A", nameZh: "翡翠绿", nameEn: "Emerald" },
      { hex: "#0F766E", nameZh: "孔雀青", nameEn: "Teal Green" },
    ],
  },
]

export const SOLID_SWATCHES: string[] = SWATCH_GROUPS.flatMap((g) =>
  g.colors.map((c) => c.hex)
)
