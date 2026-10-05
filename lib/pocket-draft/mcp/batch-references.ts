import { operationError } from "./precision"
export type BatchReference = {
  kind: "canvas" | "layer"
  id: string
  canvasId: string
}
const layerKeys = new Set([
  "layerId",
  "sourceLayerId",
  "targetLayerId",
  "referenceLayerId",
  "layerIds",
])
const canvasKeys = new Set([
  "canvasId",
  "sourceCanvasId",
  "targetCanvasId",
  "targetCanvasIds",
  "canvasIds",
])
export function resolveBatchInput(
  input: Record<string, unknown>,
  references: Map<string, BatchReference>
) {
  const resolved = structuredClone(input)
  let impliedCanvas: string | undefined
  const visit = (value: unknown, key: string): unknown => {
    if (Array.isArray(value)) return value.map((v) => visit(v, key))
    if (
      value &&
      typeof value === "object" &&
      "ref" in value &&
      (layerKeys.has(key) || canvasKeys.has(key))
    ) {
      const name = String(value.ref),
        ref = references.get(name)
      if (!ref || ref.kind !== (layerKeys.has(key) ? "layer" : "canvas"))
        operationError(
          "invalid_reference",
          `Unknown or wrong-kind batch reference ${name}.`,
          undefined,
          key
        )
      if (["layerId", "layerIds", "referenceLayerId"].includes(key)) {
        if (impliedCanvas && impliedCanvas !== ref.canvasId)
          operationError(
            "invalid_reference",
            "Selected layer references belong to different canvases.",
            ref.id,
            key
          )
        impliedCanvas = ref.canvasId
      }
      return ref.id
    }
    if (key === "mapping" && value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, visit(v, k)])
      )
    return value
  }
  for (const [key, value] of Object.entries(resolved))
    resolved[key] = visit(value, key)
  if (impliedCanvas) {
    if (resolved.canvasId && resolved.canvasId !== impliedCanvas)
      operationError(
        "invalid_reference",
        "canvasId does not contain the referenced layer.",
        impliedCanvas,
        "canvasId"
      )
    resolved.canvasId ??= impliedCanvas
  }
  return resolved
}
