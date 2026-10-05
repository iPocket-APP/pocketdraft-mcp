import { PREVIEW_IMAGE_MAX_EDGE } from "@/lib/pocket-draft/models"

export type ImageSource = ImageBitmap | HTMLImageElement

export function imageSize(image: ImageSource): {
  width: number
  height: number
} {
  return { width: image.width, height: image.height }
}

export async function blobFromFile(file: File): Promise<Blob> {
  return file
}

export async function hashBlob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest("SHA-256", buffer)
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16)
  const ext = extensionFor(blob.type)
  return `${hex}.${ext}`
}

function extensionFor(mime: string): string {
  if (mime.includes("png")) return "png"
  if (mime.includes("webp")) return "webp"
  if (mime.includes("gif")) return "gif"
  return "jpg"
}

export async function imageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  try {
    const image = await loadHtmlImage(url)
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function loadHtmlImage(
  src: string,
  signal?: AbortSignal
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const image = new Image()
    const abort = () => {
      image.src = ""
      reject(signal?.reason ?? new Error("cancelled"))
    }
    const cleanup = () => signal?.removeEventListener("abort", abort)
    signal?.addEventListener("abort", abort, { once: true })
    image.decoding = "async"
    image.onload = () => {
      cleanup()
      resolve(image)
    }
    image.onerror = () => {
      cleanup()
      // 避免直接抛出未捕获错误导致前端白屏，保留错误日志
      reject(new Error(`Failed to load image: ${src}`))
    }
    image.src = src
  })
}

export async function bitmapFromBlob(
  blob: Blob,
  maxEdge = PREVIEW_IMAGE_MAX_EDGE
): Promise<ImageSource> {
  try {
    if (typeof createImageBitmap === "function") {
      const raw = await createImageBitmap(blob)
      if (Math.max(raw.width, raw.height) <= maxEdge) return raw
      const scale = maxEdge / Math.max(raw.width, raw.height)
      try {
        return await createImageBitmap(raw, {
          resizeWidth: Math.max(1, Math.round(raw.width * scale)),
          resizeHeight: Math.max(1, Math.round(raw.height * scale)),
          resizeQuality: "high",
        })
      } finally {
        raw.close()
      }
    }
  } catch {
    // Safari / type mismatches fall through to HTMLImageElement.
  }
  const image = await imageFromBlob(blob)
  return downscaleImage(image, maxEdge)
}

export async function bitmapFromUrl(
  url: string,
  signal?: AbortSignal
): Promise<ImageSource> {
  try {
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error(response.statusText)
    const blob = await response.blob()
    if (typeof createImageBitmap === "function") {
      return await createImageBitmap(blob)
    }
    return await imageFromBlob(blob)
  } catch {
    signal?.throwIfAborted()
    return loadHtmlImage(url, signal)
  }
}

function downscaleImage(
  image: HTMLImageElement,
  maxEdge: number
): HTMLImageElement {
  if (Math.max(image.width, image.height) <= maxEdge) return image
  const scale = maxEdge / Math.max(image.width, image.height)
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const ctx = canvas.getContext("2d")
  if (!ctx) return image
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  const out = new Image()
  out.src = canvas.toDataURL("image/jpeg", 0.92)
  return out
}

export async function samplePalette(
  image: ImageSource,
  count = 5
): Promise<string[]> {
  const canvas = document.createElement("canvas")
  canvas.width = 16
  canvas.height = 16
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return []
  ctx.drawImage(image, 0, 0, 16, 16)
  const data = ctx.getImageData(0, 0, 16, 16).data
  const buckets = new Map<string, number>()
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue
    const r = Math.round(data[i] / 24) * 24
    const g = Math.round(data[i + 1] / 24) * 24
    const b = Math.round(data[i + 2] / 24) * 24
    const key = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  return [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([hex]) => hex)
}
