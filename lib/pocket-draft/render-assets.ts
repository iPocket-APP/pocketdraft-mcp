import { bitmapFromBlob, bitmapFromUrl, type ImageSource } from "./assets"
import { frameAssetPath, frameCacheKey, isVectorDevice } from "./catalog"
import { layerAssetRefs, type ProjectCanvas } from "./models"
import { getAsset } from "./storage"
import { abortable } from "./abort"

export function closeRenderImage(image: ImageSource) {
  if ("close" in image) image.close()
}
type ImageCache = {
  get(
    key: string,
    load: () => Promise<ImageSource>,
    signal?: AbortSignal
  ): Promise<ImageSource>
}

/** Both the editor and MCP decode original blobs for export, never preview bitmaps. */
export async function loadCanvasRenderImages(
  canvas: ProjectCanvas,
  options: {
    preview?: boolean
    signal?: AbortSignal
    cache?: ImageCache
    suppliedImages?: Record<string, ImageSource>
  } = {}
) {
  const { signal, cache } = options
  const images: Record<string, ImageSource> = Object.create(null),
    owned: ImageSource[] = []
  const dispose = () => owned.splice(0).forEach(closeRenderImage)
  const load = async (key: string, factory: () => Promise<ImageSource>) => {
    if (cache) return cache.get(key, factory, signal)
    const image = await abortable(factory(), signal, closeRenderImage)
    owned.push(image)
    return image
  }
  try {
    for (const ref of layerAssetRefs(canvas.layers)) {
      signal?.throwIfAborted()
      if (options.suppliedImages?.[ref]) {
        images[ref] = options.suppliedImages[ref]
        continue
      }
      const blob = await getAsset(ref)
      if (!blob) throw new Error(`missing_asset: ${ref}`)
      images[ref] = await load(`asset:${ref}:${Boolean(options.preview)}`, () =>
        bitmapFromBlob(blob, options.preview ? 2048 : Infinity)
      )
    }
    for (const { content } of canvas.layers) {
      if (content.kind !== "device" || isVectorDevice(content.deviceId))
        continue
      const key = frameCacheKey(
        content.deviceId,
        content.frameId,
        content.orientation
      )
      images[key] ??= await load(`frame:${key}`, () =>
        bitmapFromUrl(
          frameAssetPath(
            content.deviceId,
            content.frameId,
            content.orientation
          ),
          signal
        )
      )
    }
    return { images, dispose }
  } catch (error) {
    dispose()
    throw error
  }
}
