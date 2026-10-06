import type { CanvasAspect, ProjectCanvas, Rect, Size } from "./models"

export const APP_STORE_ASSET_SOURCE =
  "https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications"
export const APP_STORE_GUIDE_SOURCE =
  "https://developer.apple.com/go/?id=sketch-creative-assets-templates"

export type AssetImageFormat = "png" | "jpeg"
export type AppStoreAssetSpec = {
  nameZh: string
  nameEn: string
  size: Size
  minimum: Size
  fixed: boolean
  formats: readonly AssetImageFormat[]
  opaque: boolean
  safeArea?: Rect
  maxBytes?: number
}

// Art Safe Area rectangles from Apple's Sketch template, verified 2026-10-07.
export const APP_STORE_ASSETS = {
  appStoreHeader: {
    nameZh: "产品页头图",
    nameEn: "Product page header",
    size: { width: 3840, height: 1646 },
    minimum: { width: 3840, height: 1646 },
    fixed: true,
    formats: ["png"],
    opaque: true,
    safeArea: { x: 1097, y: 493, width: 1646, height: 661 },
  },
  appStoreSearch: {
    nameZh: "搜索结果图",
    nameEn: "Search results",
    size: { width: 3840, height: 2560 },
    minimum: { width: 1920, height: 1280 },
    fixed: false,
    formats: ["png", "jpeg"],
    opaque: true,
    safeArea: { x: 836, y: 765, width: 2168, height: 1030 },
  },
  appStoreUniversal: {
    nameZh: "通用宣传图",
    nameEn: "Universal creative",
    size: { width: 5244, height: 2950 },
    minimum: { width: 5244, height: 2950 },
    fixed: true,
    formats: ["png"],
    opaque: true,
    safeArea: { x: 1921, y: 660, width: 1402, height: 962 },
  },
  appStoreEventCard: {
    nameZh: "活动卡片",
    nameEn: "In-App Event card",
    size: { width: 3840, height: 2160 },
    minimum: { width: 1920, height: 1080 },
    fixed: false,
    formats: ["png", "jpeg"],
    opaque: false,
    maxBytes: 500_000_000,
  },
  appStoreEventDetails: {
    nameZh: "活动详情图",
    nameEn: "In-App Event details",
    size: { width: 2160, height: 3840 },
    minimum: { width: 1080, height: 1920 },
    fixed: false,
    formats: ["png", "jpeg"],
    opaque: false,
    maxBytes: 500_000_000,
  },
} as const satisfies Record<string, AppStoreAssetSpec>
export type AppStoreAssetAspect = keyof typeof APP_STORE_ASSETS
export const APP_STORE_ASSET_ASPECTS = Object.keys(
  APP_STORE_ASSETS
) as AppStoreAssetAspect[]

export function appStoreAssetSpec(
  aspect: CanvasAspect
): AppStoreAssetSpec | undefined {
  return Object.hasOwn(APP_STORE_ASSETS, aspect)
    ? APP_STORE_ASSETS[aspect as AppStoreAssetAspect]
    : undefined
}

export function assetSizeIsValid(spec: AppStoreAssetSpec, size: Size): boolean {
  const { width: w, height: h } = size
  return (
    Number.isInteger(w) &&
    Number.isInteger(h) &&
    w >= spec.minimum.width &&
    h >= spec.minimum.height &&
    w <= spec.size.width &&
    h <= spec.size.height &&
    (spec.fixed
      ? w === spec.size.width && h === spec.size.height
      : w * spec.size.height === h * spec.size.width)
  )
}

export function assetSafeArea(
  canvas: Pick<ProjectCanvas, "canvasAspect" | "canvasLogicalSize">
): Rect | undefined {
  const spec = appStoreAssetSpec(canvas.canvasAspect)
  if (!spec?.safeArea) return
  const sx = canvas.canvasLogicalSize.width / spec.size.width,
    sy = canvas.canvasLogicalSize.height / spec.size.height
  return {
    x: spec.safeArea.x * sx,
    y: spec.safeArea.y * sy,
    width: spec.safeArea.width * sx,
    height: spec.safeArea.height * sy,
  }
}

export type AssetExportOptions = {
  scale: number
  format: AssetImageFormat
  transparentBackground?: boolean
  slices?: boolean
  region?: Rect
  showBounds?: boolean
}
export type AssetExportIssue = {
  code: string
  canvasId: string
  message: string
}
export function assetExportIssues(
  canvas: ProjectCanvas,
  options: AssetExportOptions
): AssetExportIssue[] {
  const spec = appStoreAssetSpec(canvas.canvasAspect)
  if (!spec) return []
  const issues: AssetExportIssue[] = []
  const add = (code: string, message: string) =>
    issues.push({ code, canvasId: canvas.id, message })
  const size = {
    width: Math.round(canvas.canvasLogicalSize.width * options.scale),
    height: Math.round(canvas.canvasLogicalSize.height * options.scale),
  }
  if (
    !assetSizeIsValid(spec, canvas.canvasLogicalSize) ||
    !Number.isFinite(options.scale) ||
    options.scale <= 0 ||
    !assetSizeIsValid(spec, size)
  )
    add(
      "asset_dimensions",
      `${spec.nameEn}: export must be ${spec.fixed ? `${spec.size.width}×${spec.size.height}` : `${spec.minimum.width}×${spec.minimum.height} – ${spec.size.width}×${spec.size.height}, with the original aspect ratio`}.`
    )
  if (!spec.formats.includes(options.format))
    add("asset_format", `${spec.nameEn} requires PNG.`)
  if (spec.opaque && options.transparentBackground)
    add(
      "asset_transparency",
      `${spec.nameEn} cannot contain transparency or an alpha channel.`
    )
  if (options.slices || options.region || options.showBounds)
    add(
      "asset_crop",
      "Creative assets must be exported in full without slices, regions or debug bounds."
    )
  return issues
}

export function assertAssetExport(
  canvas: ProjectCanvas,
  options: AssetExportOptions
) {
  const issue = assetExportIssues(canvas, options)[0]
  if (issue) throw new Error(`${issue.code}: ${issue.message}`)
}

export function commonAssetExportOptions(canvases: ProjectCanvas[]) {
  const hasAssets = canvases.some((c) => appStoreAssetSpec(c.canvasAspect))
  return {
    scales: (hasAssets ? [0.5, 1] : [1, 2, 3]).filter((scale) =>
      canvases.every(
        (c) => assetExportIssues(c, { scale, format: "png" }).length === 0
      )
    ),
    formats: (["png", "jpeg"] as const).filter((format) =>
      canvases.every(
        (c) =>
          appStoreAssetSpec(c.canvasAspect)?.formats.includes(format) ?? true
      )
    ),
    opaque: canvases.some((c) => appStoreAssetSpec(c.canvasAspect)?.opaque),
  }
}

export function centeredAssetCrop(
  size: Size,
  placement: "header" | "search"
): Rect {
  const aspect = placement === "header" ? 3840 / 1646 : 3 / 2
  const width = Math.min(size.width, size.height * aspect),
    height = width / aspect
  return {
    x: (size.width - width) / 2,
    y: (size.height - height) / 2,
    width,
    height,
  }
}
