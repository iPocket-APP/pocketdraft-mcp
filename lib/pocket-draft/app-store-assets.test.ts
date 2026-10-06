import { describe, expect, it } from "vitest"
import {
  APP_STORE_ASSETS,
  APP_STORE_ASSET_ASPECTS,
  assetExportIssues,
  assetSafeArea,
  centeredAssetCrop,
  commonAssetExportOptions,
} from "./app-store-assets"
import {
  createBlankCanvas,
  createBlankProject,
  createDeviceLayer,
  createImageLayer,
  createTextLayer,
  syncActiveCanvasToProject,
} from "./models"
import { normalizedCustomSize } from "./geometry"
import { projectIssues } from "./inspection"
import {
  TEMPLATES,
  applyTemplateSetToProject,
  applyTemplateToCanvas,
} from "./templates"
import { getCatalog, listCatalog } from "./mcp/catalog"
import { previewMutation } from "./mcp/mutations"
import { validateProject } from "./mcp/validation"
import { HistoryManager } from "./history"
import {
  BRIDGE_CAPABILITIES,
  BRIDGE_PROTOCOL_VERSION,
  compatibleBridge,
} from "./bridge-protocol"

describe("App Store creative assets", () => {
  it("discovers all five sizes and nine creative templates by category", () => {
    expect(listCatalog("aspects", { query: "App Store" })).toHaveLength(5)
    expect(listCatalog("templates", { query: "App Store" })).toHaveLength(9)
  })
  it.each(APP_STORE_ASSET_ASPECTS)(
    "creates and round-trips %s through the MCP schema",
    async (aspect) => {
      const created = await previewMutation("projects.create", { aspect })
      const project = validateProject(
        JSON.parse(JSON.stringify(created.document.project))
      )
      expect(project.schemaVersion).toBe(2)
      expect(project.canvases[0].canvasLogicalSize).toEqual(
        APP_STORE_ASSETS[aspect].size
      )
      expect(
        assetExportIssues(project.canvases[0], { format: "png", scale: 1 })
      ).toEqual([])
      expect(getCatalog("aspects", aspect)).toHaveProperty("assetSpec")
    }
  )
  it("accepts 5244 and rejects oversize/non-finite input in UI and MCP size paths", async () => {
    expect(normalizedCustomSize(5244, 2950)).toEqual({
      width: 5244,
      height: 2950,
    })
    for (const edge of [5244.1, 5245, NaN, Infinity, 0])
      expect(normalizedCustomSize(edge, 2950)).toBeNull()
    const created = await previewMutation("projects.create", {})
    const updated = await previewMutation("canvases.setAspect", {
      document: created.document,
      aspect: "appStoreUniversal",
    })
    expect(updated.document.project.canvasLogicalSize.width).toBe(5244)
    await expect(
      previewMutation("canvases.setAspect", {
        document: created.document,
        aspect: "custom",
        width: 5245,
        height: 2950,
      })
    ).rejects.toThrow()
    const custom = await previewMutation("canvases.setAspect", {
      document: updated.document,
      aspect: "custom",
      width: 5244,
      height: 2950,
    })
    expect(
      assetExportIssues(custom.document.project.canvases[0], {
        format: "jpeg",
        scale: 0.5,
      })
    ).toEqual([])
  })
  it("keeps historical 5760-pixel Mac panoramas readable", () => {
    const old = createBlankProject("macAppStore")
    old.canvases[0].canvasLogicalSize = { width: 5760, height: 1800 }
    expect(validateProject(old).canvasLogicalSize.width).toBe(5760)
  })
  it("enforces fixed size, encoding options and whole-image exports", () => {
    const canvas = createBlankCanvas("appStoreUniversal")
    for (const change of [
      { scale: 0.5 },
      { scale: 2 },
      { format: "jpeg" as const },
      { transparentBackground: true },
      { slices: true },
      { showBounds: true },
      { region: { x: 0, y: 0, width: 5244, height: 2950 } },
    ])
      expect(
        assetExportIssues(canvas, { scale: 1, format: "png", ...change }).length
      ).toBeGreaterThan(0)
    canvas.canvasLogicalSize.width = 4096
    expect(assetExportIssues(canvas, { scale: 1, format: "png" })[0].code).toBe(
      "asset_dimensions"
    )
  })
  it.each([
    "appStoreSearch",
    "appStoreEventCard",
    "appStoreEventDetails",
  ] as const)("accepts the resolution range for %s", (aspect) => {
    const canvas = createBlankCanvas(aspect)
    for (const scale of [0.5, 0.75, 1])
      expect(assetExportIssues(canvas, { scale, format: "jpeg" })).toEqual([])
    for (const scale of [0.49, 1.01])
      expect(assetExportIssues(canvas, { scale, format: "png" })).not.toEqual(
        []
      )
    canvas.canvasLogicalSize.height -= 1
    expect(assetExportIssues(canvas, { scale: 1, format: "png" })[0].code).toBe(
      "asset_dimensions"
    )
  })
  it("intersects mixed export options without changing generic transparent PNG support", () => {
    expect(commonAssetExportOptions([createBlankCanvas("square")])).toEqual({
      scales: [1, 2, 3],
      formats: ["png", "jpeg"],
      opaque: false,
    })
    expect(
      commonAssetExportOptions([
        createBlankCanvas("appStoreHeader"),
        createBlankCanvas("appStoreEventCard"),
      ])
    ).toEqual({ scales: [1], formats: ["png"], opaque: true })
    expect(
      commonAssetExportOptions([createBlankCanvas("appStoreSearch")]).scales
    ).toEqual([0.5, 1])
  })
  it("uses actual safe-area coordinates and reports overflow only as a warning", () => {
    const project = createBlankProject("appStoreUniversal"),
      canvas = project.canvases[0]
    expect(assetSafeArea(canvas)).toEqual({
      x: 1921,
      y: 660,
      width: 1402,
      height: 962,
    })
    expect(assetSafeArea(createBlankCanvas("appStoreHeader"))).toEqual({
      x: 1097,
      y: 493,
      width: 1646,
      height: 661,
    })
    expect(assetSafeArea(createBlankCanvas("appStoreSearch"))).toEqual({
      x: 836,
      y: 765,
      width: 2168,
      height: 1030,
    })
    const text = createTextLayer({
      name: "Headline",
      string: "Hello",
      fontSize: 80,
    })
    text.transform.center = { x: 0.1, y: 0.1 }
    canvas.layers.push(text)
    expect(
      projectIssues(project, {}, new Set()).find(
        (i) => i.code === "asset_safe_area"
      )
    ).toMatchObject({ severity: "warning", layerId: text.id })
    text.isVisible = false
    expect(
      projectIssues(project, {}, new Set()).some(
        (i) => i.code === "asset_safe_area"
      )
    ).toBe(false)
    const device = createDeviceLayer({
      deviceId: "iphone-17-pro",
      frameId: "silver",
      name: "Device",
    })
    device.transform.center = { x: 0.1, y: 0.1 }
    canvas.layers.push(device)
    expect(
      projectIssues(project, {}, new Set()).find(
        (i) => i.code === "asset_safe_area"
      )
    ).toMatchObject({ severity: "warning", layerId: device.id })
    expect(
      assetSafeArea(createBlankCanvas("appStoreEventCard"))
    ).toBeUndefined()
    const crop = centeredAssetCrop(canvas.canvasLogicalSize, "search")
    expect(crop.width / crop.height).toBe(1.5)
    expect(crop.x * 2 + crop.width).toBe(5244)
  })
  it("keeps hero content editable and appends an undoable event pair without overwriting canvases", () => {
    const original = createBlankProject(),
      history = new HistoryManager(original)
    original.canvases[0].layers.push(
      createImageLayer({ assetRef: "photo.png", aspectRatio: 1.5 })
    )
    const hero = applyTemplateToCanvas(
      original.canvases[0],
      TEMPLATES.find((t) => t.id === "asset-hero-appStoreHeader")!,
      "en"
    )
    expect(hero.layers.map((l) => l.content.kind)).toEqual([
      "background",
      "image",
      "text",
    ])
    expect(
      projectIssues(
        syncActiveCanvasToProject({ ...original, canvases: [hero] }),
        {},
        new Set(["photo.png"])
      ).some((i) => i.code === "asset_safe_area")
    ).toBe(false)
    const paired = applyTemplateSetToProject(
      original,
      TEMPLATES.find((t) => t.id === "asset-event-pair")!,
      "en"
    )
    expect(paired.canvases[0]).toEqual(original.canvases[0])
    expect(paired.canvases.slice(1).map((c) => c.layers[0].content)).toEqual(
      Array(2).fill({
        kind: "background",
        devicePadding: 0.08,
        fill: {
          kind: "image",
          assetRef: "photo.png",
          blurRadius: 0,
          dimming: 0,
        },
      })
    )
    history.commit(paired, "Events")
    expect(history.undo()?.canvases.length).toBe(1)
    expect(history.redo()?.canvases.length).toBe(3)
    const full = {
      ...original,
      canvases: Array.from({ length: 9 }, () => createBlankCanvas()),
    }
    expect(() =>
      applyTemplateSetToProject(
        full,
        TEMPLATES.find((t) => t.id === "asset-event-pair")!,
        "en"
      )
    ).toThrow("canvas_limit")
    expect(full.canvases.length).toBe(9)
  })
  it("rejects a bridge without creative asset support before pairing", () => {
    expect(
      compatibleBridge({
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        capabilities: BRIDGE_CAPABILITIES,
      })
    ).toBe(true)
    expect(
      compatibleBridge({
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        capabilities: BRIDGE_CAPABILITIES.filter(
          (c) => c !== "app-store-assets"
        ),
      })
    ).toBe(false)
  })
})
