import { z } from "zod"
import { validateProject } from "./mcp/validation"
import { decodeImageDataUrl, sniffImageMime } from "./mcp/image-bytes"
import { MAX_PACKAGE_ASSET_BYTES } from "./mcp/protocol"
import { referencedAssets, type Project } from "./models"
import {
  getAssets,
  getAsset,
  exportProjectPackage,
  assetAdditions,
} from "./storage"
import { bitmapFromBlob, bitmapFromUrl, type ImageSource } from "./assets"
import { frameAssetPath, frameCacheKey, isVectorDevice } from "./catalog"
import { ensurePocketDraftFonts } from "./bundled-fonts"
import { renderCanvasBlob, renderCanvasSlicesBlob } from "./renderer"
import {
  bridgeDocumentSchema,
  previewOptionsSchema,
  type AssetManifest,
} from "./bridge-protocol"
import { abortable } from "./abort"
import { COMMAND_SCHEMAS, GEOMETRY_COMMANDS } from "./mcp/commands"
import type { MutationCommand } from "./mcp/protocol"
import { applyGeometryOperation } from "./precision-geometry"
import {
  inspectionOptionsSchema,
  inspectLayers,
  projectIssues,
} from "./inspection"

export async function projectRevision(project: Project) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(project))
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

export async function browserSnapshot(project: Project, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const [revision, blobs] = await Promise.all([
    projectRevision(project),
    getAssets(referencedAssets(project)),
  ])
  signal?.throwIfAborted()
  const assets: AssetManifest = Object.fromEntries(
    Object.entries(blobs).map(([ref, blob]) => [
      ref,
      { bytes: blob.size, mimeType: blob.type },
    ])
  )
  return { revision, project, assets }
}

export function closeImage(image: ImageSource) {
  if ("close" in image) image.close()
}

/** Incoming assets are additions only. Existing browser assets stay in IndexedDB. */
export async function prepareBridgeDocument(
  value: unknown,
  signal?: AbortSignal,
  cached: Record<string, ImageSource> = {},
  allowMissing = false,
  cache?: BridgeImageCache
) {
  signal?.throwIfAborted()
  const raw = bridgeDocumentSchema.parse(value),
    project = validateProject(raw.project)
  const refs = referencedAssets(project),
    stored = await getAssets(refs)
  const blobs: Record<string, Blob> = Object.create(null),
    images: Record<string, ImageSource> = Object.create(null)
  const borrowed = new Set<string>()
  const dispose = () => {
    for (const [ref, image] of Object.entries(images))
      if (!borrowed.has(ref)) closeImage(image)
  }
  try {
    let total = 0
    for (const ref of refs) {
      signal?.throwIfAborted()
      const source = raw.assets[ref]
      if (source !== undefined) {
        const bytes = decodeImageDataUrl(source)
        total += bytes.length
        if (total > MAX_PACKAGE_ASSET_BYTES) throw new Error("assets_too_large")
        blobs[ref] = new Blob([new Uint8Array(bytes)], {
          type: sniffImageMime(bytes)!,
        })
      }
      const blob = blobs[ref] ?? stored[ref]
      if (!blob) {
        if (allowMissing) continue
        throw new Error(`missing_asset: ${ref}`)
      }
      if (!cached[ref]) {
        if (cache && !blobs[ref]) {
          images[ref] = await cache.get(
            `measurement:${ref}`,
            () => bitmapFromBlob(blob),
            signal
          )
          borrowed.add(ref)
        } else
          images[ref] = await abortable(
            bitmapFromBlob(blob),
            signal,
            closeImage
          )
      }
    }
    await assetAdditions(blobs, signal)
    signal?.throwIfAborted()
    return {
      project,
      blobs,
      images,
      dispose,
      assets: Object.fromEntries(
        [...refs].flatMap((ref) => {
          const blob = blobs[ref] ?? stored[ref]
          return blob ? [[ref, { bytes: blob.size, mimeType: blob.type }]] : []
        })
      ) as AssetManifest,
    }
  } catch (error) {
    dispose()
    cache?.trim()
    throw error
  }
}

