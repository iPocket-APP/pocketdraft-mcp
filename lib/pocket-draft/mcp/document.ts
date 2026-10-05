import { inspectLayers } from "../inspection"
import type { AssetManifest } from "../bridge-protocol"
import { decodeImageDataUrl } from "./image-bytes"
import { assertAllowedAssetUrl } from "./url-policy"
import { withCallContext, callContext } from "./call-context"
import { z } from "zod"
import { validate, validateProject } from "./validation"
import {
  createBlankProject,
  referencedAssets,
  type Project,
} from "@/lib/pocket-draft/models"
import type { ProjectExportPackage } from "@/lib/pocket-draft/storage"

import { PocketDraftMcpError } from "@/lib/pocket-draft/mcp/errors"
import { resolveAssetSource } from "@/lib/pocket-draft/mcp/fetch-asset"
import { dataUrlByteLength } from "@/lib/pocket-draft/mcp/image-bytes"
import {
  MAX_PACKAGE_ASSET_BYTES,
  POCKETDRAFT_MCP_PROTOCOL_VERSION,
} from "@/lib/pocket-draft/mcp/protocol"

export type PocketDraftDocument = {
  schemaVersion: 1
  project: Project
  assets: Record<string, string>
}

export type AssetIndexEntry = {
  ref: string
  kind: "data" | "url" | "browser"
  bytes: number | null
  referenced: boolean
}

