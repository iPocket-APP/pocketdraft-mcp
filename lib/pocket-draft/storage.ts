import { validateProject } from "./mcp/validation"
import {
  decodeImageDataUrl,
  sniffImageMime,
  validateImageBytes,
} from "./mcp/image-bytes"
import {
  MAX_REQUEST_BYTES,
  MAX_PACKAGE_ASSET_BYTES,
  MAX_ASSET_BYTES,
} from "./mcp/protocol"
import {
  createBlankProject,
  referencedAssets,
  syncActiveCanvasToProject,
  type Project,
} from "@/lib/pocket-draft/models"

const DB_NAME = "ipocket-pocket-draft"
const DB_VERSION = 2
const ACTIVE_PROJECT_SETTING_KEY = "active_project_id"
const CLIPBOARD_ASSETS_SETTING_KEY = "clipboard_asset_refs"
const PENDING_ASSETS_KEY = "pending_asset_leases"
const ASSET_GRACE_MS = 5 * 60_000

async function writeTransaction<T>(
  stores: string[],
  work: (tx: IDBTransaction) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted()
  const db = await openDb()
  const tx = db.transaction(stores, "readwrite")
  const abort = () => {
    try {
      tx.abort()
    } catch {
      /* Already committed. */
    }
  }
  const completed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () =>
      reject(
        signal?.aborted
          ? signal.reason
          : (tx.error ?? new Error("storage_aborted"))
      )
    tx.onerror = () => {
      /* onabort reports the final transaction outcome. */
    }
  })
  // A request may reject first; observe both errors without an unhandled rejection.
  void completed.catch(() => {})
  signal?.addEventListener("abort", abort, { once: true })
  try {
    signal?.throwIfAborted()
    const result = await work(tx)
    await completed
    return result
  } catch (error) {
    abort()
    await completed.catch(() => {})
    throw error
  } finally {
    signal?.removeEventListener("abort", abort)
    db.close()
  }
}

export async function getAssets(
  refs: Iterable<string>
): Promise<Record<string, Blob>> {
  const db = await openDb()
  try {
    const store = db.transaction("assets", "readonly").objectStore("assets")
    const entries = await Promise.all(
      [...refs].map(
        async (ref) =>
          [
            ref,
            await requestToPromise<Blob | undefined>(store.get(ref)),
          ] as const
      )
    )
    return Object.fromEntries(
      entries.filter((entry): entry is readonly [string, Blob] => !!entry[1])
    )
  } finally {
    db.close()
  }
}

export async function assetAdditions(
  assets: Record<string, Blob>,
  signal?: AbortSignal
) {
  if (!Object.keys(assets).length)
    return Object.create(null) as Record<string, Blob>
  const existing = await getAssets(Object.keys(assets))
  const additions: Record<string, Blob> = Object.create(null)
  for (const [ref, blob] of Object.entries(assets)) {
    signal?.throwIfAborted()
    if (!existing[ref]) {
      additions[ref] = blob
      continue
    }
    const [left, right] = await Promise.all([
      existing[ref].arrayBuffer(),
      blob.arrayBuffer(),
    ])
    const a = new Uint8Array(left),
      b = new Uint8Array(right)
    if (a.length !== b.length || a.some((byte, index) => byte !== b[index]))
      throw new Error(`asset_reference_collision: ${ref}`)
  }
  return additions
}

export async function putAssets(assets: Record<string, Blob>): Promise<void> {
  const additions = await assetAdditions(assets)
  await writeTransaction(["assets", "settings"], async (tx) => {
    const store = tx.objectStore("assets"),
      settings = tx.objectStore("settings")
    const leases =
      (await requestToPromise<Record<string, number> | undefined>(
        settings.get(PENDING_ASSETS_KEY)
      )) ?? {}
    for (const [ref, blob] of Object.entries(additions)) store.add(blob, ref)
    for (const ref of Object.keys(assets))
      leases[ref] = Date.now() + ASSET_GRACE_MS
    settings.put(leases, PENDING_ASSETS_KEY)
  })
}

export type ProjectMeta = {
  id: string
  name: string
  canvasCount: number
  updatedAt: number
  createdAt: number
  thumbnail?: string
}

export type ProjectRecord = ProjectMeta & {
  project: Project
}

