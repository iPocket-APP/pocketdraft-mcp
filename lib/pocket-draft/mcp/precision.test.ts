import { describe, expect, it } from "vitest"
import {
  createBlankProject,
  createBlankCanvas,
  createTextLayer,
  createDeviceLayer,
  syncActiveCanvasToProject,
} from "../models"
import { previewMutation, batchMutation } from "./mutations"
import { withCallContext } from "./call-context"
import { applyGeometryOperation } from "../precision-geometry"
import { inspectDocument } from "./document"
import { inspectLayers } from "../inspection"
import { COMMAND_EXAMPLES, PUBLIC_COMMAND_SCHEMAS } from "./commands"
import { MUTATION_COMMANDS } from "./protocol"
const documentWith = (...layers: ReturnType<typeof createTextLayer>[]) => {
  const project = createBlankProject()
  project.canvases[0].layers.push(...layers)
  return {
    schemaVersion: 1 as const,
    project: syncActiveCanvasToProject(project),
    assets: {},
  }
}
const batch = (
  document: ReturnType<typeof documentWith>,
  commands: Parameters<typeof batchMutation>[0]["commands"]
) =>
  withCallContext(() => batchMutation({ document, commands }), {
    evaluate: async (doc, cmd, input) =>
      applyGeometryOperation(doc.project, cmd, input),
  })
