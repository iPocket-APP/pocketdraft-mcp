import "fake-indexeddb/auto"
import { IDBFactory } from "fake-indexeddb"
import { beforeEach, describe, expect, it, vi } from "vitest"
const decode = vi.hoisted(() => vi.fn())
vi.mock("./assets", () => ({ bitmapFromBlob: decode, bitmapFromUrl: vi.fn() }))
import {
  createBlankProject,
  createBlankCanvas,
  createImageLayer,
} from "./models"
import {
  projectRevision,
  browserSnapshot,
  prepareBridgeDocument,
  BridgeImageCache,
} from "./browser-bridge"
import { getAsset, putAsset, saveProjectWithAssets } from "./storage"
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
function imageProject(ref: string) {
  const project = createBlankProject()
  const background = project.canvases[0].layers[0]
  if (background.content.kind === "background")
    background.content.fill = {
      kind: "image",
      assetRef: ref,
      blurRadius: 0,
      dimming: 0,
    }
  return project
}
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory())
  decode.mockReset()
  decode.mockImplementation(async () => ({
    width: 1,
    height: 1,
    close: vi.fn(),
  }))
})
describe("browser bridge documents", () => {
  it("hashes manual changes and snapshots only project/asset metadata", async () => {
    const project = imageProject("large-local-image")
    await putAsset(
      "large-local-image",
      new Blob([new Uint8Array(40 * 1024 * 1024)], { type: "image/png" })
    )
    const snapshot = await browserSnapshot(project)
    expect(snapshot.project.id).toBe(project.id)
    expect(snapshot.assets["large-local-image"].bytes).toBe(40 * 1024 * 1024)
    expect(JSON.stringify(snapshot).length).toBeLessThan(10_000)
    expect(await projectRevision({ ...project, name: "Manual edit" })).not.toBe(
      snapshot.revision
    )
    expect(await projectRevision(structuredClone(project))).toBe(
      snapshot.revision
    )
    const cached = {
      "large-local-image": { width: 1, height: 1 } as ImageBitmap,
    }
    const prepared = await prepareBridgeDocument(
      {
        schemaVersion: 1,
        project: { ...project, name: "Text-only edit" },
        assets: {},
      },
      undefined,
      cached
    )
    expect(decode).not.toHaveBeenCalled()
    expect(prepared.blobs).toEqual({})
    await saveProjectWithAssets(prepared.project, prepared.blobs)
    expect((await getAsset("large-local-image"))?.size).toBe(40 * 1024 * 1024)
  })
  it("rejects missing/invalid additions and decodes new images before writes", async () => {
    const project = imageProject("new")
    await expect(
      prepareBridgeDocument({ schemaVersion: 1, project, assets: {} })
    ).rejects.toThrow("missing_asset")
    await expect(
      prepareBridgeDocument({
        schemaVersion: 1,
        project,
        assets: { new: "https://example.com/a.png" },
      })
    ).rejects.toThrow()
    const prepared = await prepareBridgeDocument({
      schemaVersion: 1,
      project,
      assets: { new: PNG },
    })
    expect(prepared.images.new.width).toBe(1)
    expect(await getAsset("new")).toBeNull()
    prepared.dispose()
    expect((prepared.images.new as ImageBitmap).close).toHaveBeenCalledOnce()
  })
  it("closes prior decodes when another image fails", async () => {
    const project = imageProject("a"),
      canvas = createBlankCanvas()
    if (canvas.layers[0].content.kind === "background")
      canvas.layers[0].content.fill = {
        kind: "image",
        assetRef: "b",
        blurRadius: 0,
        dimming: 0,
      }
    project.canvases.push(canvas)
    const close = vi.fn()
    decode
      .mockResolvedValueOnce({ width: 1, height: 1, close })
      .mockRejectedValueOnce(new Error("bad image"))
    await expect(
      prepareBridgeDocument({
        schemaVersion: 1,
        project,
        assets: { a: PNG, b: PNG },
      })
    ).rejects.toThrow("bad image")
    expect(close).toHaveBeenCalledOnce()
  })
  it("cancels an in-flight decode and disposes its late result", async () => {
    const controller = new AbortController(),
      close = vi.fn()
    let finish!: (value: unknown) => void
    decode.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = prepareBridgeDocument(
      { schemaVersion: 1, project: imageProject("a"), assets: { a: PNG } },
      controller.signal
    )
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce())
    controller.abort()
    await expect(pending).rejects.toThrow()
    finish({ width: 1, height: 1, close })
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
  })
  it("reuses rendered images and releases its bounded cache", async () => {
    const cache = new BridgeImageCache(4),
      close = vi.fn(),
      load = vi.fn(
        async () => ({ width: 2, height: 2, close }) as unknown as ImageBitmap
      )
    await cache.get("a", load)
    await cache.get("a", load)
    expect(load).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
    cache.trim()
    expect(close).toHaveBeenCalledOnce()
    cache.close()
    expect(close).toHaveBeenCalledOnce()
  })
})

