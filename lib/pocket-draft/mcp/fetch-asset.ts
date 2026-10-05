import { hashBlob } from "../assets"
import { PocketDraftMcpError } from "./errors"
import { decodeImageDataUrl, validateImageBytes } from "./image-bytes"
import { MAX_ASSET_BYTES } from "./protocol"
import { accountBytes, callContext } from "./call-context"
import { assertAllowedAssetUrl } from "./url-policy"
export { assertAllowedAssetUrl } from "./url-policy"
export type ResolvedAsset = {
  ref: string
  dataUrl: string
  mimeType: string
  bytes: number
  width: number
  height: number
}

export async function readLimitedBody(
  response: Response,
  signal: AbortSignal
): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > MAX_ASSET_BYTES) {
    await response.body?.cancel()
    throw new PocketDraftMcpError("asset_error", "Image exceeds 8 MiB.")
  }
  if (!response.body)
    throw new PocketDraftMcpError("asset_error", "Empty image response.")
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = []
  let length = 0
  const abort = () => {
    void reader.cancel()
  }
  signal.addEventListener("abort", abort, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      length += value.byteLength
      if (length > MAX_ASSET_BYTES)
        throw new PocketDraftMcpError("asset_error", "Image exceeds 8 MiB.")
      accountBytes(value.byteLength)
      chunks.push(value)
    }
  } finally {
    signal.removeEventListener("abort", abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
async function fetchBytes(source: string): Promise<Uint8Array> {
  const timerSignal = AbortSignal.timeout(15000)
  const ctx = callContext()
  const signal = ctx ? AbortSignal.any([timerSignal, ctx.signal]) : timerSignal
  let current = source
  for (let hop = 0; hop <= 3; hop++) {
    const url = assertAllowedAssetUrl(current)
    const response = ctx?.publicFetch
      ? await fetch(url, {
          redirect: "manual",
          signal,
          headers: { Accept: "image/png,image/jpeg,image/gif,image/webp" },
        })
      : await (await import("./node-fetch")).nodePublicFetch(url, signal)
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      const location = response.headers.get("location")
      if (!location)
        throw new PocketDraftMcpError(
          "asset_error",
          "Redirect missing Location."
        )
      current = new URL(location, url).href
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new PocketDraftMcpError(
        "asset_error",
        `Image returned HTTP ${response.status}.`
      )
    }
    return readLimitedBody(response, signal)
  }
  throw new PocketDraftMcpError("asset_error", "Too many image redirects.")
}
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ""
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
  return `data:${blob.type};base64,${btoa(binary)}`
}
async function resolve(source: string): Promise<ResolvedAsset> {
  const bytes = source.startsWith("data:")
    ? decodeImageDataUrl(source)
    : await fetchBytes(source)
  if (source.startsWith("data:")) accountBytes(bytes.byteLength)
  const { mime, size } = validateImageBytes(bytes)
  const blob = new Blob([new Uint8Array(bytes)], { type: mime })
  return {
    ref: await hashBlob(blob),
    dataUrl: await blobToDataUrl(blob),
    mimeType: mime,
    bytes: bytes.byteLength,
    width: size.width,
    height: size.height,
  }
}
export function resolveAssetSource(source: string): Promise<ResolvedAsset> {
  const cache = callContext()?.cache
  const existing = cache?.get(source)
  if (existing) return existing
  const result = resolve(source).catch((error) => {
    if (error instanceof PocketDraftMcpError) throw error
    if (
      callContext()?.signal.aborted ||
      error?.name === "TimeoutError" ||
      error?.name === "AbortError"
    )
      throw new PocketDraftMcpError(
        "timeout",
        "Image request timed out or was cancelled."
      )
    throw new PocketDraftMcpError(
      "asset_error",
      "Could not read image. Check its URL and availability."
    )
  })
  cache?.set(source, result)
  return result
}
