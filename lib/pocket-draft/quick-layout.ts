import {
  isBackground,
  isDevice,
  isImage,
  isText,
  type Layer,
  type Project,
  type ProjectCanvas,
} from "@/lib/pocket-draft/models"

export type CanvasQuickLayoutSignature = {
  deviceCount: number
  textCount: number
  imageCount: number
  supportedLayerCount: number
}

/** 同步范围：勾掉的类别既不写入目标，也不参与结构匹配 */
export type QuickLayoutScope = {
  canvasSize: boolean
  background: boolean
  devices: boolean
  texts: boolean
  images: boolean
}

export const FULL_QUICK_LAYOUT_SCOPE: QuickLayoutScope = {
  canvasSize: true,
  background: true,
  devices: true,
  texts: true,
  images: true,
}

export function canvasSignature(canvas: ProjectCanvas): CanvasQuickLayoutSignature {
  let deviceCount = 0
  let textCount = 0
  let imageCount = 0
  for (const layer of canvas.layers) {
    if (isDevice(layer)) deviceCount++
    else if (isText(layer)) textCount++
    else if (isImage(layer)) imageCount++
  }
  return {
    deviceCount,
    textCount,
    imageCount,
    supportedLayerCount: deviceCount + textCount + imageCount,
  }
}

export function signaturesMatch(
  a: CanvasQuickLayoutSignature,
  b: CanvasQuickLayoutSignature,
  scope: QuickLayoutScope = FULL_QUICK_LAYOUT_SCOPE
): boolean {
  return (
    (!scope.devices || a.deviceCount === b.deviceCount) &&
    (!scope.texts || a.textCount === b.textCount) &&
    (!scope.images || a.imageCount === b.imageCount)
  )
}

/** 当前范围下源画布是否有东西可同步 */
function scopeHasContent(
  signature: CanvasQuickLayoutSignature,
  scope: QuickLayoutScope
): boolean {
  return (
    scope.canvasSize ||
    scope.background ||
    (scope.devices && signature.deviceCount > 0) ||
    (scope.texts && signature.textCount > 0) ||
    (scope.images && signature.imageCount > 0)
  )
}

export type QuickLayoutTargetInfo = {
  id: string
  name: string
  signature: CanvasQuickLayoutSignature
  isEligible: boolean
  skipReason?: "no_layers" | "mismatch" | null
}

export type QuickLayoutAnalysis = {
  sourceCanvasId: string
  sourceSignature: CanvasQuickLayoutSignature
  targets: QuickLayoutTargetInfo[]
  eligibleCount: number
}

export class CanvasQuickLayoutEngine {
  static analyze(
    project: Project,
    sourceCanvasId: string,
    scope: QuickLayoutScope = FULL_QUICK_LAYOUT_SCOPE
  ): QuickLayoutAnalysis {
    const sourceCanvas = project.canvases.find((c) => c.id === sourceCanvasId)
    if (!sourceCanvas) {
      return {
        sourceCanvasId,
        sourceSignature: {
          deviceCount: 0,
          textCount: 0,
          imageCount: 0,
          supportedLayerCount: 0,
        },
        targets: [],
        eligibleCount: 0,
      }
    }

    const sourceSig = canvasSignature(sourceCanvas)
    const hasLayers = scopeHasContent(sourceSig, scope)

    const targets: QuickLayoutTargetInfo[] = project.canvases
      .filter((c) => c.id !== sourceCanvasId)
      .map((c) => {
        const targetSig = canvasSignature(c)
        const match = hasLayers && signaturesMatch(sourceSig, targetSig, scope)
        let skipReason: QuickLayoutTargetInfo["skipReason"] = null
        if (!hasLayers) skipReason = "no_layers"
        else if (!match) skipReason = "mismatch"

        return {
          id: c.id,
          name: c.name,
          signature: targetSig,
          isEligible: match,
          skipReason,
        }
      })

    const eligibleCount = targets.filter((t) => t.isEligible).length

    return {
      sourceCanvasId,
      sourceSignature: sourceSig,
      targets,
      eligibleCount,
    }
  }

