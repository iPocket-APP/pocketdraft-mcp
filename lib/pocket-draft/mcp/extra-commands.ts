import {
  MAXIMUM_CANVAS_COUNT,
  MAXIMUM_DEVICE_COPIES,
  MAXIMUM_LAYER_COUNT,
  deviceLayerCount,
  isDevice,
  syncActiveCanvasToProject,
  uniqueLayerName,
  type Project,
} from "../models"
import type { PocketDraftDocument } from "./document"
import { editable, operationError, syncLayout, uniqueTarget } from "./precision"

export function extraCommand(
  command: string,
  document: PocketDraftDocument,
  input: Record<string, unknown>
): { project: Project; copyMap?: Record<string, string> } | undefined {
  const project = document.project
  const sourceId = String(input.canvasId ?? project.activeCanvasId)
  const source = project.canvases.find((c) => c.id === sourceId)
  if (!source)
    operationError("not_found", "Unknown canvas.", sourceId, "canvasId")
  const replace = (next: typeof source) =>
    syncActiveCanvasToProject({
      ...project,
      canvases: project.canvases.map((c) => (c.id === next.id ? next : c)),
    })
  if (command === "layout.sync") return { project: syncLayout(project, input) }
  if (command === "canvases.duplicate") {
    if (project.canvases.length >= MAXIMUM_CANVAS_COUNT)
      operationError("limit_reached", "Canvas limit reached.")
    const copyMap: Record<string, string> = {},
      copy = structuredClone(source)
    copy.id = crypto.randomUUID()
    copyMap[source.id] = copy.id
    copy.name =
      typeof input.name === "string" ? input.name : `${source.name} (Copy)`
    copy.layers.forEach((layer) => {
      const old = layer.id
      layer.id = crypto.randomUUID()
      copyMap[old] = layer.id
    })
    return {
      project: syncActiveCanvasToProject({
        ...project,
        canvases: [...project.canvases, copy],
        activeCanvasId: copy.id,
      }),
      copyMap,
    }
  }
  if (command === "canvases.reorder") {
    const ids = input.canvasIds as string[]
    if (
      ids.length !== project.canvases.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !project.canvases.some((c) => c.id === id))
    )
      operationError(
        "invalid_input",
        "canvasIds must contain every canvas exactly once.",
        undefined,
        "canvasIds"
      )
    return {
      project: {
        ...project,
        canvases: ids.map((id) => project.canvases.find((c) => c.id === id)!),
      },
    }
  }
  if (command === "layers.duplicate") {
    const layer = source.layers.find((l) => l.id === input.layerId)
    if (!layer)
      operationError(
        "not_found",
        "Unknown layer.",
        String(input.layerId),
        "layerId"
      )
    if (layer.content.kind === "background")
      operationError(
        "invalid_input",
        "Background cannot be duplicated.",
        layer.id
      )
    const target = project.canvases.find(
      (c) => c.id === (input.targetCanvasId ?? sourceId)
    )
    if (!target)
      operationError(
        "not_found",
        "Unknown target canvas.",
        String(input.targetCanvasId)
      )
    if (
      target.layers.length >= MAXIMUM_LAYER_COUNT ||
      (isDevice(layer) && deviceLayerCount(target) >= MAXIMUM_DEVICE_COPIES)
    )
      operationError(
        "limit_reached",
        "Target layer/device limit reached.",
        target.id
      )
    const copy = structuredClone(layer)
    copy.id = crypto.randomUUID()
    copy.name = uniqueLayerName(
      typeof input.name === "string" ? input.name : layer.name,
      target.layers.map((l) => l.name)
    )
    return {
      project: replace({ ...target, layers: [...target.layers, copy] }),
      copyMap: { [layer.id]: copy.id },
    }
  }
  if (command === "devices.clearScreenshot") {
    const layer = uniqueTarget(source.layers, "device", String(input.layerId))
    editable(layer)
    return {
      project: replace({
        ...source,
        layers: source.layers.map((l) =>
          l.id === layer.id && l.content.kind === "device"
            ? {
                ...l,
                content: {
                  ...l.content,
                  screenshotRef: null,
                  screenshotZoom: 1,
                  screenshotOffset: { x: 0, y: 0 },
                },
              }
            : l
        ),
      }),
    }
  }
}
