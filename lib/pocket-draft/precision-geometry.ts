import { geometryFor } from "./catalog"
import {
  displayedFrame,
  minTextBoxWidth,
  textLayout,
  measureLongestLine,
} from "./geometry"
import { cropBounds, layerGeometry } from "./inspection"
import {
  syncActiveCanvasToProject,
  type Project,
  type Layer,
  type Rect,
  type Size,
} from "./models"
import { editable, operationError, uniqueTarget } from "./mcp/precision"

/** Called only after the browser has loaded fonts and decoded relevant assets. No storage writes. */
export function applyGeometryOperation(
  original: Project,
  command: string,
  input: Record<string, unknown>,
  images: Record<string, Size> = {}
) {
  const project = structuredClone(original)
  const canvasId = String(input.canvasId ?? project.activeCanvasId)
  const canvas = project.canvases.find((c) => c.id === canvasId)
  if (!canvas)
    operationError("not_found", "Unknown canvas.", canvasId, "canvasId")
  const find = (id: string) => {
    const layer = canvas.layers.find((l) => l.id === id)
    if (!layer) operationError("not_found", "Unknown layer.", id, "layerId")
    return layer
  }
  const bounds = (layer: Layer) => layerGeometry(layer, canvas).bounds
  const translate = (layer: Layer, dx: number, dy: number) => {
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return
    layer.transform.center.x += dx / canvas.canvasLogicalSize.width
    layer.transform.center.y += dy / canvas.canvasLogicalSize.height
    if (layer.content.kind === "device")
      layer.content.wasManuallyTransformed = true
  }
  const checkCrop = (layer: Layer) => {
    if (layer.content.kind !== "device")
      operationError("wrong_layer_type", "Expected device layer.", layer.id)
    const content = layer.content,
      ref = content.screenshotRef
    if (!ref) {
      if (
        content.screenshotZoom !== 1 ||
        content.screenshotOffset.x ||
        content.screenshotOffset.y
      )
        operationError(
          "missing_screenshot",
          "Attach a screenshot before changing its crop.",
          layer.id
        )
      return
    }
    if (!images[ref])
      operationError("missing_asset", "Screenshot is missing.", ref)
    const max = cropBounds(layer, canvas, images[ref])
    if (
      content.screenshotZoom < 1 ||
      content.screenshotZoom > 3 ||
      Math.abs(content.screenshotOffset.x) > max.x + 1e-8 ||
      Math.abs(content.screenshotOffset.y) > max.y + 1e-8
    )
      operationError(
        "crop_out_of_bounds",
        `Offset must be within ±${max.x} horizontally and ±${max.y} vertically; zoom must be 1–3.`,
        layer.id,
        "screenshotOffset"
      )
  }
  if (command === "assets.reuse") {
    if (input.target !== "screenshot" && input.cropPolicy !== undefined)
      operationError(
        "unsupported_property",
        "cropPolicy applies only to screenshots.",
        typeof input.layerId === "string" ? input.layerId : undefined,
        "cropPolicy"
      )
    const ref = String(input.assetRef),
      image = images[ref]
    if (!image)
      operationError(
        "missing_asset",
        "Referenced asset is not available in this project.",
        ref,
        "assetRef"
      )
    const kind =
      input.target === "background"
        ? "background"
        : input.target === "image"
          ? "image"
          : "device"
    const layer = uniqueTarget(
      canvas.layers,
      kind,
      typeof input.layerId === "string" ? input.layerId : undefined
    )
    editable(layer)
    if (layer.content.kind === "image")
      layer.content = {
        ...layer.content,
        assetRef: ref,
        aspectRatio: image.width / image.height,
      }
    else if (layer.content.kind === "background")
      layer.content.fill = {
        kind: "image",
        assetRef: ref,
        blurRadius:
          layer.content.fill.kind === "image"
            ? layer.content.fill.blurRadius
            : 0,
        dimming:
          layer.content.fill.kind === "image" ? layer.content.fill.dimming : 0,
      }
    else if (layer.content.kind === "device") {
      layer.content.screenshotRef = ref
      if (input.cropPolicy !== "preserve") {
        layer.content.screenshotZoom = 1
        layer.content.screenshotOffset = { x: 0, y: 0 }
      }
      checkCrop(layer)
    }
    return syncActiveCanvasToProject(project)
  }
  if (command === "devices.validateCrop") {
    checkCrop(find(String(input.layerId)))
    return syncActiveCanvasToProject(project)
  }
  const ids = Array.isArray(input.layerIds)
    ? (input.layerIds as string[])
    : [String(input.layerId)]
  if (new Set(ids).size !== ids.length)
    operationError(
      "invalid_input",
      "Specify each layer once.",
      undefined,
      "layerIds"
    )
  const layers = ids.map(find)
  for (const layer of layers) {
    editable(layer)
    if (layer.content.kind === "background")
      operationError(
        "wrong_layer_type",
        "Background geometry follows the canvas.",
        layer.id
      )
  }
  const layer = layers[0]
  if (command === "layers.move")
    translate(layer, Number(input.dx), Number(input.dy))
  else if (command === "layers.position") {
    translate(
      layer,
      Number(input.x) -
        layer.transform.center.x * canvas.canvasLogicalSize.width,
      Number(input.y) -
        layer.transform.center.y * canvas.canvasLogicalSize.height
    )
  } else if (command === "layers.resize") {
    const frame = displayedFrame(layer, canvas, canvas.canvasLogicalSize)
    const width = input.width as number | undefined,
      height = input.height as number | undefined
    if (width === undefined && height === undefined)
      operationError("invalid_input", "Specify width or height.", layer.id)
    const factor =
      width !== undefined ? width / frame.width : height! / frame.height
    if (
      height !== undefined &&
      width !== undefined &&
      Math.abs(frame.height * factor - height) > 0.5
    )
      operationError(
        "aspect_ratio_conflict",
        "Resize preserves aspect ratio. Specify one dimension or proportional dimensions.",
        layer.id
      )
    const scale = layer.transform.scale * factor
    if (!Number.isFinite(scale) || scale < 0.1 || scale > 8)
      operationError(
        "invalid_input",
        "Requested dimensions exceed the 0.1–8 scale range.",
        layer.id
      )
    if (Math.abs(layer.transform.scale - scale) > 1e-10) {
      layer.transform.scale = scale
      if (layer.content.kind === "device")
        layer.content.wasManuallyTransformed = true
    }
  } else if (command === "layers.rotate") {
    const rotation =
      (input.relative ? layer.transform.rotation : 0) +
      (Number(input.degrees) * Math.PI) / 180
    if (Math.abs(layer.transform.rotation - rotation) > 1e-10) {
      layer.transform.rotation = rotation
      if (layer.content.kind === "device")
        layer.content.wasManuallyTransformed = true
    }
  } else if (command === "layers.align") {
    const reference = input.reference ?? "canvas"
    if ((reference === "layer") !== (input.referenceLayerId !== undefined))
      operationError(
        "invalid_input",
        "referenceLayerId is required only with reference=layer.",
        undefined,
        "referenceLayerId"
      )
    let box: Rect = { x: 0, y: 0, ...canvas.canvasLogicalSize }
    if (reference === "layer")
      box = bounds(find(String(input.referenceLayerId)))
    if (reference === "selection") {
      const boxes = layers.map(bounds),
        x = Math.min(...boxes.map((b) => b.x)),
        y = Math.min(...boxes.map((b) => b.y))
      box = {
        x,
        y,
        width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
        height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
      }
    }
    const margin = Number(input.margin ?? 0)
    for (const item of layers) {
      const b = bounds(item)
      const dx =
        input.alignment === "left"
          ? box.x + margin - b.x
          : input.alignment === "right"
            ? box.x + box.width - margin - b.x - b.width
            : input.alignment === "centerX"
              ? box.x + box.width / 2 + margin - b.x - b.width / 2
              : 0
      const dy =
        input.alignment === "top"
          ? box.y + margin - b.y
          : input.alignment === "bottom"
            ? box.y + box.height - margin - b.y - b.height
            : input.alignment === "centerY"
              ? box.y + box.height / 2 + margin - b.y - b.height / 2
              : 0
      translate(item, dx, dy)
    }
  } else if (command === "layers.distribute") {
    const horizontal = input.axis === "x",
      axis = horizontal ? "x" : "y",
      extent = horizontal ? "width" : "height"
    const sorted = layers
      .map((item) => ({ layer: item, box: bounds(item) }))
      .sort((a, b) => a.box[axis] - b.box[axis])
    const first = sorted[0].box,
      last = sorted.at(-1)!.box
    const gap =
      input.gap === undefined
        ? (last[axis] +
            last[extent] -
            first[axis] -
            sorted.reduce((n, x) => n + x.box[extent], 0)) /
          (sorted.length - 1)
        : Number(input.gap)
    if (gap < 0)
      operationError(
        "insufficient_space",
        "The fixed endpoints cannot fit non-overlapping layers. Supply an explicit gap."
      )
    let position = first[axis]
    for (const item of sorted) {
      const delta = position - item.box[axis]
      translate(item.layer, horizontal ? delta : 0, horizontal ? 0 : delta)
      position += item.box[extent] + gap
    }
  } else if (command === "texts.reflow" || command === "texts.fit") {
    if (layer.content.kind !== "text")
      operationError("wrong_layer_type", "Expected text layer.", layer.id)
    const content = layer.content,
      scale = layer.transform.scale
    const width =
      Number(input.width) / scale - (content.pill?.paddingX ?? 0) * 2
    if (command === "texts.reflow") {
      if (width < minTextBoxWidth(content))
        operationError(
          "text_fit",
          "Width is below the text box minimum.",
          layer.id,
          "width"
        )
      content.boxWidth = width
    } else {
      const min = Number(input.minFontSize),
        max = Number(input.maxFontSize),
        height =
          Number(input.height) / scale - (content.pill?.paddingY ?? 0) * 2
      if (min > max)
        operationError(
          "invalid_input",
          "minFontSize must not exceed maxFontSize.",
          layer.id
        )
      const fits = (size: number) => {
        const test = { ...content, fontSize: size, boxWidth: width },
          layout = textLayout(test, canvas.canvasLogicalSize)
        return (
          width >= minTextBoxWidth(test) &&
          layout.lineHeight > 0 &&
          layout.height <= height + 1e-6 &&
          layout.width <= width + 1e-6 &&
          measureLongestLine(test, layout.lines) <= width + 1e-6 &&
          (input.maxLines === undefined ||
            layout.lines.length <= Number(input.maxLines))
        )
      }
      const lower = Math.max(
        min,
        Math.ceil(((-content.lineSpacing + 0.01) / 1.25) * 100) / 100
      )
      if (lower > max || !fits(lower))
        operationError(
          "text_fit",
          "Text does not fit at the minimum font size. Increase the box or reduce minFontSize.",
          layer.id
        )
      let low = lower,
        high = max
      for (let i = 0; i < 24; i++) {
        const middle = (low + high) / 2
        if (fits(middle)) low = middle
        else high = middle
      }
      content.fontSize = fits(max)
        ? max
        : Math.max(lower, Math.floor(low * 100) / 100)
      content.boxWidth = width
    }
  } else if (command === "devices.setCrop" || command === "devices.resetCrop") {
    if (layer.content.kind !== "device")
      operationError("wrong_layer_type", "Expected device layer.", layer.id)
    if (command === "devices.resetCrop") {
      layer.content.screenshotZoom = 1
      layer.content.screenshotOffset = { x: 0, y: 0 }
    } else {
      if (input.zoom === undefined && input.offset === undefined)
        operationError("invalid_input", "Specify zoom or offset.", layer.id)
      if (input.zoom !== undefined)
        layer.content.screenshotZoom = Number(input.zoom)
      const offset = input.offset as
        | Partial<{ x: number; y: number }>
        | undefined
      const frame = displayedFrame(layer, canvas, canvas.canvasLogicalSize)
      const screen = geometryFor(
        layer.content.deviceId,
        layer.content.orientation
      ).frame
      layer.content.screenshotOffset = {
        x:
          offset?.x === undefined
            ? layer.content.screenshotOffset.x
            : offset.x / (frame.width * screen.width),
        y:
          offset?.y === undefined
            ? layer.content.screenshotOffset.y
            : offset.y / (frame.height * screen.height),
      }
    }
    checkCrop(layer)
  } else
    operationError(
      "unsupported_command",
      `Unknown geometry command ${command}.`
    )
  return syncActiveCanvasToProject(project)
}
