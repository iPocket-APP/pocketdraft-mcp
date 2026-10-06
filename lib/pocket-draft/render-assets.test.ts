import "fake-indexeddb/auto"
import { IDBFactory } from "fake-indexeddb"
import { beforeEach, expect, it, vi } from "vitest"
const decode = vi.hoisted(() => vi.fn())
vi.mock("./assets", () => ({ bitmapFromBlob: decode, bitmapFromUrl: vi.fn() }))
import { loadCanvasRenderImages } from "./render-assets"
import {
  createBlankCanvas,
  createBlankProject,
  createImageLayer,
  syncActiveCanvasToProject,
} from "./models"
import {
  getAsset,
  putAsset,
  saveProject,
  loadProject,
  exportProjectPackage,
  importProjectPackage,
  duplicateProject,
} from "./storage"

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory())
  decode.mockReset()
})

it("loads original resolution for exports, bounded bitmaps for previews, and releases ownership", async () => {
  const canvas = createBlankCanvas("appStoreUniversal")
  canvas.layers.push(createImageLayer({ assetRef: "original", aspectRatio: 2 }))
  const blob = new Blob(["original bytes"])
  await putAsset("original", blob)
  const close = vi.fn()
  decode.mockResolvedValue({ width: 5244, height: 2950, close })
  const full = await loadCanvasRenderImages(canvas)
  expect(decode).toHaveBeenLastCalledWith(blob, Infinity)
  full.dispose()
  expect(close).toHaveBeenCalledOnce()
  const preview = await loadCanvasRenderImages(canvas, { preview: true })
  expect(decode).toHaveBeenLastCalledWith(blob, 2048)
  preview.dispose()
  canvas.layers.push(createImageLayer({ assetRef: "missing", aspectRatio: 1 }))
  await expect(loadCanvasRenderImages(canvas)).rejects.toThrow("missing_asset")
  expect(close).toHaveBeenCalledTimes(3)
})

it("persists and imports creative canvases without changing package/schema versions", async () => {
  const project = createBlankProject("appStoreUniversal")
  project.name = "Creative assets"
  project.canvases.push(createBlankCanvas("appStoreEventCard"))
  const saved = syncActiveCanvasToProject(project)
  await saveProject(saved)
  expect(await loadProject(saved.id)).toEqual(saved)
  const duplicate = await duplicateProject(saved.id)
  expect(duplicate.canvases.map((c) => c.canvasAspect)).toEqual([
    "appStoreUniversal",
    "appStoreEventCard",
  ])
  const blob = await exportProjectPackage(saved, getAsset)
  const raw = JSON.parse(await blob.text())
  expect(raw.version).toBe(1)
  expect(raw.project.schemaVersion).toBe(2)
  const imported = await importProjectPackage(
    new File([blob], "creative.pocketdraft")
  )
  expect(imported.project.canvases).toEqual(saved.canvases)
})