const renderInput = z.object({
  ...previewOptionsSchema.shape,
  canvasId: z.string().optional(),
  preview: z.boolean().default(false),
  format: z.enum(["png", "jpeg"]).default("png"),
  scale: z.number().min(0.1).max(4).optional(),
  slices: z.boolean().default(false),
  quality: z.number().min(0).max(1).optional(),
  transparentBackground: z.boolean().default(false),
})
async function dataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const reader = new FileReader(),
      abort = () => reader.abort()
    reader.onload = () => resolve(String(reader.result).split(",")[1])
    reader.onerror = () => reject(new Error("image_read_failed"))
    reader.onabort = () => reject(signal?.reason ?? new Error("cancelled"))
    reader.onloadend = () => signal?.removeEventListener("abort", abort)
    signal?.addEventListener("abort", abort, { once: true })
    reader.readAsDataURL(blob)
    if (signal?.aborted) reader.abort()
  })
}

/** Per-connection LRU. Evict after rendering, so an in-use bitmap is never closed. */
export class BridgeImageCache {
  private entries = new Map<string, ImageSource>()
  constructor(private budget = 64 * 1024 * 1024) {}
  async get(
    key: string,
    load: () => Promise<ImageSource>,
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted()
    let image = this.entries.get(key)
    if (!image) image = await abortable(load(), signal, closeImage)
    this.entries.delete(key)
    this.entries.set(key, image)
    return image
  }
  trim() {
    let bytes = [...this.entries.values()].reduce(
      (n, image) => n + image.width * image.height * 4,
      0
    )
    for (const [key, image] of this.entries) {
      if (bytes <= this.budget) break
      bytes -= image.width * image.height * 4
      closeImage(image)
      this.entries.delete(key)
    }
  }
  close() {
    for (const image of this.entries.values()) closeImage(image)
    this.entries.clear()
  }
}

export async function renderBridgeProject(
  project: Project,
  input: unknown,
  signal?: AbortSignal,
  cache?: BridgeImageCache,
  suppliedImages: Record<string, ImageSource> = {}
) {
  const options = renderInput.parse(input)
  const canvas = project.canvases.find(
    (item) => item.id === (options.canvasId ?? project.activeCanvasId)
  )
  if (!canvas) throw new Error("canvas_not_found")
  const ownedCache = cache ?? new BridgeImageCache()
  const images: Record<string, ImageSource> = Object.create(null)
  try {
    await abortable(ensurePocketDraftFonts(), signal)
    for (const ref of referencedAssets({ ...project, canvases: [canvas] })) {
      if (suppliedImages[ref]) {
        images[ref] = suppliedImages[ref]
        continue
      }
      const blob = await getAsset(ref)
      if (!blob) throw new Error(`missing_asset: ${ref}`)
      images[ref] = await ownedCache.get(
        `asset:${ref}:${options.preview}`,
        () => bitmapFromBlob(blob, options.preview ? 2048 : Infinity),
        signal
      )
    }
    for (const layer of canvas.layers) {
      const content = layer.content
      if (content.kind !== "device" || isVectorDevice(content.deviceId))
        continue
      const key = frameCacheKey(
        content.deviceId,
        content.frameId,
        content.orientation
      )
      images[key] ??= await ownedCache.get(
        `frame:${key}`,
        () =>
          bitmapFromUrl(
            frameAssetPath(
              content.deviceId,
              content.frameId,
              content.orientation
            ),
            signal
          ),
        signal
      )
    }
    signal?.throwIfAborted()
    const region = options.region ?? { x: 0, y: 0, ...canvas.canvasLogicalSize }
    const scale =
      options.scale ??
      (options.preview
        ? Math.min(1, 1024 / Math.max(region.width, region.height))
        : 1)
    const settings = {
      scale,
      region: options.region,
      showBounds: options.showBounds,
      format: options.preview ? ("jpeg" as const) : options.format,
      quality: options.quality,
      transparentBackground: options.transparentBackground,
    }
    const blobs = await abortable(
      options.slices && !options.preview
        ? renderCanvasSlicesBlob(canvas, images, settings)
        : renderCanvasBlob(canvas, images, settings).then((blob) => [blob]),
      signal
    )
    if (blobs.reduce((total, blob) => total + blob.size, 0) > 32 * 1024 * 1024)
      throw new Error("export_too_large: reduce the scale")
    const files = []
    for (const [index, blob] of blobs.entries())
      files.push({
        name: `${canvas.id}-${index + 1}`,
        canvasId: canvas.id,
        canvasName: canvas.name,
        slice: options.slices && !options.preview ? index + 1 : null,
        width:
          options.slices && !options.preview
            ? index === 0
              ? Math.round(Math.round(region.width * scale) / 2)
              : Math.round(region.width * scale) -
                Math.round(Math.round(region.width * scale) / 2)
            : Math.round(region.width * scale),
        height: Math.round(region.height * scale),
        mimeType: blob.type,
        data: await dataUrl(blob, signal),
      })
    return { files }
  } finally {
    if (cache) cache.trim()
    else ownedCache.close()
  }
}

