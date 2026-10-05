import { describe, expect, it } from "vitest"

import { getCatalog, listCatalog } from "./catalog"
import { inspectDocument } from "./document"
import { PocketDraftMcpError } from "./errors"
import { assertAllowedAssetUrl } from "./fetch-asset"
import { previewMutation } from "./mutations"
import { MUTATION_COMMANDS, SCHEMA_RESOURCE_URI } from "./protocol"
import { POCKETDRAFT_SCHEMA_V1 } from "./schema"
import { LOCAL_MCP_TOOLS } from "../bridge-protocol"

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

describe("PocketDraft MCP surface", () => {
  it("keeps the tool list small and stable", () => {
    expect(LOCAL_MCP_TOOLS).toEqual([
      "pocketdraft_connection",
      "pocketdraft_list_catalog",
      "pocketdraft_get_catalog",
      "pocketdraft_inspect_project",
      "pocketdraft_batch_mutation",
      "pocketdraft_attach_file",
      "pocketdraft_preview",
      "pocketdraft_export",
      "pocketdraft_operation_status",
      "pocketdraft_validate_project",
      "pocketdraft_history",
    ])
    expect(MUTATION_COMMANDS).toContain("templates.applySet")
    expect(MUTATION_COMMANDS).toContain("assets.attach")
    expect(SCHEMA_RESOURCE_URI).toBe("pocketdraft://schema/v1")
    expect(POCKETDRAFT_SCHEMA_V1.tools).toEqual(LOCAL_MCP_TOOLS)
  })
})

describe("catalog", () => {
  it("lists devices and Goldie set templates", () => {
    const devices = listCatalog("devices") as Array<{ id: string }>
    expect(devices.some((device) => device.id === "iphone-18-pro-max")).toBe(
      true
    )
    expect(
      devices.some((device) => device.id === "iphone-duo-inner-open")
    ).toBe(true)
    expect(devices.some((device) => device.id === "iphone-17-pro")).toBe(true)
    const sets = listCatalog("templates", { query: "set-editorial" }) as Array<{
      id: string
      kind: string
    }>
    expect(sets[0]?.id).toBe("set-editorial")
    expect(sets[0]?.kind).toBe("set")
    const template = getCatalog("templates", "layout-classic") as {
      layoutKey: string
    }
    expect(template.layoutKey).toBe("classic")
  })
})

describe("mutations", () => {
  it("creates a project and applies a template set", async () => {
    const created = await previewMutation("projects.create", {
      schemaVersion: 1,
      name: "App Store set",
      aspect: "appStore69",
    })
    expect(created.document.project.name).toBe("App Store set")
    const applied = await previewMutation("templates.applySet", {
      schemaVersion: 1,
      document: created.document,
      templateId: "set-editorial",
      themeId: "arctic",
      display: "69",
      locale: "en",
    })
    expect(applied.document.project.canvases.length).toBeGreaterThan(1)
    expect(applied.summary.canvases[0]?.texts.length).toBeGreaterThan(0)
  })

  it("adds and updates text, then attaches a screenshot", async () => {
    const created = await previewMutation("projects.create", {
      schemaVersion: 1,
      locale: "en",
    })
    const withDevice = await previewMutation("layers.addDevice", {
      schemaVersion: 1,
      document: created.document,
      deviceId: "iphone-17-pro",
    })
    const withText = await previewMutation("layers.addText", {
      schemaVersion: 1,
      document: withDevice.document,
      string: "Headline",
      locale: "en",
    })
    const textId = withText.summary.canvases[0]?.texts[0]?.id
    expect(textId).toBeTruthy()
    const updated = await previewMutation("layers.update", {
      schemaVersion: 1,
      document: withText.document,
      layerId: textId,
      string: "Ship faster",
    })
    expect(updated.summary.canvases[0]?.texts[0]?.string).toBe("Ship faster")

    const attached = await previewMutation("assets.attach", {
      schemaVersion: 1,
      document: updated.document,
      url: TINY_PNG,
      target: "screenshot",
    })
    const device = attached.summary.canvases[0]?.devices[0]
    expect(device?.screenshotRef).toBeTruthy()
    expect(device?.missingScreenshot).toBe(false)
    expect(
      attached.document.assets[device!.screenshotRef!]?.startsWith("data:")
    ).toBe(true)
    const inspection = inspectDocument(attached.document)
    expect(inspection.assets[0]).not.toHaveProperty("dataUrl")
    expect(inspection.assets.some((asset) => asset.kind === "data")).toBe(true)
  })

  it("adds and removes a canvas", async () => {
    const created = await previewMutation("projects.create", {
      schemaVersion: 1,
    })
    const added = await previewMutation("canvases.add", {
      schemaVersion: 1,
      document: created.document,
      locale: "en",
    })
    expect(added.document.project.canvases).toHaveLength(2)
    const extraId = added.document.project.canvases[1].id
    const removed = await previewMutation("canvases.delete", {
      schemaVersion: 1,
      document: added.document,
      canvasId: extraId,
    })
    expect(removed.document.project.canvases).toHaveLength(1)
  })

  it("exports a pocket-draft-project package with data URL assets", async () => {
    const created = await previewMutation("projects.create", {
      schemaVersion: 1,
    })
    const withDevice = await previewMutation("layers.addDevice", {
      schemaVersion: 1,
      document: created.document,
      url: TINY_PNG,
    })
    const { exportProjectPackageFromDocument } = await import("./document")
    const pkg = await exportProjectPackageFromDocument(withDevice.document)
    expect(pkg.type).toBe("pocket-draft-project")
    expect(pkg.version).toBe(1)
    expect(Object.values(pkg.assets)[0]?.startsWith("data:image/")).toBe(true)
  })
})

describe("asset URL policy", () => {
  it("rejects private hosts and plain http remotes", () => {
    expect(() => assertAllowedAssetUrl("http://example.com/a.png")).toThrow(
      PocketDraftMcpError
    )
    expect(() =>
      assertAllowedAssetUrl("https://169.254.169.254/latest")
    ).toThrow(PocketDraftMcpError)
    expect(() => assertAllowedAssetUrl("https://192.168.1.8/a.png")).toThrow(
      PocketDraftMcpError
    )
    expect(() => assertAllowedAssetUrl("https://10.0.0.1/a.png")).toThrow(
      PocketDraftMcpError
    )
    expect(assertAllowedAssetUrl("https://example.com/shot.png").protocol).toBe(
      "https:"
    )
    expect(() =>
      assertAllowedAssetUrl("http://localhost:8787/shot.png")
    ).toThrow(PocketDraftMcpError)
  })
})
