import "fake-indexeddb/auto"
import { IDBFactory, IDBObjectStore } from "fake-indexeddb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createBlankProject, type Project } from "./models"
import {
  saveProject,
  loadProject,
  saveProjectWithAssets,
  getAsset,
  putAsset,
  pruneAssets,
  exportProjectPackage,
  importProjectPackage,
} from "./storage"
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
)
function withImage(project: Project, ref: string) {
  const next = structuredClone(project),
    background = next.canvases[0].layers[0]
  if (background.content.kind === "background")
    background.content.fill = {
      kind: "image",
      assetRef: ref,
      blurRadius: 0,
      dimming: 0,
    }
  return next
}
function abortOnFinalWrite() {
  const original = IDBObjectStore.prototype.put
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<typeof original>
  ) {
    const request = original.apply(this, args)
    if (this.name === "settings" && args[1] === "active_project_id")
      request.addEventListener("success", () => this.transaction.abort(), {
        once: true,
      })
    return request
  })
}
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory())
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
describe("durable project storage", () => {
  it("does not acknowledge a write whose transaction aborts after request success", async () => {
    const project = createBlankProject()
    abortOnFinalWrite()
    await expect(saveProject(project)).rejects.toThrow("storage_aborted")
    expect(await loadProject(project.id)).toBeNull()
  })
  it("rolls back project and image together on a late transaction abort", async () => {
    const original = createBlankProject()
    await saveProject(original)
    abortOnFinalWrite()
    await expect(
      saveProjectWithAssets(withImage(original, "pending"), {
        pending: new Blob([PNG]),
      })
    ).rejects.toThrow()
    expect(await getAsset("pending")).toBeNull()
    expect((await loadProject(original.id))?.canvases).toEqual(
      original.canvases
    )
  })
  it("aborts without touching stored data when cancelled or manually changed", async () => {
    const project = withImage(createBlankProject(), "pending"),
      abort = new AbortController()
    abort.abort()
    await expect(
      saveProjectWithAssets(
        project,
        { pending: new Blob([PNG]) },
        { signal: abort.signal }
      )
    ).rejects.toThrow()
    await expect(
      saveProjectWithAssets(
        project,
        { pending: new Blob([PNG]) },
        {
          guard: () => {
            throw new Error("revision_conflict")
          },
        }
      )
    ).rejects.toThrow("revision_conflict")
    expect(await getAsset("pending")).toBeNull()
    expect(await loadProject(project.id)).toBeNull()
  })
  it("protects committed images against concurrent cleanup in another module context", async () => {
    const project = withImage(createBlankProject(), "atomic")
    vi.resetModules()
    const otherTab = await import("./storage")
    await Promise.all([
      saveProjectWithAssets(project, { atomic: new Blob([PNG]) }),
      otherTab.pruneAssets(),
    ])
    await otherTab.pruneAssets()
    expect(await getAsset("atomic")).not.toBeNull()
    expect(await loadProject(project.id)).not.toBeNull()
  })
  it("keeps standalone image ingestion leased across tabs until saved or expired", async () => {
    await putAsset("ingesting", new Blob([PNG]))
    vi.resetModules()
    const otherTab = await import("./storage")
    await otherTab.pruneAssets()
    expect(await getAsset("ingesting")).not.toBeNull()
    const time = Date.now()
    vi.spyOn(Date, "now").mockReturnValue(time + 6 * 60_000)
    await otherTab.pruneAssets()
    expect(await getAsset("ingesting")).toBeNull()
  })
  it("never overwrites a colliding asset or leaves a partial new project", async () => {
    await putAsset("same", new Blob(["original"]))
    const project = withImage(createBlankProject(), "same")
    await expect(
      saveProjectWithAssets(project, {
        same: new Blob(["different"]),
        orphan: new Blob(["new"]),
      })
    ).rejects.toThrow("asset_reference_collision")
    expect(await (await getAsset("same"))?.text()).toBe("original")
    expect(await getAsset("orphan")).toBeNull()
    expect(await loadProject(project.id)).toBeNull()
  })
  it("rejects a competing tab's project write since preparation", async () => {
    const original = createBlankProject()
    await saveProject(original)
    const expected = await loadProject(original.id)
    await saveProject({ ...original, name: "Other tab" })
    await expect(
      saveProjectWithAssets(
        { ...original, name: "MCP" },
        {},
        { expectedStored: { id: original.id, project: expected } }
      )
    ).rejects.toThrow("storage_conflict")
    expect((await loadProject(original.id))?.name).toBe("Other tab")
  })
  it("fails export if any image is missing, too large or invalid", async () => {
    const project = withImage(createBlankProject(), "image")
    await expect(
      exportProjectPackage(project, async () => null)
    ).rejects.toThrow("missing_asset")
    await expect(
      exportProjectPackage(
        project,
        async () => new Blob([new Uint8Array(9 * 1024 * 1024)])
      )
    ).rejects.toThrow("package_too_large")
    await expect(
      exportProjectPackage(project, async () => new Blob(["invalid"]))
    ).rejects.toThrow()
  })
  it("exports a package that imports with its project intact", async () => {
    const project = createBlankProject()
    const blob = await exportProjectPackage(project, async () => null)
    const imported = await importProjectPackage(
      new File([blob], "project.pocketdraft")
    )
    expect(imported.project.canvases).toEqual(project.canvases)
    expect(await loadProject(imported.project.id)).not.toBeNull()
  })
})
