import type { Layer, Project } from "../models"
import { syncActiveCanvasToProject } from "../models"
import {
  CanvasQuickLayoutEngine,
  FULL_QUICK_LAYOUT_SCOPE,
  type QuickLayoutScope,
} from "../quick-layout"
import { PocketDraftMcpError } from "./errors"

export function operationError(
  code: string,
  message: string,
  objectId?: string,
  path = "",
  hint = "Inspect the target and correct this field before retrying."
): never {
  const error = new PocketDraftMcpError(code, message, [{ path, message }])
  error.objectId = objectId
  error.hint = hint
  throw error
}
export function editable(layer: Layer) {
  if (layer.isLocked)
    operationError(
      "layer_locked",
      "Unlock this layer in a separate preceding command.",
      layer.id,
      "layerId"
    )
}
export const CONTENT_FIELDS = {
  text: [
    "string",
    "fontName",
    "fontSize",
    "weight",
    "alignment",
    "color",
    "lineSpacing",
    "kerning",
    "boxWidth",
    "stroke",
    "shadow",
    "pill",
  ],
  device: [
    "deviceId",
    "frameId",
    "orientation",
    "screenshotZoom",
    "screenshotOffset",
    "shadowIntensity",
  ],
  image: ["aspectRatio", "cornerRadius"],
  background: [],
} as const
const contentFields = new Set(Object.values(CONTENT_FIELDS).flat())
export function validateLayerPatch(
  layer: Layer,
  input: Record<string, unknown>
) {
  const flat = Object.keys(input).filter((key) =>
    contentFields.has(key as never)
  )
  if (input.content !== undefined && flat.length)
    operationError(
      "conflicting_fields",
      "Use either content or top-level content fields, not both.",
      layer.id,
      "content"
    )
  const patch = (input.content ??
    Object.fromEntries(flat.map((key) => [key, input[key]]))) as Record<
    string,
    unknown
  >
  for (const key of Object.keys(patch)) {
    if (
      !(CONTENT_FIELDS[layer.content.kind] as readonly string[]).includes(key)
    )
      operationError(
        "unsupported_property",
        `${key} is not a ${layer.content.kind} property.`,
        layer.id,
        `content.${key}`
      )
  }
  if (layer.content.kind === "background" && input.transform !== undefined)
    operationError(
      "unsupported_property",
      "Background geometry follows the canvas.",
      layer.id,
      "transform"
    )
  const keys = Object.keys(input).filter(
    (key) =>
      ![
        "document",
        "project",
        "assets",
        "assetMode",
        "schemaVersion",
        "locale",
        "layerId",
        "canvasId",
        "isLocked",
        "isVisible",
      ].includes(key)
  )
  if (layer.isLocked && keys.length) editable(layer)
  return patch
}
export function uniqueTarget(
  layers: Layer[],
  kind: Layer["content"]["kind"],
  id?: string
) {
  const candidates = id
    ? layers.filter((layer) => layer.id === id)
    : layers.filter((layer) => layer.content.kind === kind)
  if (candidates.length !== 1) {
    const error = new PocketDraftMcpError(
      candidates.length ? "ambiguous_target" : "not_found",
      candidates.length
        ? "Specify layerId from the returned candidates."
        : `No ${kind} target found.`,
      [{ path: "layerId", message: "Select exactly one existing layer ID." }]
    )
    error.objectId = id
    error.hint =
      "Inspect the target and select an explicit layerId before retrying."
    error.candidates = candidates.map((layer) => ({
      id: layer.id,
      name: layer.name,
      kind: layer.content.kind,
    }))
    throw error
  }
  if (candidates[0].content.kind !== kind)
    operationError(
      "wrong_layer_type",
      `Expected a ${kind} layer.`,
      candidates[0].id,
      "layerId"
    )
  return candidates[0]
}

