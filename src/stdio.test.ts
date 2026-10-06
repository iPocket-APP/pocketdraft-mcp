import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, rm, readdir, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest"
import { createBlankProject } from "../lib/pocket-draft/models"
import { projectRevision } from "../lib/pocket-draft/browser-bridge"
import {
  LOCAL_MCP_TOOLS,
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_CAPABILITIES,
} from "../lib/pocket-draft/bridge-protocol"
import { inspectLayers } from "../lib/pocket-draft/inspection"
import { TestMcpClient, type ToolReply } from "./test-client"
const root = fileURLToPath(new URL("../", import.meta.url))
let client: TestMcpClient,
  workspace: string,
  base: string,
  headers: Record<string, string>
let project = createBlankProject()
const post = async (route: string, body: unknown = {}) => {
  const response = await fetch(`${base}/${route}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok)
    throw new Error(`Bridge ${route} failed: ${response.status}`)
  return response.json()
}
const snapshot = async () => {
  const command = await post("poll")
  expect(command.method).toBe("snapshot")
  await post("reply", {
    id: command.id,
    result: { revision: await projectRevision(project), project, assets: {} },
  })
}
const evaluate = async () => {
  const command = await post("poll")
  expect(command.method).toBe("evaluate")
  const candidate = command.params.document.project
  await post("reply", {
    id: command.id,
    result: {
      project: candidate,
      ...(command.params.operation === "inspect"
        ? { canvases: inspectLayers(candidate, command.params.options) }
        : {}),
    },
  })
  return command
}
const commit = async (
  command: Awaited<ReturnType<typeof post>>,
  assets = {}
) => {
  project = command.params.document.project
  await post("reply", {
    id: command.id,
    result: {
      projectId: project.id,
      project,
      assets,
      revision: await projectRevision(project),
      history: { undo: { entryId: "entry", label: "MCP edit" }, redo: null },
    },
  })
}
beforeAll(async () => {
  await promisify(execFile)(process.execPath, [
    path.join(root, "build.mjs"),
  ])
})
beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "pocketdraft-stdio-"))
  project = createBlankProject()
  project.name = "Initial"
  client = new TestMcpClient(
    path.join(root, "dist/index.mjs"),
    workspace
  )
  await client.initialize()
  const connection = (await client.tool("pocketdraft_connection"))
    .structuredContent
  const [port, token] = String(connection.pairingCode).split(":")
  base = `http://127.0.0.1:${port}`
  headers = {
    Origin: String(connection.editorOrigin),
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  }
  headers["X-PocketDraft-Session"] = (
    await post("connect", {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      capabilities: BRIDGE_CAPABILITIES,
    })
  ).sessionId
})
afterEach(async () => {
  await client?.close()
  if (workspace) await rm(workspace, { recursive: true, force: true })
})
describe("built stdio package", () => {
  it("advertises the actual tools, typed results, annotations and current schema resource", async () => {
    const list = await client.call<{
      tools: Array<{
        name: string
        outputSchema?: unknown
        annotations?: unknown
      }>
    }>("tools/list")
    expect(list.tools.map((tool) => tool.name).sort()).toEqual(
      [...LOCAL_MCP_TOOLS].sort()
    )
    for (const tool of list.tools) {
      expect(tool.outputSchema).toBeDefined()
      expect(tool.annotations).toBeDefined()
    }
    const resource = await client.call<{ contents: Array<{ text: string }> }>(
      "resources/read",
      { uri: "pocketdraft://schema/v1" }
    )
    expect(JSON.parse(resource.contents[0].text).bridge.protocolVersion).toBe(
      BRIDGE_PROTOCOL_VERSION
    )
    expect(
      (
        await client.tool("pocketdraft_list_catalog", {
          entity: "templates",
          platform: "macos",
          limit: 2,
        })
      ).structuredContent
    ).toMatchObject({ ok: true })
  })
  it("rejects empty revisions before issuing any browser work", async () => {
    expect(
      await client.tool("pocketdraft_batch_mutation", {
        projectId: project.id,
        revision: "",
        commands: [{ command: "projects.rename", input: { name: "bad" } }],
      })
    ).toMatchObject({ isError: true })
    expect(
      (await client.tool("pocketdraft_operation_status")).structuredContent
        .operations
    ).toEqual([])
  })
  it("does not issue an apply after the original request is cancelled", async () => {
    const request = client.request<ToolReply>("tools/call", {
      name: "pocketdraft_batch_mutation",
      arguments: {
        projectId: project.id,
        revision: await projectRevision(project),
        commands: [
          { command: "projects.rename", input: { name: "Cancelled edit" } },
        ],
      },
    })
    const handled = request.promise.catch((error) => error)
    const command = await post("poll")
    expect(command.method).toBe("snapshot")
    client.cancel(request.id)
    await handled
    await client.call("ping")
    expect(await post("heartbeat", { id: command.id })).toEqual({
      cancelled: true,
    })
    await post("reply", {
      id: command.id,
      result: { revision: await projectRevision(project), project, assets: {} },
    })
    const read = client.tool("pocketdraft_inspect_project")
    await snapshot()
    await evaluate()
    expect((await read).structuredContent.ok).toBe(true)
  })
  it("keeps local catalog reads independent of a waiting browser operation", async () => {
    const inspect = client.tool("pocketdraft_inspect_project")
    const waiting = await post("poll")
    expect(
      (
        await client.tool("pocketdraft_get_catalog", {
          entity: "devices",
          id: "iphone-17-pro",
        })
      ).structuredContent
    ).toMatchObject({ ok: true })
    await post("reply", {
      id: waiting.id,
      result: { revision: await projectRevision(project), project, assets: {} },
    })
    await evaluate()
    expect((await inspect).structuredContent.ok).toBe(true)
  })
  it("rejects stale revisions and preserves command error details", async () => {
    const stale = client.tool("pocketdraft_batch_mutation", {
      projectId: project.id,
      revision: "a".repeat(64),
      commands: [{ command: "projects.rename", input: { name: "bad" } }],
    })
    await snapshot()
    expect((await stale).structuredContent).toMatchObject({
      ok: false,
      code: "revision_conflict",
    })
    const invalid = client.tool("pocketdraft_batch_mutation", {
      projectId: project.id,
      revision: await projectRevision(project),
      commands: [{ command: "projects.rename", input: { name: "" } }],
    })
    expect((await invalid).structuredContent).toMatchObject({
      ok: false,
      code: "invalid_input",
      commandIndex: 0,
      details: expect.any(Array),
    })
  })
  it("edits large existing images using only metadata and returns a commit receipt", async () => {
    const background = project.canvases[0].layers[0]
    if (background.content.kind === "background")
      background.content.fill = {
        kind: "image",
        assetRef: "large",
        blurRadius: 0,
        dimming: 0,
      }
    const edit = client.tool("pocketdraft_batch_mutation", {
      projectId: project.id,
      revision: await projectRevision(project),
      commands: [
        { command: "projects.rename", input: { name: "Metadata only" } },
        { command: "layers.setBackground", input: { blurRadius: 1 } },
      ],
    })
    const command = await post("poll")
    await post("reply", {
      id: command.id,
      result: {
        revision: await projectRevision(project),
        project,
        assets: { large: { bytes: 40 * 1024 * 1024, mimeType: "image/png" } },
      },
    })
    await evaluate()
    const apply = await post("poll")
    expect(apply.method).toBe("apply")
    expect(apply.params.document.assets).toEqual({})
    expect(JSON.stringify(apply).length).toBeLessThan(10_000)
    apply.params.document.project.name = "Browser canonical name"
    await commit(apply, {
      large: { bytes: 40 * 1024 * 1024, mimeType: "image/png" },
    })
    const result = (await edit).structuredContent
    expect(result).toMatchObject({
      ok: true,
      applied: { operationId: apply.id },
      summary: { name: "Browser canonical name", missingAssetRefs: [] },
      warnings: [],
    })
  })
  it("attaches a local file with only its new image and exports a returned preview", async () => {
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    await writeFile(
      path.join(workspace, "image.png"),
      Buffer.from(png, "base64")
    )
    const attach = client.tool("pocketdraft_attach_file", {
      projectId: project.id,
      revision: await projectRevision(project),
      file: "image.png",
      target: "background",
    })
    await snapshot()
    await evaluate()
    const apply = await post("poll")
    expect(Object.values(apply.params.document.assets)).toEqual([
      `data:image/png;base64,${png}`,
    ])
    await commit(apply)
    expect((await attach).structuredContent.ok).toBe(true)
    const preview = client.tool("pocketdraft_preview", {
      projectId: project.id,
    })
    await snapshot()
    const render = await post("poll")
    await post("reply", {
      id: render.id,
      result: {
        files: [{ name: "preview", mimeType: "image/png", data: png }],
      },
    })
    expect(
      (await preview).content.some(
        (part) => part.type === "image" && part.data === png
      )
    ).toBe(true)
    const exportCall = client.tool("pocketdraft_export", {
      projectId: project.id,
    })
    await snapshot()
    const exported = await post("poll")
    await post("reply", {
      id: exported.id,
      result: { files: [{ name: "image", mimeType: "image/png", data: png }] },
    })
    const output = (await exportCall).structuredContent.files as string[]
    expect(await readFile(output[0])).toEqual(Buffer.from(png, "base64"))
  })
  it("returns composition warnings for the exported asset without blocking file creation", async () => {
    project = createBlankProject("appStoreUniversal")
    const warning = {
      code: "asset_safe_area",
      severity: "warning",
      canvasId: project.activeCanvasId,
      message: "Text outside safe area",
    }
    const exported = client.tool("pocketdraft_export", {
      projectId: project.id,
    })
    await snapshot()
    const validation = await post("poll")
    expect(validation.method).toBe("evaluate")
    await post("reply", {
      id: validation.id,
      result: {
        project,
        issues: [warning, { ...warning, canvasId: "unselected" }],
      },
    })
    const render = await post("poll")
    expect(render.method).toBe("render")
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    await post("reply", {
      id: render.id,
      result: { files: [{ name: "image", mimeType: "image/png", data: png }] },
    })
    const result = (await exported).structuredContent
    expect(result).toMatchObject({ ok: true, warnings: [warning] })
    expect(await readFile((result.files as string[])[0])).toEqual(
      Buffer.from(png, "base64")
    )
  })
  it("dryRun and same-value edits validate without applying or creating history", async () => {
    const before = JSON.stringify(project)
    const dry = client.tool("pocketdraft_batch_mutation", {
      projectId: project.id,
      revision: await projectRevision(project),
      dryRun: true,
      commands: [
        { command: "layers.addText", as: "title", input: { string: "Trial" } },
        {
          command: "layers.update",
          input: { layerId: { ref: "title" }, fontSize: 44 },
        },
      ],
    })
    await snapshot()
    await evaluate()
    expect((await dry).structuredContent).toMatchObject({
      ok: true,
      dryRun: true,
      changed: true,
      steps: [{ as: "title", changed: true }, { changed: true }],
    })
    expect(JSON.stringify(project)).toBe(before)
    const noop = client.tool("pocketdraft_batch_mutation", {
      projectId: project.id,
      revision: await projectRevision(project),
      commands: [{ command: "projects.rename", input: { name: project.name } }],
    })
    await snapshot()
    await evaluate()
    expect((await noop).structuredContent).toMatchObject({
      ok: true,
      changed: false,
      steps: [{ changed: false }],
    })
    const status = (await client.tool("pocketdraft_operation_status"))
      .structuredContent.operations as Array<{ method: string }>
    expect(status.some((op) => op.method === "apply")).toBe(false)
  })
  it("returns missing-asset errors without writing a broken package", async () => {
    const exported = client.tool("pocketdraft_export", {
      projectId: project.id,
      kind: "package",
    })
    await snapshot()
    const command = await post("poll")
    expect(command.method).toBe("package")
    await post("reply", {
      id: command.id,
      error: { code: "missing_asset", message: "missing_asset: lost-image" },
    })
    expect((await exported).structuredContent).toMatchObject({
      ok: false,
      code: "missing_asset",
    })
    expect(await readdir(workspace)).toEqual([])
  })
})
