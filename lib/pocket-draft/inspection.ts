import {
  assetSafeArea,
  appStoreAssetSpec,
  assetSizeIsValid,
} from "./app-store-assets"
import { z } from "zod"
import {
  displayedFrame,
  rotatedBoundingBox,
  textLayout,
  screenshotOffsetBounds,
  measureLongestLine,
} from "./geometry"
import { geometryFor } from "./catalog"
import {
  referencedAssets,
  type Project,
  type ProjectCanvas,
  type Layer,
  type Size,
} from "./models"

export const inspectionOptionsSchema = z
  .object({
    canvasIds: z.array(z.string()).max(10).optional(),
    layerIds: z.array(z.string()).max(500).optional(),
    kind: z.enum(["background", "device", "text", "image"]).optional(),
    name: z.string().optional(),
    text: z.string().optional(),
    exact: z.boolean().default(false),
    geometry: z.boolean().default(true),
  })
  .strict()
export type InspectionOptions = z.input<typeof inspectionOptionsSchema>
export function layerGeometry(layer: Layer, canvas: ProjectCanvas) {
  if (layer.content.kind === "background") {
    const frame = { x: 0, y: 0, ...canvas.canvasLogicalSize }
    return {
      center: { x: frame.width / 2, y: frame.height / 2 },
      frame,
      bounds: frame,
      rotationDegrees: 0,
    }
  }
  const frame = displayedFrame(layer, canvas, canvas.canvasLogicalSize)
  const bounds = rotatedBoundingBox(frame, layer.transform.rotation)
  return {
    center: {
      x: layer.transform.center.x * canvas.canvasLogicalSize.width,
      y: layer.transform.center.y * canvas.canvasLogicalSize.height,
    },
    frame,
    bounds,
    rotationDegrees: (layer.transform.rotation * 180) / Math.PI,
    ...(layer.content.kind === "device"
      ? {
          crop: {
            zoom: layer.content.screenshotZoom,
            offsetPixels: {
              x:
                layer.content.screenshotOffset.x *
                frame.width *
                geometryFor(layer.content.deviceId, layer.content.orientation)
                  .frame.width,
              y:
                layer.content.screenshotOffset.y *
                frame.height *
                geometryFor(layer.content.deviceId, layer.content.orientation)
                  .frame.height,
            },
          },
        }
      : {}),
    ...(layer.content.kind === "text"
      ? { text: textLayout(layer.content, canvas.canvasLogicalSize) }
      : {}),
  }
}
export function inspectLayers(
  project: Project,
  options: InspectionOptions = {},
  measured = false
) {
  const match = (value: string, query: string | undefined) =>
    query === undefined ||
    (options.exact
      ? value === query
      : value.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  return project.canvases
    .filter((c) => !options.canvasIds || options.canvasIds.includes(c.id))
    .map((canvas) => ({
      id: canvas.id,
      layers: canvas.layers.flatMap((layer, index) =>
        (!options.layerIds || options.layerIds.includes(layer.id)) &&
        (!options.kind || layer.content.kind === options.kind) &&
        match(layer.name, options.name) &&
        (options.text === undefined ||
          (layer.content.kind === "text" &&
            match(layer.content.string, options.text)))
          ? [
              {
                id: layer.id,
                name: layer.name,
                index,
                kind: layer.content.kind,
                isVisible: layer.isVisible,
                isLocked: layer.isLocked,
                opacity: layer.opacity,
                transform: layer.transform,
                content: layer.content,
                ...(measured && options.geometry !== false
                  ? { geometry: layerGeometry(layer, canvas) }
                  : {}),
              },
            ]
          : []
      ),
    }))
}
export function cropBounds(
  layer: Layer,
  canvas: ProjectCanvas,
  imageSize: Size
) {
  if (layer.content.kind !== "device") throw new Error("wrong_layer_type")
  const frame = displayedFrame(layer, canvas, canvas.canvasLogicalSize)
  const screen = geometryFor(
    layer.content.deviceId,
    layer.content.orientation
  ).frame
  return screenshotOffsetBounds(
    imageSize,
    { width: frame.width * screen.width, height: frame.height * screen.height },
    layer.content.screenshotZoom
  )
}
export type ProjectIssue = {
  code: string
  severity: "error" | "warning"
  canvasId?: string
  layerId?: string
  assetRef?: string
  message: string
}
export function projectIssues(
  project: Project,
  images: Record<string, Size>,
  available: ReadonlySet<string>
) {
  const issues: ProjectIssue[] = []
  for (const ref of referencedAssets(project))
    if (!available.has(ref))
      issues.push({
        code: "missing_asset",
        severity: "error",
        assetRef: ref,
        message: "Referenced image is missing.",
      })
  for (const canvas of project.canvases) {
    const spec = appStoreAssetSpec(canvas.canvasAspect)
    if (spec && !assetSizeIsValid(spec, canvas.canvasLogicalSize))
      issues.push({
        code: "asset_dimensions",
        severity: "error",
        canvasId: canvas.id,
        message:
          "Canvas dimensions do not match the App Store asset specification.",
      })
    for (const layer of canvas.layers) {
      if (layer.content.kind === "background") continue
      const { bounds } = layerGeometry(layer, canvas)
      const safe = assetSafeArea(canvas)
      if (
        safe &&
        layer.isVisible &&
        layer.opacity > 0 &&
        ["text", "device"].includes(layer.content.kind) &&
        (bounds.x < safe.x ||
          bounds.y < safe.y ||
          bounds.x + bounds.width > safe.x + safe.width ||
          bounds.y + bounds.height > safe.y + safe.height)
      )
        issues.push({
          code: "asset_safe_area",
          severity: "warning",
          canvasId: canvas.id,
          layerId: layer.id,
          message:
            "Text or device extends outside Apple's artwork safe area. Review the placement preview; intentional bleed is allowed.",
        })
      if (
        layer.isVisible &&
        (bounds.x < -0.5 ||
          bounds.y < -0.5 ||
          bounds.x + bounds.width > canvas.canvasLogicalSize.width + 0.5 ||
          bounds.y + bounds.height > canvas.canvasLogicalSize.height + 0.5)
      )
        issues.push({
          code: "layer_outside_canvas",
          severity: "warning",
          canvasId: canvas.id,
          layerId: layer.id,
          message:
            "The geometric bounds extend outside the canvas. This may be intentional.",
        })
      if (layer.content.kind === "text") {
        const layout = textLayout(layer.content, canvas.canvasLogicalSize)
        if (
          layout.lineHeight <= 0 ||
          !Number.isFinite(layout.height) ||
          measureLongestLine(layer.content, layout.lines) >
            layout.width + 0.5 ||
          (layer.content.boxWidth != null &&
            layout.width > layer.content.boxWidth + 0.5)
        )
          issues.push({
            code: "text_fit",
            severity: "error",
            canvasId: canvas.id,
            layerId: layer.id,
            message:
              "Text box or line height cannot fit the requested text settings.",
          })
      }
      if (layer.content.kind === "device") {
        const ref = layer.content.screenshotRef
        if (!ref)
          issues.push({
            code: "missing_screenshot",
            severity: "warning",
            canvasId: canvas.id,
            layerId: layer.id,
            message: "Device has no screenshot.",
          })
        if (ref && images[ref]) {
          const limit = cropBounds(layer, canvas, images[ref]),
            offset = layer.content.screenshotOffset
          if (
            layer.content.screenshotZoom < 1 ||
            layer.content.screenshotZoom > 3 ||
            Math.abs(offset.x) > limit.x + 1e-8 ||
            Math.abs(offset.y) > limit.y + 1e-8
          )
            issues.push({
              code: "crop_out_of_bounds",
              severity: "error",
              canvasId: canvas.id,
              layerId: layer.id,
              message: `Crop offset must be within ±${limit.x} horizontally and ±${limit.y} vertically.`,
            })
        }
      }
    }
  }
  return issues
}