export type ProjectInspection = {
  projectId: string
  name: string
  schemaVersion: number
  activeCanvasId: string
  canvases: Array<{
    id: string
    name: string
    canvasAspect: string
    width: number
    height: number
    layers: ReturnType<typeof inspectLayers>[number]["layers"]
    layerCount: number
    devices: Array<{
      id: string
      name: string
      deviceId: string
      screenshotRef: string | null
      missingScreenshot: boolean
    }>
    texts: Array<{ id: string; name: string; string: string }>
    images: Array<{
      id: string
      name: string
      assetRef: string
      missingAsset: boolean
    }>
  }>
  assets: AssetIndexEntry[]
  missingAssetRefs: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function createEmptyDocument(
  aspect: Project["canvasAspect"] = "portrait45",
  name = ""
): PocketDraftDocument {
  const project = createBlankProject(aspect)
  if (name) project.name = name
  return {
    schemaVersion: POCKETDRAFT_MCP_PROTOCOL_VERSION,
    project,
    assets: {},
  }
}

export function pruneDocumentAssets(
  document: PocketDraftDocument
): PocketDraftDocument {
  const keep = referencedAssets(document.project)
  const assets: Record<string, string> = Object.create(null)
  for (const [ref, value] of Object.entries(document.assets)) {
    if (keep.has(ref) && typeof value === "string") assets[ref] = value
  }
  return { ...document, assets }
}

export function parseDocument(value: unknown): PocketDraftDocument {
  if (!isRecord(value)) {
    throw new PocketDraftMcpError(
      "invalid_input",
      "document must be an object."
    )
  }
  if (isRecord(value.project)) {
    validate(z.literal(1), value.schemaVersion)
    const schemaVersion = 1
    const assets = validate(
      z.record(z.string().min(1).max(256), z.string()),
      value.assets ?? {}
    )
    let totalBytes = 0
    for (const source of Object.values(assets)) {
      if (source.startsWith("data:")) {
        const cache = callContext()?.dataSizes
        const bytes =
          cache?.get(source) ?? decodeImageDataUrl(source).byteLength
        cache?.set(source, bytes)
        totalBytes += bytes
      } else assertAllowedAssetUrl(source)
      if (totalBytes > MAX_PACKAGE_ASSET_BYTES)
        throw new PocketDraftMcpError(
          "asset_error",
          "Document assets exceed 32 MiB."
        )
    }
    const cache = callContext()?.validatedProjects
    const project =
      cache?.get(value.project) ??
      validateProject(value.project, callContext()?.validatedCanvases)
    // Cache only validated outputs within this call; mutations construct new projects.
    cache?.set(project, project)
    return pruneDocumentAssets({
      schemaVersion,
      project,
      assets,
    })
  }
  if (Array.isArray(value.canvases)) {
    return pruneDocumentAssets({
      schemaVersion: 1,
      project: validateProject(value),
      assets: {},
    })
  }
  throw new PocketDraftMcpError(
    "invalid_input",
    "document must include a PocketDraft project."
  )
}

export function parseDocumentFromInput(
  input: Record<string, unknown>,
  required: boolean
): PocketDraftDocument | null {
  if (input.document !== undefined) return parseDocument(input.document)
  if (isRecord(input.project)) {
    return parseDocument({
      schemaVersion: 1,
      project: input.project,
      assets: isRecord(input.assets) ? input.assets : {},
    })
  }
  if (required) {
    throw new PocketDraftMcpError(
      "invalid_input",
      "input.document is required for this command."
    )
  }
  return null
}

export function assetIndex(document: PocketDraftDocument): AssetIndexEntry[] {
  const referenced = referencedAssets(document.project)
  const refs = new Set([...referenced, ...Object.keys(document.assets)])
  return [...refs].sort().map((ref) => {
    const value = document.assets[ref]
    return {
      ref,
      kind: value?.startsWith("data:") ? "data" : "url",
      bytes: value?.startsWith("data:") ? dataUrlByteLength(value) : null,
      referenced: referenced.has(ref),
    }
  })
}

export function inspectDocument(
  document: PocketDraftDocument,
  available: AssetManifest = {}
): ProjectInspection {
  const referenced = referencedAssets(document.project)
  const hasAsset = (ref: string) =>
    Object.hasOwn(document.assets, ref) || Object.hasOwn(available, ref)
  const missingAssetRefs: string[] = []
  const canvases = document.project.canvases.map((canvas) => {
    const devices = canvas.layers
      .filter((layer) => layer.content.kind === "device")
      .map((layer) => {
        const screenshotRef =
          layer.content.kind === "device" ? layer.content.screenshotRef : null
        const missingScreenshot = Boolean(
          !screenshotRef || !hasAsset(screenshotRef)
        )
        if (screenshotRef && missingScreenshot)
          missingAssetRefs.push(screenshotRef)
        return {
          id: layer.id,
          name: layer.name,
          deviceId:
            layer.content.kind === "device" ? layer.content.deviceId : "",
          screenshotRef,
          missingScreenshot,
        }
      })
    const texts = canvas.layers
      .filter((layer) => layer.content.kind === "text")
      .map((layer) => ({
        id: layer.id,
        name: layer.name,
        string: layer.content.kind === "text" ? layer.content.string : "",
      }))
    const images = canvas.layers
      .filter((layer) => layer.content.kind === "image")
      .map((layer) => {
        const assetRef =
          layer.content.kind === "image" ? layer.content.assetRef : ""
        const missingAsset = Boolean(assetRef && !hasAsset(assetRef))
        if (assetRef && missingAsset) missingAssetRefs.push(assetRef)
        return {
          id: layer.id,
          name: layer.name,
          assetRef,
          missingAsset,
        }
      })
    return {
      id: canvas.id,
      name: canvas.name,
      canvasAspect: canvas.canvasAspect,
      width: canvas.canvasLogicalSize.width,
      height: canvas.canvasLogicalSize.height,
      layerCount: canvas.layers.length,
      layers: inspectLayers(document.project, { canvasIds: [canvas.id] })[0]
        .layers,
      devices,
      texts,
      images,
    }
  })

  return {
    projectId: document.project.id,
    name: document.project.name,
    schemaVersion: document.project.schemaVersion,
    activeCanvasId: document.project.activeCanvasId,
    canvases,
    assets: [
      ...assetIndex(document).filter(
        (asset) =>
          Object.hasOwn(document.assets, asset.ref) ||
          !Object.hasOwn(available, asset.ref)
      ),
      ...Object.entries(available)
        .filter(
          ([ref]) => referenced.has(ref) && !Object.hasOwn(document.assets, ref)
        )
        .map(([ref, asset]) => ({
          ref,
          kind: "browser" as const,
          bytes: asset.bytes,
          referenced: referenced.has(ref),
        })),
    ],
    missingAssetRefs: [
      ...new Set([
        ...missingAssetRefs,
        ...[...referencedAssets(document.project)].filter(
          (ref) => !hasAsset(ref)
        ),
      ]),
    ],
  }
}

export async function exportProjectPackageFromDocument(
  document: PocketDraftDocument
): Promise<ProjectExportPackage> {
  return withCallContext(async () => {
    document = parseDocument(document)
    const refs = [...referencedAssets(document.project)]
    const assets: Record<string, string> = Object.create(null)
    let total = 0
    let next = 0
    let failure: unknown
    async function worker() {
      while (next < refs.length && !failure) {
        const ref = refs[next++]
        try {
          const existing = document.assets[ref]
          if (!existing)
            throw new PocketDraftMcpError(
              "missing_asset",
              `Missing asset: ${ref}`
            )
          const resolved = await resolveAssetSource(existing)
          if (
            !existing.startsWith("data:") &&
            /^[a-f0-9]{16}\.[a-z]+$/.test(ref) &&
            resolved.ref !== ref
          ) {
            throw new PocketDraftMcpError(
              "asset_changed",
              `Asset changed; attach it again: ${ref}`
            )
          }
          const dataUrl = resolved.dataUrl
          total += dataUrlByteLength(dataUrl)
          if (total > MAX_PACKAGE_ASSET_BYTES) {
            throw new PocketDraftMcpError(
              "asset_error",
              `Exported assets exceed ${MAX_PACKAGE_ASSET_BYTES} bytes.`
            )
          }
          assets[ref] = dataUrl
        } catch (error) {
          failure = error
        }
      }
    }
    await Promise.all([worker(), worker()])
    if (failure) throw failure

    return {
      version: 1,
      type: "pocket-draft-project",
      exportedAt: Date.now(),
      project: document.project,
      assets,
    }
  })
}