export function syncLayout(project: Project, input: Record<string, unknown>) {
  const sourceId = String(input.sourceCanvasId ?? project.activeCanvasId)
  const source = project.canvases.find((c) => c.id === sourceId)
  if (!source)
    operationError(
      "not_found",
      "Unknown source canvas.",
      sourceId,
      "sourceCanvasId"
    )
  const targetIds = input.targetCanvasIds as string[]
  if (
    !targetIds?.length ||
    new Set(targetIds).size !== targetIds.length ||
    targetIds.includes(sourceId)
  )
    operationError(
      "invalid_input",
      "Provide distinct targetCanvasIds excluding the source.",
      sourceId,
      "targetCanvasIds"
    )
  const scope = {
    ...FULL_QUICK_LAYOUT_SCOPE,
    ...(input.scope as Partial<QuickLayoutScope>),
  }
  if (!Object.values(scope).some(Boolean))
    operationError(
      "invalid_input",
      "Choose at least one synchronization scope.",
      sourceId,
      "scope"
    )
  const mapping = input.mapping as
    | Array<{
        targetCanvasId: string
        sourceLayerId: string
        targetLayerId: string
      }>
    | undefined
  if (mapping?.some((m) => !targetIds.includes(m.targetCanvasId)))
    operationError(
      "invalid_input",
      "Mapping includes an unrequested target canvas.",
      undefined,
      "mapping"
    )
  const fields = input.fields as string[] | undefined
  const kindEnabled = (l: Layer) =>
    l.content.kind === "background"
      ? scope.background
      : scope[
          l.content.kind === "device"
            ? "devices"
            : l.content.kind === "text"
              ? "texts"
              : "images"
        ]
  const targets = targetIds.map((id) => {
    const target = project.canvases.find((c) => c.id === id)
    if (!target)
      operationError(
        "not_found",
        "Unknown target canvas.",
        id,
        "targetCanvasIds"
      )
    if (scope.canvasSize) target.layers.forEach(editable)
    const pairs = mapping?.filter((m) => m.targetCanvasId === id)
    if (pairs) {
      if (!pairs.length)
        operationError(
          "layout_mismatch",
          "Provide mappings for every requested target.",
          id,
          "mapping"
        )
      const ids = new Set<string>()
      const sources: Layer[] = [],
        destinations: Layer[] = []
      for (const pair of pairs) {
        const a = source.layers.find((l) => l.id === pair.sourceLayerId),
          b = target.layers.find((l) => l.id === pair.targetLayerId)
        if (
          !a ||
          !b ||
          a.content.kind !== b.content.kind ||
          a.content.kind === "background" ||
          !kindEnabled(a) ||
          ids.has(b.id)
        )
          operationError(
            "layout_mismatch",
            "Mapping must pair enabled layers of the same type without duplicate targets.",
            id,
            "mapping"
          )
        editable(b)
        ids.add(b.id)
        sources.push(a)
        destinations.push(b)
      }
      if (scope.background) editable(target.layers[0])
      const synced = CanvasQuickLayoutEngine.apply(
        { ...source, layers: [source.layers[0], ...sources] },
        { ...target, layers: [target.layers[0], ...destinations] },
        scope
      )
      return {
        ...synced,
        layers: target.layers.map(
          (layer) => synced.layers.find((l) => l.id === layer.id) ?? layer
        ),
      }
    }
    const info = CanvasQuickLayoutEngine.analyze(
      project,
      sourceId,
      scope
    ).targets.find((t) => t.id === id)!
    if (!info.isEligible)
      operationError(
        "layout_mismatch",
        "Canvas layer structure does not match. Supply an explicit layer mapping.",
        id,
        "targetCanvasIds"
      )
    for (const layer of target.layers.filter(kindEnabled)) editable(layer)
    return CanvasQuickLayoutEngine.apply(source, target, scope)
  })
  const canvases = project.canvases.map((original) => {
    const next = targets.find((c) => c.id === original.id)
    if (!next) return original
    return {
      ...next,
      layers: next.layers.map((layer) => {
        const before = original.layers.find((l) => l.id === layer.id)!
        if (layer.content.kind === "background") return layer
        const filtered = {
          ...layer,
          transform:
            !fields || fields.includes("transform")
              ? layer.transform
              : before.transform,
          opacity:
            !fields || fields.includes("opacity")
              ? layer.opacity
              : before.opacity,
          content:
            !fields || fields.includes("style")
              ? layer.content
              : before.content,
        }
        if (
          filtered.content.kind === "device" &&
          before.content.kind === "device" &&
          JSON.stringify(filtered.transform) ===
            JSON.stringify(before.transform)
        )
          filtered.content = {
            ...filtered.content,
            wasManuallyTransformed: before.content.wasManuallyTransformed,
          }
        return filtered
      }),
    }
  })
  return syncActiveCanvasToProject({ ...project, canvases })
}