export async function exportBridgePackage(
  project: Project,
  signal?: AbortSignal
) {
  const blob = await exportProjectPackage(project, getAsset, signal)
  return {
    files: [
      {
        name: "project.pocketdraft",
        mimeType: "application/json",
        data: await dataUrl(blob, signal),
      },
    ],
  }
}

/** Browser-only measurements and previews of an isolated candidate; never writes storage/history. */
export async function evaluateBridgeDocument(
  value: unknown,
  input: Record<string, unknown>,
  signal?: AbortSignal,
  cache?: BridgeImageCache,
  availableRefs: ReadonlySet<string> = new Set()
) {
  const readonly =
    input.operation === "inspect" || input.operation === "validate"
  const prepared = await prepareBridgeDocument(
    value,
    signal,
    {},
    readonly,
    cache
  )
  try {
    await abortable(ensurePocketDraftFonts(), signal)
    let project = prepared.project
    if (input.command === "assets.reuse") {
      const ref = z.object({ assetRef: z.string() }).parse(input.input).assetRef
      if (!prepared.images[ref] && availableRefs.has(ref)) {
        const blob = await getAsset(ref)
        if (blob)
          prepared.images[ref] = await abortable(
            bitmapFromBlob(blob),
            signal,
            closeImage
          )
      }
    }
    if (typeof input.command === "string") {
      const command = input.command as MutationCommand
      if (
        command !== ("devices.validateCrop" as string) &&
        !GEOMETRY_COMMANDS.has(command)
      )
        throw new Error("unsupported_command")
      const params =
        input.command === "devices.validateCrop"
          ? z
              .object({ canvasId: z.string().optional(), layerId: z.string() })
              .strict()
              .parse(input.input)
          : COMMAND_SCHEMAS[command].parse(input.input)
      project = validateProject(
        applyGeometryOperation(project, input.command, params, prepared.images)
      )
    }
    signal?.throwIfAborted()
    return {
      project,
      ...(input.operation === "inspect"
        ? {
            canvases: inspectLayers(
              project,
              inspectionOptionsSchema.parse(input.options ?? {}),
              true
            ),
          }
        : {}),
      ...(input.operation === "validate"
        ? {
            issues: projectIssues(
              project,
              prepared.images,
              new Set(Object.keys(prepared.images))
            ),
          }
        : {}),
      ...(input.preview
        ? {
            preview: await renderBridgeProject(
              project,
              { ...previewOptionsSchema.parse(input.preview), preview: true },
              signal,
              undefined,
              prepared.images
            ),
          }
        : {}),
    }
  } finally {
    prepared.dispose()
    cache?.trim()
  }
}