  static apply(
    source: ProjectCanvas,
    target: ProjectCanvas,
    scope: QuickLayoutScope = FULL_QUICK_LAYOUT_SCOPE
  ): ProjectCanvas {
    const sourceSig = canvasSignature(source)
    const targetSig = canvasSignature(target)
    if (!signaturesMatch(sourceSig, targetSig, scope)) return target

    // Copy canvas aspect & logical dimensions if matching
    const nextCanvas: ProjectCanvas = {
      ...target,
      canvasAspect: scope.canvasSize ? source.canvasAspect : target.canvasAspect,
      canvasLogicalSize: scope.canvasSize
        ? { ...source.canvasLogicalSize }
        : { ...target.canvasLogicalSize },
      layers: [...target.layers],
    }

    // 1. Sync Background
    const sourceBg = source.layers.find(isBackground)
    const targetBgIndex = nextCanvas.layers.findIndex(isBackground)
    if (scope.background && sourceBg && targetBgIndex >= 0) {
      nextCanvas.layers[targetBgIndex] = {
        ...nextCanvas.layers[targetBgIndex],
        content: { ...sourceBg.content },
      }
    }

    // 2. Sync Devices
    const sourceDevices = scope.devices ? source.layers.filter(isDevice) : []
    const targetDevices = scope.devices ? nextCanvas.layers.filter(isDevice) : []
    targetDevices.forEach((targetDev, idx) => {
      const srcDev = sourceDevices[idx]
      if (!srcDev || targetDev.isLocked) return

      const targetDevIndex = nextCanvas.layers.findIndex(
        (l) => l.id === targetDev.id
      )
      if (targetDevIndex < 0) return

      const srcContent = srcDev.content
      const tgtContent = targetDev.content
      if (srcContent.kind !== "device" || tgtContent.kind !== "device") return

      nextCanvas.layers[targetDevIndex] = {
        ...targetDev,
        transform: { ...srcDev.transform },
        opacity: srcDev.opacity,
        content: {
          ...tgtContent,
          shadowIntensity: srcContent.shadowIntensity,
          wasManuallyTransformed: true,
        },
      }
    })

    // 3. Sync Texts
    const sourceTexts = scope.texts ? source.layers.filter(isText) : []
    const targetTexts = scope.texts ? nextCanvas.layers.filter(isText) : []
    targetTexts.forEach((targetText, idx) => {
      const srcText = sourceTexts[idx]
      if (!srcText || targetText.isLocked) return

      const targetTextIndex = nextCanvas.layers.findIndex(
        (l) => l.id === targetText.id
      )
      if (targetTextIndex < 0) return

      const srcContent = srcText.content
      const tgtContent = targetText.content
      if (srcContent.kind !== "text" || tgtContent.kind !== "text") return

      nextCanvas.layers[targetTextIndex] = {
        ...targetText,
        transform: { ...srcText.transform },
        opacity: srcText.opacity,
        content: {
          ...tgtContent,
          fontName: srcContent.fontName,
          fontSize: srcContent.fontSize,
          weight: srcContent.weight,
          color: srcContent.color,
          alignment: srcContent.alignment,
          lineSpacing: srcContent.lineSpacing,
          kerning: srcContent.kerning,
          stroke: srcContent.stroke ? { ...srcContent.stroke } : null,
          shadow: srcContent.shadow ? { ...srcContent.shadow } : null,
          pill: srcContent.pill ? { ...srcContent.pill } : null,
          boxWidth: srcContent.boxWidth,
        },
      }
    })

    // 4. Sync Images
    const sourceImages = scope.images ? source.layers.filter(isImage) : []
    const targetImages = scope.images ? nextCanvas.layers.filter(isImage) : []
    targetImages.forEach((targetImg, idx) => {
      const srcImg = sourceImages[idx]
      if (!srcImg || targetImg.isLocked) return

      const targetImgIndex = nextCanvas.layers.findIndex(
        (l) => l.id === targetImg.id
      )
      if (targetImgIndex < 0) return

      const srcContent = srcImg.content
      const tgtContent = targetImg.content
      if (srcContent.kind !== "image" || tgtContent.kind !== "image") return

      nextCanvas.layers[targetImgIndex] = {
        ...targetImg,
        transform: { ...srcImg.transform },
        opacity: srcImg.opacity,
        content: {
          ...tgtContent,
          cornerRadius: srcContent.cornerRadius,
        },
      }
    })

    return nextCanvas
  }

  /**
   * 把 source 的排版写入指定目标画布。targetCanvasIds 省略时同步给其它所有画布。
   */
  static applyToAll(
    project: Project,
    sourceCanvasId: string,
    targetCanvasIds?: readonly string[],
    scope: QuickLayoutScope = FULL_QUICK_LAYOUT_SCOPE
  ): Project {
    const sourceCanvas = project.canvases.find((c) => c.id === sourceCanvasId)
    if (!sourceCanvas) return project
    const allowed = targetCanvasIds ? new Set(targetCanvasIds) : null

    const nextCanvases = project.canvases.map((canvas) => {
      if (canvas.id === sourceCanvasId) return canvas
      if (allowed && !allowed.has(canvas.id)) return canvas
      return CanvasQuickLayoutEngine.apply(sourceCanvas, canvas, scope)
    })

    const activeCanvas = nextCanvases.find((c) => c.id === project.activeCanvasId)!
    return {
      ...project,
      canvases: nextCanvases,
      canvasAspect: activeCanvas.canvasAspect,
      canvasLogicalSize: activeCanvas.canvasLogicalSize,
      layers: activeCanvas.layers,
    }
  }
}
