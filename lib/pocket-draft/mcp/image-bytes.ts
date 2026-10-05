import { PocketDraftMcpError } from "./errors"
import { MAX_ASSET_BYTES } from "./protocol"
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
  ) {
    return "image/png"
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg"
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    ["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.subarray(0, 6)))
  ) {
    return "image/gif"
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50 &&
    bytes[11] === 0x50
  ) {
    return "image/webp"
  }
  return null
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  )
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

export function imageSizeFromBytes(
  bytes: Uint8Array
): { width: number; height: number } | null {
  const mime = sniffImageMime(bytes)
  if (mime === "image/png" && bytes.length >= 24) {
    return { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) }
  }
  if (mime === "image/gif" && bytes.length >= 10) {
    return { width: readU16LE(bytes, 6), height: readU16LE(bytes, 8) }
  }
  if (mime === "image/jpeg") {
    return jpegSize(bytes)
  }
  if (mime === "image/webp") {
    return webpSize(bytes)
  }
  return null
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) break
    const marker = bytes[offset + 1]
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
        width: (bytes[offset + 7] << 8) | bytes[offset + 8],
      }
    }
    offset += 2 + length
  }
  return null
}

function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 20) return null
  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
      height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)),
    }
  }
  if (chunk === "VP8 " && bytes.length >= 30) {
    return {
      width: readU16LE(bytes, 26) & 0x3fff,
      height: readU16LE(bytes, 28) & 0x3fff,
    }
  }
  if (chunk === "VP8L" && bytes.length >= 25) {
    const bits =
      bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    }
  }
  return null
}

export function extensionForMime(mime: string): string {
  if (mime.includes("png")) return "png"
  if (mime.includes("webp")) return "webp"
  if (mime.includes("gif")) return "gif"
  return "jpg"
}

export function dataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(",")
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

export function decodeImageDataUrl(source: string): Uint8Array {
  const match =
    /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(
      source
    )
  if (!match || !match[2].length || match[2].length % 4 !== 0)
    throw new PocketDraftMcpError(
      "asset_error",
      "Expected a supported base64 image data URL."
    )
  if (dataUrlByteLength(source) > MAX_ASSET_BYTES)
    throw new PocketDraftMcpError("asset_error", "Image exceeds 8 MiB.")
  let binary: string
  try {
    binary = atob(match[2])
  } catch {
    throw new PocketDraftMcpError("asset_error", "Invalid base64 image.")
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  const { mime } = validateImageBytes(bytes)
  if (mime !== `image/${match[1].toLowerCase()}`)
    throw new PocketDraftMcpError(
      "asset_error",
      "Image MIME does not match its bytes."
    )
  return bytes
}
export function validateImageBytes(bytes: Uint8Array) {
  const mime = sniffImageMime(bytes)
  const size = imageSizeFromBytes(bytes)
  let complete = false
  if (mime === "image/png") {
    let offset = 8,
      header = false,
      data = false,
      end = false
    while (offset + 12 <= bytes.length) {
      const length = readU32BE(bytes, offset)
      if (offset + 12 + length > bytes.length) break
      const kind = String.fromCharCode(
        ...bytes.subarray(offset + 4, offset + 8)
      )
      if (offset === 8) header = kind === "IHDR" && length === 13
      if (kind === "IDAT") data = true
      offset += 12 + length
      if (kind === "IEND") {
        end = length === 0 && offset === bytes.length
        break
      }
    }
    complete = header && data && end
  } else if (mime === "image/jpeg")
    complete =
      bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9
  else if (mime === "image/gif")
    complete = bytes.length >= 14 && bytes[bytes.length - 1] === 0x3b
  else if (mime === "image/webp") {
    const length = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength
    ).getUint32(4, true)
    complete = length + 8 === bytes.length
  }
  if (
    !mime ||
    !size ||
    !complete ||
    size.width <= 0 ||
    size.height <= 0 ||
    size.width > 32768 ||
    size.height > 32768 ||
    size.width * size.height > 67108864
  )
    throw new PocketDraftMcpError(
      "asset_error",
      "Unsupported, truncated, or invalid image (maximum 64 megapixels)."
    )
  return { mime, size }
}
