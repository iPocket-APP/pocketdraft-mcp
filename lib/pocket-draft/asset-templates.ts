import {
  APP_STORE_ASSETS,
  APP_STORE_ASSET_ASPECTS,
  appStoreAssetSpec,
  type AppStoreAssetAspect,
} from "./app-store-assets"
import {
  activeCanvasOf,
  backgroundContent,
  createBlankCanvas,
  createImageLayer,
  createTextLayer,
  MAXIMUM_CANVAS_COUNT,
  syncActiveCanvasToProject,
  type Project,
  type ProjectCanvas,
} from "./models"
import { getDevice } from "./catalog"
import { baseSize } from "./geometry"
import type { SnapFrameTemplate } from "./templates"

const blank = (aspect: AppStoreAssetAspect): SnapFrameTemplate => {
  const spec = APP_STORE_ASSETS[aspect]
  return {
    id: `asset-blank-${aspect}`,
    nameZh: `${spec.nameZh} · 空白`,
    nameEn: `${spec.nameEn} · Blank`,
    descriptionZh: "按苹果规格创建空白画布。",
    descriptionEn: "Blank canvas using Apple's asset specification.",
    deviceCount: 0,
    canvasAspect: aspect,
    background: { kind: "solid", color: { r: 1, g: 1, b: 1, a: 1 } },
    deviceTransforms: [],
    textSlots: [],
    kind: "layout",
    platform: "ios",
    creative: "blank",
  }
}
export const ASSET_TEMPLATES: SnapFrameTemplate[] = [
  ...APP_STORE_ASSET_ASPECTS.map(blank),
  ...(["appStoreHeader", "appStoreSearch", "appStoreUniversal"] as const).map(
    (aspect) => ({
      ...blank(aspect),
      id: `asset-hero-${aspect}`,
      nameZh: `${APP_STORE_ASSETS[aspect].nameZh} · 主视觉`,
      nameEn: `${APP_STORE_ASSETS[aspect].nameEn} · Hero`,
      descriptionZh: "复用当前图片与短标题，放入官方安全区。",
      descriptionEn:
        "Reuse your image and a short headline inside the artwork safe area.",
      creative: "hero" as const,
    })
  ),
  {
    ...blank("appStoreEventCard"),
    id: "asset-event-pair",
    kind: "set",
    creative: "eventSet",
    nameZh: "活动横竖双图",
    nameEn: "In-App Event pair",
    descriptionZh:
      "追加横版卡片与竖版详情，共用主视觉，无预置文字、边框或渐变。",
    descriptionEn:
      "Append landscape and portrait artwork using one visual, without text, borders or gradients.",
  },
]

function primaryVisual(source: ProjectCanvas) {
  for (const layer of source.layers) {
    if (!layer.isVisible || layer.opacity === 0) continue
    if (layer.content.kind === "image")
      return {
        assetRef: layer.content.assetRef,
        aspectRatio: layer.content.aspectRatio,
      }
  }
  const fill = backgroundContent(source)?.fill
  if (fill?.kind === "image")
    return {
      assetRef: fill.assetRef,
      aspectRatio:
        source.canvasLogicalSize.width / source.canvasLogicalSize.height,
    }
  for (const layer of source.layers) {
    if (
      !layer.isVisible ||
      layer.content.kind !== "device" ||
      !layer.content.screenshotRef
    )
      continue
    const size = getDevice(layer.content.deviceId)?.portraitDisplayPixelSize
    const ratio = size ? size.width / size.height : 0.5
    return {
      assetRef: layer.content.screenshotRef,
      aspectRatio:
        layer.content.orientation === "landscape" ? 1 / ratio : ratio,
    }
  }
}

export function applyAssetTemplate(
  source: ProjectCanvas,
  template: SnapFrameTemplate,
  locale: string
): ProjectCanvas {
  const next = {
    ...createBlankCanvas(template.canvasAspect, source.name),
    id: source.id,
  }
  if (template.creative !== "hero") return next
  const spec = appStoreAssetSpec(template.canvasAspect)!,
    safe = spec.safeArea!
  const visual = primaryVisual(source)
  if (visual) {
    const image = createImageLayer({
      ...visual,
      name: locale.startsWith("zh") ? "主视觉" : "Key visual",
    })
    const base = baseSize(image, next)
    image.transform = {
      center: {
        x: (safe.x + safe.width / 2) / spec.size.width,
        y: (safe.y + safe.height * 0.36) / spec.size.height,
      },
      scale: Math.min(
        (safe.width * 0.9) / base.width,
        (safe.height * 0.62) / base.height
      ),
      rotation: 0,
    }
    next.layers.push(image)
  }
  const copy = source.layers.find(
    (l) => l.isVisible && l.content.kind === "text"
  )?.content
  const text = createTextLayer({
    name: locale.startsWith("zh") ? "短标题" : "Headline",
    string:
      copy?.kind === "text"
        ? copy.string
        : locale.startsWith("zh")
          ? "一个清晰的主张"
          : "One clear idea",
    fontName: locale.startsWith("zh") ? "noto-sans-sc" : "geist",
    fontSize: Math.round(safe.height * 0.08),
    boxWidth: safe.width * 0.88,
  })
  text.transform.center = {
    x: (safe.x + safe.width / 2) / spec.size.width,
    y: (safe.y + safe.height * 0.84) / spec.size.height,
  }
  next.layers.push(text)
  return next
}

export function appendEventPair(project: Project, locale: string): Project {
  if (project.canvases.length + 2 > MAXIMUM_CANVAS_COUNT)
    throw new Error(
      "canvas_limit: In-App Event pair requires two available canvas slots."
    )
  const visual = primaryVisual(activeCanvasOf(project))
  const added = (["appStoreEventCard", "appStoreEventDetails"] as const).map(
    (aspect) => {
      const spec = APP_STORE_ASSETS[aspect]
      const canvas = createBlankCanvas(
        aspect,
        locale.startsWith("zh") ? spec.nameZh : spec.nameEn
      )
      const background = canvas.layers[0]
      if (visual && background.content.kind === "background")
        background.content.fill = {
          kind: "image",
          assetRef: visual.assetRef,
          blurRadius: 0,
          dimming: 0,
        }
      return canvas
    }
  )
  return syncActiveCanvasToProject({
    ...project,
    canvases: [...project.canvases, ...added],
    activeCanvasId: added[0].id,
  })
}
