import { inflateSync } from "node:zlib"
import { expect, it } from "vitest"
import { encodeOpaquePng, pngInfo } from "./opaque-png"

it("encodes exact RGB pixels without an alpha channel or transparency chunks", async () => {
  const pixels = new Uint8ClampedArray([
    255, 0, 17, 255, 10, 20, 30, 255, 0, 255, 0, 255, 250, 2, 3, 255,
  ])
  const blob = await encodeOpaquePng({ width: 2, height: 2, data: pixels })
  const bytes = new Uint8Array(await blob.arrayBuffer()),
    view = new DataView(bytes.buffer)
  expect(pngInfo(bytes)).toEqual({
    width: 2,
    height: 2,
    colorType: 2,
    bitDepth: 8,
    transparency: false,
  })
  const chunks: Uint8Array[] = []
  for (let pos = 8; pos < bytes.length; ) {
    const length = view.getUint32(pos)
    if (String.fromCharCode(...bytes.subarray(pos + 4, pos + 8)) === "IDAT")
      chunks.push(bytes.subarray(pos + 8, pos + 8 + length))
    pos += length + 12
  }
  const decoded = inflateSync(Buffer.concat(chunks))
  for (let y = 0; y < 2; y++) {
    expect(decoded[y * 7]).toBe(1)
    for (let x = 0; x < 2; x++)
      for (let c = 0; c < 3; c++) {
        const idx = y * 7 + 1 + x * 3 + c
        if (x) decoded[idx] = (decoded[idx] + decoded[idx - 3]) & 255
        expect(decoded[idx]).toBe(pixels[(y * 2 + x) * 4 + c])
      }
  }
})
it("rejects pixels that have not been flattened", async () => {
  await expect(
    encodeOpaquePng({
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([12, 34, 56, 0]),
    })
  ).rejects.toThrow("asset_transparency")
})
