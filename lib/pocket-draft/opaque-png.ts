// A small RGB-only PNG encoder. Canvas.toBlob may retain an unused alpha channel.
const table = Uint32Array.from({ length: 256 }, (_, index) => {
  let n = index
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(data.length + 12),
    view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  let crc = 0xffffffff
  for (let i = 4; i < out.length - 4; i++)
    crc = table[(crc ^ out[i]) & 255] ^ (crc >>> 8)
  view.setUint32(out.length - 4, (crc ^ 0xffffffff) >>> 0)
  return out
}

export function pngInfo(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 33 || !signature.every((v, i) => bytes[i] === v))
    throw new Error("invalid_png")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const colorType = bytes[25]
  let transparency = colorType === 4 || colorType === 6
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = view.getUint32(offset)
    if (offset + length + 12 > bytes.length) throw new Error("invalid_png")
    if (
      String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === "tRNS"
    )
      transparency = true
    offset += length + 12
  }
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    bitDepth: bytes[24],
    colorType,
    transparency,
  }
}

export async function encodeOpaquePng(
  image: Pick<ImageData, "width" | "height" | "data">
): Promise<Blob> {
  const { width, height, data } = image
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    data.length !== width * height * 4
  )
    throw new Error("invalid_image_data")
  const stride = width * 3 + 1
  const scanlines = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const row = y * stride
    scanlines[row] = 1 // PNG Sub filter, useful for flat colours and gradients.
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4
      if (data[src + 3] !== 255)
        throw new Error(
          "asset_transparency: flatten pixels before PNG encoding"
        )
      for (let channel = 0; channel < 3; channel++)
        scanlines[row + 1 + x * 3 + channel] =
          data[src + channel] - (x ? data[src - 4 + channel] : 0)
    }
  }
  const compressed = new Uint8Array(
    await new Response(
      new Blob([scanlines])
        .stream()
        .pipeThrough(new CompressionStream("deflate"))
    ).arrayBuffer()
  )
  const header = new Uint8Array(13),
    view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8
  header[9] = 2 // truecolour RGB, never RGBA or indexed transparency.
  return new Blob(
    [
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("sRGB", new Uint8Array([0])),
      chunk("IDAT", compressed),
      chunk("IEND", new Uint8Array()),
    ],
    { type: "image/png" }
  )
}