export type ProjectExportPackage = {
  version: 1
  type: "pocket-draft-project"
  exportedAt: number
  project: Project
  assets: Record<string, string> // assetRef -> base64 data url
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (event) => {
      const db = request.result
      if (!db.objectStoreNames.contains("projects")) {
        db.createObjectStore("projects", { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings")
      }
      if (!db.objectStoreNames.contains("assets")) {
        db.createObjectStore("assets")
      }
      // Migration from old single-draft store
      if (db.objectStoreNames.contains("drafts")) {
        const oldTx = (event.target as IDBOpenDBRequest).transaction
        if (oldTx) {
          const oldStore = oldTx.objectStore("drafts")
          const getReq = oldStore.get("current")
          getReq.onsuccess = () => {
            if (getReq.result?.project) {
              const proj = getReq.result.project as Project
              const projectsStore = oldTx.objectStore("projects")
              const meta: ProjectRecord = {
                id: proj.id || crypto.randomUUID(),
                name:
                  proj.name && proj.name !== "我的项目 1"
                    ? proj.name
                    : "Project 1",
                canvasCount: proj.canvases?.length || 1,
                updatedAt: getReq.result.updatedAt || Date.now(),
                createdAt: getReq.result.updatedAt || Date.now(),
                project: { ...proj, id: proj.id || crypto.randomUUID() },
              }
              projectsStore.put(meta)
              const settingsStore = oldTx.objectStore("settings")
              settingsStore.put(meta.id, ACTIVE_PROJECT_SETTING_KEY)
            }
          }
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function normalizeProject(raw: Project, fallbackName = "Project 1"): Project {
  const project = { ...raw }
  if (!project.id) project.id = crypto.randomUUID()
  if (
    !project.name ||
    project.name === "我的项目 1" ||
    project.name === "未命名项目"
  ) {
    project.name = fallbackName
  }
  if (!project.canvases || project.canvases.length === 0) {
    const defaultProject = createBlankProject(
      project.canvasAspect || "portrait45"
    )
    project.canvases = defaultProject.canvases
    project.activeCanvasId = defaultProject.activeCanvasId
  }
  if (
    !project.activeCanvasId ||
    !project.canvases.some((c) => c.id === project.activeCanvasId)
  ) {
    project.activeCanvasId = project.canvases[0].id
  }
  project.schemaVersion = 2
  return syncActiveCanvasToProject(project)
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const db = await openDb()
  const tx = db.transaction("projects", "readonly")
  const records = await requestToPromise<ProjectRecord[]>(
    tx.objectStore("projects").getAll()
  )
  db.close()

  if (!records || records.length === 0) {
    return []
  }

  return records
    .map((r) => ({
      id: r.id,
      name:
        r.name && r.name !== "我的项目 1" && r.name !== "未命名项目"
          ? r.name
          : r.project?.name &&
              r.project.name !== "我的项目 1" &&
              r.project.name !== "未命名项目"
            ? r.project.name
            : "Project 1",
      canvasCount: r.project?.canvases?.length || r.canvasCount || 1,
      updatedAt: r.updatedAt || Date.now(),
      createdAt: r.createdAt || r.updatedAt || Date.now(),
      thumbnail: r.thumbnail,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function loadProject(id: string): Promise<Project | null> {
  const db = await openDb()
  const tx = db.transaction("projects", "readonly")
  const record = await requestToPromise<ProjectRecord | undefined>(
    tx.objectStore("projects").get(id)
  )
  db.close()
  if (!record?.project) return null
  return normalizeProject(record.project, record.name)
}

async function writeProjectRecord(
  tx: IDBTransaction,
  project: Project,
  thumbnail?: string
) {
  const store = tx.objectStore("projects")
  const existing = await requestToPromise<ProjectRecord | undefined>(
    store.get(project.id)
  )
  const now = Date.now()
  store.put({
    id: project.id,
    name: project.name,
    canvasCount: project.canvases.length,
    updatedAt: now,
    createdAt: existing?.createdAt ?? now,
    thumbnail: thumbnail ?? existing?.thumbnail,
    project,
  } satisfies ProjectRecord)
}

export async function saveProject(
  project: Project,
  thumbnail?: string
): Promise<void> {
  const normalized = normalizeProject(project)
  await writeTransaction(["projects", "settings"], async (tx) => {
    await writeProjectRecord(tx, normalized, thumbnail)
    tx.objectStore("settings").put(normalized.id, ACTIVE_PROJECT_SETTING_KEY)
  })
}

/** Commit assets, project and active selection together. No staged MCP assets can be pruned by another tab. */
export async function saveProjectWithAssets(
  project: Project,
  assets: Record<string, Blob>,
  options: {
    signal?: AbortSignal
    guard?: () => void
    previousProject?: Project
    expectedStored?: { id: string; project: Project | null }
  } = {}
): Promise<Project> {
  const normalized = normalizeProject(project)
  const additions = await assetAdditions(assets, options.signal)
  await writeTransaction(
    ["projects", "assets", "settings"],
    async (tx) => {
      const store = tx.objectStore("assets")
      if (options.expectedStored) {
        const saved = await requestToPromise<ProjectRecord | undefined>(
          tx.objectStore("projects").get(options.expectedStored.id)
        )
        if (
          JSON.stringify(
            saved ? normalizeProject(saved.project, saved.name) : null
          ) !== JSON.stringify(options.expectedStored.project)
        )
          throw new Error("storage_conflict: another tab changed this project")
      }
      options.guard?.()
      for (const [ref, blob] of Object.entries(additions)) store.add(blob, ref)
      // Reads share the write transaction: cleanup cannot run between this check and commit.
      for (const ref of referencedAssets(normalized)) {
        if (
          !additions[ref] &&
          (await requestToPromise(store.getKey(ref))) === undefined
        )
          throw new Error(`missing_asset: ${ref}`)
      }
      if (
        options.previousProject &&
        options.previousProject.id !== normalized.id
      )
        await writeProjectRecord(tx, normalizeProject(options.previousProject))
      await writeProjectRecord(tx, normalized)
      options.guard?.()
      tx.objectStore("settings").put(normalized.id, ACTIVE_PROJECT_SETTING_KEY)
    },
    options.signal
  )
  return normalized
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(["projects", "settings"], "readwrite")
  await requestToPromise(tx.objectStore("projects").delete(id))
  const currentActive = await requestToPromise<string | undefined>(
    tx.objectStore("settings").get(ACTIVE_PROJECT_SETTING_KEY)
  )
  if (currentActive === id) {
    await requestToPromise(
      tx.objectStore("settings").delete(ACTIVE_PROJECT_SETTING_KEY)
    )
  }
  db.close()
}

export async function getActiveProjectId(): Promise<string | null> {
  const db = await openDb()
  const tx = db.transaction("settings", "readonly")
  const id = await requestToPromise<string | undefined>(
    tx.objectStore("settings").get(ACTIVE_PROJECT_SETTING_KEY)
  )
  db.close()
  return id ?? null
}

export async function setActiveProjectId(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction("settings", "readwrite")
  await requestToPromise(
    tx.objectStore("settings").put(id, ACTIVE_PROJECT_SETTING_KEY)
  )
  db.close()
}

/**
 * 记住"当前被复制到剪贴板"的资源引用。
 *
 * 自动保存会在每次改动后调用 pruneAssets，而它的 keep 集合来自本标签页的
 * 历史记录。跨标签页复制粘贴时，B 页的一次自动保存就会把 A 页刚复制的
 * 资源当作垃圾删掉。所以复制时把引用落到 settings 里，pruneAssets 一律保留。
 */
export async function retainClipboardAssets(refs: string[]): Promise<void> {
  const db = await openDb()
  const tx = db.transaction("settings", "readwrite")
  await requestToPromise(
    tx.objectStore("settings").put(refs, CLIPBOARD_ASSETS_SETTING_KEY)
  )
  db.close()
}

export async function getRetainedClipboardAssets(): Promise<string[]> {
  const db = await openDb()
  const tx = db.transaction("settings", "readonly")
  const refs = await requestToPromise<string[] | undefined>(
    tx.objectStore("settings").get(CLIPBOARD_ASSETS_SETTING_KEY)
  )
  db.close()
  return Array.isArray(refs) ? refs : []
}

export async function duplicateProject(
  id: string,
  newName?: string
): Promise<Project> {
  const original = await loadProject(id)
  if (!original) throw new Error("Project not found")

  const cloned = structuredClone(original)
  cloned.id = crypto.randomUUID()
  cloned.name = newName || `${original.name || "Project"} (Copy)`
  cloned.canvases = cloned.canvases.map((c) => ({
    ...c,
    id: crypto.randomUUID(),
    layers: c.layers.map((l) => ({ ...l, id: crypto.randomUUID() })),
  }))
  cloned.activeCanvasId = cloned.canvases[0].id

  await saveProject(cloned)
  return cloned
}

export async function createNewProject(
  name?: string,
  _locale = "en"
): Promise<Project> {
  const list = await listProjects()
  const nextNum = list.length + 1
  const defaultName = name || `Project ${nextNum}`
  const project = createBlankProject("portrait45")
  project.name = defaultName
  project.canvases[0].name = "Canvas 1"
  await saveProject(project)
  return project
}

export async function putAsset(ref: string, blob: Blob): Promise<void> {
  await putAssets({ [ref]: blob })
}

export async function getAsset(ref: string): Promise<Blob | null> {
  const db = await openDb()
  const tx = db.transaction("assets", "readonly")
  const blob = await requestToPromise<Blob | undefined>(
    tx.objectStore("assets").get(ref)
  )
  db.close()
  return blob ?? null
}

export async function pruneAssets(keep?: Set<string>): Promise<void> {
  await writeTransaction(["projects", "assets", "settings"], async (tx) => {
    const assets = tx.objectStore("assets"),
      settings = tx.objectStore("settings")
    const records = await requestToPromise<ProjectRecord[]>(
      tx.objectStore("projects").getAll()
    )
    const refs = new Set(keep)
    const clipboard = await requestToPromise<string[] | undefined>(
      settings.get(CLIPBOARD_ASSETS_SETTING_KEY)
    )
    for (const ref of clipboard ?? []) refs.add(ref)
    for (const record of records)
      for (const ref of referencedAssets(record.project)) refs.add(ref)
    const leases =
      (await requestToPromise<Record<string, number> | undefined>(
        settings.get(PENDING_ASSETS_KEY)
      )) ?? {}
    const live = Object.fromEntries(
      Object.entries(leases).filter(([, until]) => until > Date.now())
    )
    for (const ref of Object.keys(live)) refs.add(ref)
    const keys = await requestToPromise(assets.getAllKeys())
    for (const key of keys) if (!refs.has(String(key))) assets.delete(key)
    settings.put(live, PENDING_ASSETS_KEY)
  })
}

// Backward compatibility helper
export async function saveDraft(project: Project): Promise<void> {
  await saveProject(project)
}

export async function loadDraft(): Promise<Project | null> {
  const activeId = await getActiveProjectId()
  if (activeId) {
    const p = await loadProject(activeId)
    if (p) return p
  }
  const all = await listProjects()
  if (all.length > 0) {
    const p = await loadProject(all[0].id)
    if (p) return p
  }
  return null
}

/**
 * Package project and all its referenced assets into a downloadable .pocketdraft Blob
 */
export async function exportProjectPackage(
  project: Project,
  getAssetBlob: (ref: string) => Promise<Blob | null>,
  signal?: AbortSignal
): Promise<Blob> {
  const assets: Record<string, string> = Object.create(null)
  let bytes = 0
  for (const ref of referencedAssets(project)) {
    signal?.throwIfAborted()
    const blob = await getAssetBlob(ref)
    if (!blob) throw new Error(`missing_asset: ${ref}`)
    bytes += blob.size
    if (blob.size > MAX_ASSET_BYTES || bytes > MAX_PACKAGE_ASSET_BYTES)
      throw new Error(
        "package_too_large: project packages support 8 MiB per image and 32 MiB total"
      )
    validateImageBytes(new Uint8Array(await blob.arrayBuffer()))
    assets[ref] = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      const abort = () => reader.abort()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error(`image_read_failed: ${ref}`))
      reader.onabort = () => reject(signal?.reason ?? new Error("cancelled"))
      reader.onloadend = () => signal?.removeEventListener("abort", abort)
      signal?.addEventListener("abort", abort, { once: true })
      reader.readAsDataURL(blob)
      if (signal?.aborted) reader.abort()
    })
    // Keep export/import validation symmetric, including the declared MIME type.
    decodeImageDataUrl(assets[ref])
  }
  signal?.throwIfAborted()
  const pkg: ProjectExportPackage = {
    version: 1,
    type: "pocket-draft-project",
    exportedAt: Date.now(),
    project,
    assets,
  }
  return new Blob([JSON.stringify(pkg)], { type: "application/json" })
}

/**
 * Parse and restore an imported .pocketdraft or .json project package file
 */
export async function importProjectPackage(
  file: File
): Promise<{ project: Project; assets: Record<string, Blob> }> {
  if (file.size > MAX_REQUEST_BYTES)
    throw new Error("Project file exceeds 48 MiB")
  const parsed: unknown = JSON.parse(await file.text())
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid project file format")
  const raw = parsed as Record<string, unknown>
  const packaged = raw.type === "pocket-draft-project"
  if (packaged && raw.version !== 1)
    throw new Error("Unsupported project package version")
  const project = validateProject(packaged ? raw.project : raw)
  const assets: Record<string, Blob> = Object.create(null)
  const sources = packaged ? (raw.assets ?? {}) : {}
  if (!sources || typeof sources !== "object" || Array.isArray(sources))
    throw new Error("Invalid project assets")
  let total = 0
  for (const [ref, source] of Object.entries(sources)) {
    if (typeof source !== "string") throw new Error(`Invalid asset: ${ref}`)
    const bytes = decodeImageDataUrl(source)
    total += bytes.byteLength
    if (total > MAX_PACKAGE_ASSET_BYTES)
      throw new Error("Project assets exceed 32 MiB")
    assets[ref] = new Blob([new Uint8Array(bytes)], {
      type: sniffImageMime(bytes)!,
    })
  }
  for (const ref of referencedAssets(project)) {
    if (!assets[ref]) throw new Error(`Missing project asset: ${ref}`)
  }
  project.id = crypto.randomUUID()
  project.name =
    (project.name || file.name.replace(/\.[^/.]+$/, "")) + " (导入)"
  await saveProjectWithAssets(project, assets)

  return { project, assets }
}
