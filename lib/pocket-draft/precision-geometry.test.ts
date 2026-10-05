import { describe, expect, it } from "vitest"
import {
  createBlankProject,
  createTextLayer,
  createDeviceLayer,
  syncActiveCanvasToProject,
} from "./models"
import { applyGeometryOperation } from "./precision-geometry"
import { layerGeometry, cropBounds, projectIssues } from "./inspection"
function fixture() {
  const p = createBlankProject("square")
  p.canvases[0].layers.push(
    ...[0, 1, 2].map((i) => {
      const layer = createTextLayer({
        name: "Text",
        string: "Title",
        fontSize: 32,
        boxWidth: 160,
      })
      if (layer.content.kind === "text")
        layer.content.pill = {
          color: { r: 1, g: 1, b: 1, a: 1 },
          paddingX: 10,
          paddingY: 8,
          cornerRadius: 8,
        }
      layer.transform.center = { x: 0.2 + i * 0.3, y: 0.4 + i * 0.1 }
      layer.transform.rotation = (i * Math.PI) / 12
      return layer
    })
  )
  return syncActiveCanvasToProject(p)
}
describe("precision geometry", () => {
  it("moves in logical pixels, aligns rotated pill bounds, and distributes exact gaps", () => {
    let p = fixture(),
      c = p.canvases[0]
    const ids = c.layers.slice(1).map((l) => l.id)
    const before = layerGeometry(c.layers[1], c).center
    p = applyGeometryOperation(p, "layers.move", {
      layerId: ids[0],
      dx: 0,
      dy: -12,
    })
    expect(
      layerGeometry(p.layers[1], p.canvases[0]).center.y - before.y
    ).toBeCloseTo(-12, 8)
    p = applyGeometryOperation(p, "layers.align", {
      layerIds: ids,
      alignment: "left",
      reference: "canvas",
      margin: 24,
    })
    for (const layer of p.layers.slice(1))
      expect(layerGeometry(layer, p.canvases[0]).bounds.x).toBeCloseTo(24, 8)
    p = applyGeometryOperation(p, "layers.distribute", {
      layerIds: ids,
      axis: "y",
      gap: 24,
    })
    c = p.canvases[0]
    const bounds = c.layers
      .slice(1)
      .map((l) => layerGeometry(l, c).bounds)
      .sort((a, b) => a.y - b.y)
    for (let i = 1; i < bounds.length; i++)
      expect(bounds[i].y - bounds[i - 1].y - bounds[i - 1].height).toBeCloseTo(
        24,
        8
      )
  })
  it("resizes proportionally and refuses incompatible dimensions", () => {
    const p = fixture(),
      layerId = p.layers[1].id
    expect(() =>
      applyGeometryOperation(p, "layers.resize", {
        layerId,
        width: 300,
        height: 300,
      })
    ).toThrow("preserves aspect ratio")
    const result = applyGeometryOperation(p, "layers.resize", {
      layerId,
      width: 300,
    })
    expect(
      layerGeometry(result.layers[1], result.canvases[0]).frame.width
    ).toBeCloseTo(300, 8)
    const rotated = applyGeometryOperation(result, "layers.rotate", {
      layerId,
      degrees: 30,
    })
    expect(rotated.layers[1].transform.rotation).toBeCloseTo(Math.PI / 6)
  })
  it("fits within explicit font/line limits or errors without changing text", () => {
    const p = fixture(),
      layerId = p.layers[1].id
    const fitted = applyGeometryOperation(p, "texts.fit", {
      layerId,
      width: 200,
      height: 80,
      minFontSize: 10,
      maxFontSize: 40,
      maxLines: 1,
    })
    expect(
      layerGeometry(fitted.layers[1], fitted.canvases[0]).frame.height
    ).toBeLessThanOrEqual(80)
    expect(fitted.layers[1].content).toMatchObject({ string: "Title" })
    expect(() =>
      applyGeometryOperation(p, "texts.fit", {
        layerId,
        width: 10,
        height: 10,
        minFontSize: 30,
        maxFontSize: 40,
      })
    ).toThrow("does not fit")
  })
  it("validates crop limits, reuses assets with reset crop and preserves orientation/geometry", () => {
    let p = fixture()
    const device = createDeviceLayer({
      name: "Device",
      deviceId: "iphone-17-pro",
      frameId: "silver",
    })
    p.canvases[0].layers.push(device)
    p = syncActiveCanvasToProject(p)
    if (device.content.kind !== "device") throw new Error()
    device.content.orientation = "landscape"
    device.content.screenshotRef = "old"
    device.content.screenshotZoom = 2
    const images = {
      old: { width: 1000, height: 2000 },
      replacement: { width: 900, height: 1700 },
    }
    const limit = cropBounds(device, p.canvases[0], images.old)
    expect(() =>
      applyGeometryOperation(
        p,
        "devices.setCrop",
        { layerId: device.id, offset: { x: (limit.x + 1) * 10000 } },
        images
      )
    ).toThrow("Offset")
    const result = applyGeometryOperation(
      p,
      "assets.reuse",
      { layerId: device.id, target: "screenshot", assetRef: "replacement" },
      images
    )
    expect(result.layers.at(-1)?.transform).toEqual(device.transform)
    expect(result.layers.at(-1)?.content).toMatchObject({
      orientation: "landscape",
      screenshotZoom: 1,
      screenshotOffset: { x: 0, y: 0 },
      screenshotRef: "replacement",
    })
  })
  it("reports bounds/missing assets, permits overlapping layers, and catches crop overflow", () => {
    const p = fixture(),
      device = createDeviceLayer({
        name: "Device",
        deviceId: "iphone-17-pro",
        frameId: "silver",
      })
    p.canvases[0].layers.push(device)
    if (device.content.kind !== "device") throw new Error()
    device.content.screenshotRef = "lost"
    const issues = projectIssues(p, {}, new Set())
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "missing_asset" })
    )
    expect(issues.some((i) => i.code.includes("overlap"))).toBe(false)
    device.content.screenshotOffset.x = 99
    expect(
      projectIssues(p, { lost: { width: 100, height: 200 } }, new Set(["lost"]))
    ).toContainEqual(expect.objectContaining({ code: "crop_out_of_bounds" }))
  })
})

it("keeps exact maximum font sizes and finds a positive line height with negative spacing", () => {
  const p = fixture(),
    text = p.layers[1]
  if (text.content.kind !== "text") throw new Error()
  text.content.lineSpacing = -35
  const next = applyGeometryOperation(p, "texts.fit", {
    layerId: text.id,
    width: 1200,
    height: 300,
    minFontSize: 8,
    maxFontSize: 40,
  })
  expect(next.layers[1].content).toMatchObject({
    fontSize: 40,
    string: "Title",
  })
})