describe("v4 strict editing", () => {
  it.each([
    ["fontSize on a device", { fontSize: 20 }, "unsupported_property"],
    ["unknown frame", { frameId: "absent" }, "not_found"],
    ["zoom overflow", { screenshotZoom: 99 }, "invalid_input"],
    ["scale underflow", { transform: { scale: 0.001 } }, "invalid_input"],
  ])("rejects %s without modifying the source", async (_, patch, code) => {
    const layer = createDeviceLayer({
        name: "Device",
        deviceId: "iphone-17-pro",
        frameId: "silver",
      }),
      doc = documentWith(layer),
      before = JSON.stringify(doc)
    await expect(
      batch(doc, [
        { command: "layers.update", input: { layerId: layer.id, ...patch } },
      ])
    ).rejects.toMatchObject({ code, commandIndex: 0, objectId: layer.id })
    expect(JSON.stringify(doc)).toBe(before)
  })
  it("rejects mixed top-level and nested content and indexed failures leave the source intact", async () => {
    const layer = createTextLayer({
        name: "Text",
        string: "Text",
        fontSize: 32,
      }),
      doc = documentWith(layer),
      before = JSON.stringify(doc)
    await expect(
      batch(doc, [
        { command: "projects.rename", input: { name: "Not committed" } },
        {
          command: "layers.update",
          input: {
            layerId: layer.id,
            string: "Ignored?",
            content: { fontSize: 40 },
          },
        },
      ])
    ).rejects.toMatchObject({
      code: "conflicting_fields",
      commandIndex: 1,
      objectId: layer.id,
      details: [{ path: "content", message: expect.any(String) }],
    })
    expect(JSON.stringify(doc)).toBe(before)
  })
  it("requires an earlier unlock, allows visibility alone, and reports no-ops", async () => {
    const layer = createTextLayer({
      name: "Text",
      string: "Text",
      fontSize: 32,
    })
    layer.isLocked = true
    const doc = documentWith(layer)
    for (const input of [
      { transform: { center: { x: 0.1 } } },
      { string: "new" },
      { isLocked: false, string: "new" },
    ]) {
      await expect(
        batch(doc, [
          { command: "layers.update", input: { layerId: layer.id, ...input } },
        ])
      ).rejects.toMatchObject({ code: "layer_locked" })
    }
    const result = await batch(doc, [
      {
        command: "layers.update",
        input: { layerId: layer.id, isVisible: false },
      },
      {
        command: "layers.update",
        input: { layerId: layer.id, isLocked: false },
      },
      { command: "layers.update", input: { layerId: layer.id, string: "new" } },
      { command: "layers.update", input: { layerId: layer.id, string: "new" } },
    ])
    expect(result.steps?.map((s) => s.changed)).toEqual([
      true,
      true,
      true,
      false,
    ])
    for (const command of ["layers.delete", "layers.reorder"] as const)
      await expect(
        batch(doc, [
          {
            command,
            input: {
              layerId: layer.id,
              ...(command === "layers.reorder" ? { action: "front" } : {}),
            },
          },
        ])
      ).rejects.toMatchObject({ code: "layer_locked" })
  })
  it("creates with all text effects, resolves sequential aliases, duplicates and removes effects", async () => {
    const result = await batch(documentWith(), [
      {
        command: "layers.addText",
        as: "title",
        input: {
          string: "中英 Pocket",
          fontSize: 36,
          lineSpacing: 4,
          kerning: 2,
          boxWidth: 300,
          stroke: { color: "#fff", width: 2 },
          shadow: { color: "#000", radius: 3, offsetX: 1, offsetY: 2 },
          pill: { color: "#aaa", paddingX: 10, paddingY: 8, cornerRadius: 6 },
        },
      },
      {
        command: "layers.move",
        input: { layerId: { ref: "title" }, dx: 0, dy: -12 },
      },
      {
        command: "layers.duplicate",
        as: "copy",
        input: { layerId: { ref: "title" } },
      },
      {
        command: "layers.update",
        input: {
          layerId: { ref: "copy" },
          stroke: null,
          shadow: null,
          pill: null,
          boxWidth: null,
        },
      },
    ])
    const title = result.document.project.layers[1],
      copy = result.document.project.layers[2]
    expect(result.steps?.[2].copyMap).toEqual({ [title.id]: copy.id })
    expect(title.content).toMatchObject({
      kerning: 2,
      lineSpacing: 4,
      stroke: { width: 2 },
      pill: { paddingX: 10 },
    })
    expect(copy.content).toMatchObject({
      stroke: null,
      shadow: null,
      pill: null,
      boxWidth: null,
    })
    const imported = await previewMutation("projects.import", {
      package: {
        type: "pocket-draft-project",
        version: 1,
        project: result.document.project,
        assets: {},
      },
    })
    expect(imported.document.project.layers[1].content).toEqual(title.content)
  })
  it("supports canvas aliases, cross-canvas copying and exact canvas order", async () => {
    const layer = createTextLayer({
        name: "Text",
        string: "Text",
        fontSize: 32,
      }),
      doc = documentWith(layer),
      source = doc.project.activeCanvasId
    const result = await batch(doc, [
      {
        command: "canvases.duplicate",
        as: "target",
        input: { canvasId: source },
      },
      {
        command: "layers.duplicate",
        as: "copy",
        input: {
          canvasId: source,
          layerId: layer.id,
          targetCanvasId: { ref: "target" },
        },
      },
      {
        command: "layers.update",
        input: { layerId: { ref: "copy" }, string: "Only the copy" },
      },
      {
        command: "canvases.reorder",
        input: { canvasIds: [{ ref: "target" }, source] },
      },
    ])
    expect(result.document.project.canvases[1].layers[1].content).toEqual(
      layer.content
    )
    expect(result.document.project.canvases[0].layers[2].content).toMatchObject(
      { string: "Only the copy" }
    )
    expect(result.steps?.[0].copyMap?.[source]).toBe(
      result.document.project.canvases[0].id
    )
  })
  it("rejects duplicate, unknown, wrong-kind and cross-canvas aliases", async () => {
    const doc = documentWith()
    await expect(
      batch(doc, [
        {
          command: "layers.update",
          input: { layerId: { ref: "missing" }, string: "x" },
        },
      ])
    ).rejects.toMatchObject({ code: "invalid_reference" })
    await expect(
      batch(doc, [
        { command: "canvases.add", as: "c", input: {} },
        {
          command: "layers.update",
          input: { layerId: { ref: "c" }, string: "x" },
        },
      ])
    ).rejects.toMatchObject({ code: "invalid_reference", commandIndex: 1 })
    await expect(
      batch(doc, [
        { command: "layers.addText", as: "t", input: {} },
        { command: "layers.addText", as: "t", input: {} },
      ])
    ).rejects.toMatchObject({ code: "invalid_reference", commandIndex: 1 })
  })
  it("fails explicit incompatible sync targets and supports partial mapped fields", async () => {
    const layer = createTextLayer({
        name: "Source",
        string: "Source",
        fontSize: 50,
      }),
      doc = documentWith(layer)
    const target = createBlankCanvas(),
      destination = createTextLayer({
        name: "Destination",
        string: "Keep copy",
        fontSize: 20,
      })
    target.layers.push(
      destination,
      createTextLayer({ name: "Text", string: "Text", fontSize: 32 })
    )
    doc.project.canvases.push(target)
    await expect(
      batch(doc, [
        { command: "layout.sync", input: { targetCanvasIds: [target.id] } },
      ])
    ).rejects.toMatchObject({ code: "layout_mismatch", objectId: target.id })
    const result = await batch(doc, [
      {
        command: "layout.sync",
        input: {
          targetCanvasIds: [target.id],
          mapping: [
            {
              targetCanvasId: target.id,
              sourceLayerId: layer.id,
              targetLayerId: destination.id,
            },
          ],
          fields: ["style"],
          scope: {
            canvasSize: false,
            background: false,
            devices: false,
            images: false,
            texts: true,
          },
        },
      },
    ])
    expect(result.document.project.canvases[1].layers[1].content).toMatchObject(
      { string: "Keep copy", fontSize: 50 }
    )
    expect(result.document.project.canvases[1].layers[2]).toEqual(
      target.layers[2]
    )
  })
  it("deduplicates browser assets and filters ordered layer candidates", () => {
    const a = createTextLayer({
        string: "Title 中文",
        fontSize: 32,
        name: "Title",
      }),
      b = createTextLayer({ name: "Title", string: "Text", fontSize: 32 }),
      doc = documentWith(a, b)
    const device = createDeviceLayer({
      name: "Device",
      deviceId: "iphone-17-pro",
      frameId: "silver",
    })
    if (device.content.kind === "device") device.content.screenshotRef = "same"
    doc.project.canvases[0].layers.push(device, {
      ...device,
      id: crypto.randomUUID(),
    })
    const summary = inspectDocument(doc, {
      same: { bytes: 12, mimeType: "image/png" },
    })
    expect(summary.assets).toHaveLength(1)
    expect(
      inspectLayers(doc.project, { name: "Title" })[0].layers.map((l) => l.id)
    ).toEqual([a.id, b.id])
    expect(
      inspectLayers(doc.project, { text: "中文" })[0].layers.map((l) => l.id)
    ).toEqual([a.id])
  })
  it("returns structured candidates for ambiguous screenshots and rejects unknown nested coordinates", async () => {
    const a = createDeviceLayer({
        name: "A",
        deviceId: "iphone-17-pro",
        frameId: "silver",
      }),
      b = { ...a, id: crypto.randomUUID(), name: "B" }
    const doc = documentWith(a, b)
    await expect(
      batch(doc, [
        {
          command: "assets.attach",
          input: {
            target: "screenshot",
            url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          },
        },
      ])
    ).rejects.toMatchObject({
      code: "ambiguous_target",
      candidates: [
        { id: a.id, name: "A", kind: "device" },
        { id: b.id, name: "B", kind: "device" },
      ],
    })
    await expect(
      batch(doc, [
        {
          command: "layers.update",
          input: { layerId: a.id, transform: { center: { dx: 10 } } },
        },
      ])
    ).rejects.toMatchObject({ code: "invalid_input" })
  })
  it("generates valid examples from every public command schema", () => {
    for (const command of MUTATION_COMMANDS)
      expect(
        PUBLIC_COMMAND_SCHEMAS[command].safeParse(COMMAND_EXAMPLES[command])
          .success,
        command
      ).toBe(true)
  })
})

it("syncing identical device layout reports no change", async () => {
  const layer = createDeviceLayer({
      name: "Device",
      deviceId: "iphone-17-pro",
      frameId: "silver",
    }),
    doc = documentWith(layer)
  const copied = await batch(doc, [
    {
      command: "canvases.duplicate",
      input: { canvasId: doc.project.activeCanvasId },
    },
  ])
  const next = await batch(copied.document, [
    {
      command: "layout.sync",
      input: {
        sourceCanvasId: doc.project.activeCanvasId,
        targetCanvasIds: [copied.document.project.activeCanvasId],
      },
    },
  ])
  expect(next.steps?.[0].changed).toBe(false)
})