it("preflights asset collisions without writing and releases temporary images", async () => {
  await putAsset(
    "existing",
    new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })
  )
  await expect(
    prepareBridgeDocument({
      schemaVersion: 1,
      project: imageProject("existing"),
      assets: { existing: PNG },
    })
  ).rejects.toThrow("asset_reference_collision")
  expect(
    Array.from(
      new Uint8Array(await (await getAsset("existing"))!.arrayBuffer())
    )
  ).toEqual([1, 2, 3])
  expect((await decode.mock.results.at(-1)!.value).close).toHaveBeenCalledOnce()
})

it("trial evaluation decodes and disposes new assets without saving; validation tolerates missing assets", async () => {
  const { evaluateBridgeDocument } = await import("./browser-bridge")
  const project = imageProject("trial")
  const result = await evaluateBridgeDocument(
    { schemaVersion: 1, project, assets: { trial: PNG } },
    {}
  )
  expect(result.project.id).toBe(project.id)
  expect(await getAsset("trial")).toBeNull()
  expect((await decode.mock.results.at(-1)!.value).close).toHaveBeenCalledOnce()
  const validation = await evaluateBridgeDocument(
    { schemaVersion: 1, project, assets: {} },
    { operation: "validate" }
  )
  expect(validation.issues).toContainEqual(
    expect.objectContaining({ code: "missing_asset", assetRef: "trial" })
  )
})

it("can reuse an original project asset after its last candidate reference was removed", async () => {
  const { evaluateBridgeDocument } = await import("./browser-bridge")
  const project = imageProject("old")
  const target = createImageLayer({ assetRef: "target", aspectRatio: 1 })
  project.canvases[0].layers.push(target)
  await putAsset(
    "old",
    new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })
  )
  await putAsset(
    "target",
    new Blob([new Uint8Array([4, 5, 6])], { type: "image/png" })
  )
  const background = project.canvases[0].layers[0]
  if (background.content.kind === "background")
    background.content.fill = {
      kind: "solid",
      color: { r: 1, g: 1, b: 1, a: 1 },
    }
  const reused = await evaluateBridgeDocument(
    { schemaVersion: 1, project, assets: {} },
    {
      command: "assets.reuse",
      input: { target: "image", layerId: target.id, assetRef: "old" },
    },
    undefined,
    undefined,
    new Set(["old", "target"])
  )
  expect(reused.project.canvases[0].layers[1].content).toMatchObject({
    assetRef: "old",
  })
})

it("releases uncommitted trial images even when a measurement cache is supplied", async () => {
  const { evaluateBridgeDocument } = await import("./browser-bridge")
  const cache = new BridgeImageCache()
  await evaluateBridgeDocument(
    {
      schemaVersion: 1,
      project: imageProject("trial-cached"),
      assets: { "trial-cached": PNG },
    },
    {},
    undefined,
    cache
  )
  const image = await decode.mock.results.at(-1)!.value
  expect(image.close).toHaveBeenCalledOnce()
  cache.close()
  expect(image.close).toHaveBeenCalledOnce()
})