export type Change = { canvasId?: string; layerId?: string; fields: string[] }
export function projectChanges(before: Project | undefined, after: Project) {
  const changes: Change[] = []
  const created: {
    projectId?: string
    canvases: string[]
    layers: Array<{ canvasId: string; layerId: string }>
  } = {
    ...(!before || before.id !== after.id ? { projectId: after.id } : {}),
    canvases: [],
    layers: [],
  }
  if (
    !before ||
    before.name !== after.name ||
    before.id !== after.id ||
    before.activeCanvasId !== after.activeCanvasId ||
    before.canvases.map((c) => c.id).join() !==
      after.canvases.map((c) => c.id).join()
  )
    changes.push({ fields: ["project"] })
  for (const canvas of after.canvases) {
    const old = before?.canvases.find((c) => c.id === canvas.id)
    if (!old) {
      created.canvases.push(canvas.id)
      changes.push({ canvasId: canvas.id, fields: ["created"] })
    } else {
      const fields = ["name", "canvasAspect", "canvasLogicalSize"].filter(
        (key) =>
          JSON.stringify(old[key as keyof typeof old]) !==
          JSON.stringify(canvas[key as keyof typeof canvas])
      )
      if (
        old.layers.map((l) => l.id).join() !==
        canvas.layers.map((l) => l.id).join()
      )
        fields.push("layerOrder")
      if (fields.length) changes.push({ canvasId: canvas.id, fields })
    }
    for (const layer of canvas.layers) {
      const previous = old?.layers.find((l) => l.id === layer.id)
      if (!previous) {
        created.layers.push({ canvasId: canvas.id, layerId: layer.id })
        changes.push({
          canvasId: canvas.id,
          layerId: layer.id,
          fields: ["created"],
        })
        continue
      }
      const fields = Object.keys(layer).filter(
        (key) =>
          key !== "content" &&
          JSON.stringify(layer[key as keyof Layer]) !==
            JSON.stringify(previous[key as keyof Layer])
      )
      for (const key of new Set([
        ...Object.keys(layer.content),
        ...Object.keys(previous.content),
      ]))
        if (
          JSON.stringify(
            (layer.content as unknown as Record<string, unknown>)[key]
          ) !==
          JSON.stringify(
            (previous.content as unknown as Record<string, unknown>)[key]
          )
        )
          fields.push(`content.${key}`)
      if (fields.length)
        changes.push({ canvasId: canvas.id, layerId: layer.id, fields })
    }
    for (const layer of old?.layers ?? [])
      if (!canvas.layers.some((l) => l.id === layer.id))
        changes.push({
          canvasId: canvas.id,
          layerId: layer.id,
          fields: ["deleted"],
        })
  }
  for (const canvas of before?.canvases ?? [])
    if (!after.canvases.some((c) => c.id === canvas.id))
      changes.push({ canvasId: canvas.id, fields: ["deleted"] })
  return { changed: changes.length > 0, changes, created }
}
