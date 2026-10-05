import {
  McpServer,
  type ServerContext,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server"
import { z } from "zod"
import { listCatalog, getCatalog } from "../lib/pocket-draft/mcp/catalog"
import {
  PUBLIC_COMMAND_SCHEMAS,
  batchStepSchema,
  COMMAND_EXAMPLES,
  COMMAND_RULES,
} from "../lib/pocket-draft/mcp/commands"
import {
  CATALOG_ENTITIES,
  MUTATION_COMMANDS,
  MAX_REQUEST_BYTES,
} from "../lib/pocket-draft/mcp/protocol"
import { batchMutation } from "../lib/pocket-draft/mcp/mutations"
import { withCallContext } from "../lib/pocket-draft/mcp/call-context"
import {
  projectChanges,
  syncLayout,
} from "../lib/pocket-draft/mcp/precision"
import { inspectionOptionsSchema } from "../lib/pocket-draft/inspection"
import { inspectDocument } from "../lib/pocket-draft/mcp/document"
import {
  validateProject,
  idSchema,
} from "../lib/pocket-draft/mcp/validation"
import {
  validateImageBytes,
  sniffImageMime,
} from "../lib/pocket-draft/mcp/image-bytes"
import {
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_CAPABILITIES,
  LOCAL_MCP_VERSION,
  revisionSchema,
  previewOptionsSchema,
  snapshotSchema,
  bridgeErrorSchema,
  errorData,
  BridgeError,
} from "../lib/pocket-draft/bridge-protocol"
import { readWorkspaceImage, writeExports } from "./files"
import { EditorQueue } from "./queue"
import { POCKETDRAFT_SCHEMA_V1 } from "../lib/pocket-draft/mcp/schema"
import type { startBridge } from "./bridge"

type Bridge = Awaited<ReturnType<typeof startBridge>>
const failureSchema = bridgeErrorSchema.extend({ ok: z.literal(false) })
const output = (fields: z.ZodRawShape) =>
  z.union([z.object({ ok: z.literal(true), ...fields }), failureSchema])
const record = z.record(z.string(), z.unknown())
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}
const write = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
}
const fileMetadata = (file: { data: string; [key: string]: unknown }) =>
  Object.fromEntries(Object.entries(file).filter(([key]) => key !== "data"))
const result = (data: Record<string, unknown>, isError = false) => {
  const preview = data.preview as
    | { files?: Array<{ data: string; mimeType: string }> }
    | undefined
  const imageFiles = preview?.files ?? []
  const clean = preview
    ? {
        ...data,
        preview: { files: imageFiles.map(fileMetadata) },
      }
    : data
  return {
    ...(isError ? { isError: true } : {}),
    structuredContent: clean,
    content: [
      { type: "text" as const, text: JSON.stringify(clean) },
      ...imageFiles.map((file) => ({
        type: "image" as const,
        data: file.data,
        mimeType: file.mimeType,
      })),
    ],
  }
}
/** Keep the advertised schema strict while returning actionable validation errors as tool results. */
function recoverableInput<T extends z.ZodType>(
  schema: T
): StandardSchemaWithJSON<
  unknown,
  { value?: z.output<T>; error?: ReturnType<typeof errorData> }
> {
  return {
    "~standard": {
      version: 1,
      vendor: "pocketdraft",
      jsonSchema: schema["~standard"].jsonSchema,
      validate(raw) {
        const parsed = schema.safeParse(raw)
        if (parsed.success) return { value: { value: parsed.data } }
        const error = errorData(parsed.error)
        const path = parsed.error.issues[0]?.path
        const index =
          path?.[0] === "commands" && typeof path[1] === "number"
            ? path[1]
            : undefined
        const commands = (
          raw as { commands?: Array<{ input?: { layerId?: unknown } }> }
        )?.commands
        const objectId =
          index === undefined ? undefined : commands?.[index]?.input?.layerId
        return {
          value: {
            error: {
              ...error,
              commandIndex: index,
              ...(typeof objectId === "string" ? { objectId } : {}),
              hint: "Read the command schema and correct the indicated fields before retrying.",
            },
          },
        }
      },
    },
  }
}
const mutationOutput = output({
  applied: z
    .object({
      projectId: idSchema,
      revision: revisionSchema,
      operationId: z.string().optional(),
    })
    .optional(),
  summary: record,
  warnings: z.array(z.string()),
  steps: z.array(record),
  changed: z.boolean(),
  changes: z.array(record),
  created: record,
  dryRun: z.boolean(),
  revision: revisionSchema,
  history: z.unknown().optional(),
  preview: record.optional(),
})
const filesSchema = z.object({
  files: z
    .array(
      z.object({
        name: z.string(),
        mimeType: z.enum(["image/png", "image/jpeg", "application/json"]),
        canvasId: z.string().optional(),
        canvasName: z.string().optional(),
        slice: z.number().nullable().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        data: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/),
      })
    )
    .min(1)
    .max(20),
})

export function createLocalMcpServer(
  bridge: Bridge,
  workspace: string,
  editorOrigin = "https://tools.ipocket.xyz"
) {
  const server = new McpServer(
    { name: "pocketdraft", version: LOCAL_MCP_VERSION },
    {
      instructions:
        "Controls the explicitly paired PocketDraft tab. Call connection, then inspect. Writes require the exact current projectId/revision. Read command schema resources first. Keep the browser open. After cancellation/timeout inspect operation_status and the project; never blindly retry a write. Images remain in the browser unless explicitly imported/exported. Local files stay within --workspace. No Computer Use or extra browser installation is required.",
    }
  )
  const queue = new EditorQueue()
  async function run(
    name: string,
    ctx: ServerContext,
    fn: (signal: AbortSignal) => Promise<Record<string, unknown>>,
    editor = true
  ) {
    const started = Date.now()
    // Includes queue wait and all bridge phases, instead of resetting per phase.
    const signal = AbortSignal.any([
      ctx.mcpReq.signal,
      AbortSignal.timeout(55_000),
    ])
    let code = "ok"
    try {
      const execute = () => {
        signal.throwIfAborted()
        return fn(signal)
      }
      const data = editor ? await queue.run(execute, signal) : await execute()
      return result({ ok: true, ...data })
    } catch (error) {
      const detail = errorData(error)
      code = detail.code
      return result({ ok: false, ...detail }, true)
    } finally {
      if (process.env.POCKETDRAFT_MCP_DEBUG === "1")
        process.stderr.write(
          JSON.stringify({
            event: "pocketdraft_tool",
            tool: name,
            durationMs: Date.now() - started,
            code,
          }) + "\n"
        )
    }
  }
  async function snapshot(signal: AbortSignal) {
    const data = snapshotSchema.parse(
      await bridge.request("snapshot", {}, signal)
    )
    return { ...data, project: validateProject(data.project) }
  }
  async function checked(
    projectId: string,
    signal: AbortSignal,
    revision?: string
  ) {
    const current = await snapshot(signal)
    if (
      current.project.id !== projectId ||
      (revision !== undefined && current.revision !== revision)
    )
      throw new BridgeError({
        code: "revision_conflict",
        message: "Inspect the active browser project again.",
      })
    return current
  }
  async function evaluate(
    current: Awaited<ReturnType<typeof snapshot>>,
    document: unknown,
    params: Record<string, unknown>,
    signal: AbortSignal
  ) {
    return z
      .object({
        project: z.unknown(),
        canvases: z.array(record).optional(),
        issues: z.array(record).optional(),
        preview: filesSchema.optional(),
      })
      .parse(
        await bridge.request(
          "evaluate",
          { ...params, document, revision: current.revision },
          signal
        )
      )
  }
  async function apply(
    current: Awaited<ReturnType<typeof snapshot>>,
    commands: Parameters<typeof batchMutation>[0]["commands"],
    signal: AbortSignal,
    options: {
      dryRun?: boolean
      preview?: z.input<typeof previewOptionsSchema>
    } = {}
  ) {
    const creates = ["projects.create", "projects.import"].includes(
      commands[0]?.command
    )
    const next = await withCallContext(
      () =>
        batchMutation({
          document: creates
            ? undefined
            : { schemaVersion: 1, project: current.project, assets: {} },
          commands,
          assetMode: "inline",
        }),
      {
        signal,
        assetMode: "inline",
        availableAssets: new Set(Object.keys(current.assets)),
        evaluate: async (document, command, input) =>
          validateProject(
            (await evaluate(current, document, { command, input }, signal))
              .project
          ),
      }
    )
    signal.throwIfAborted()
    if (creates) {
      next.document.project.id = crypto.randomUUID()
      if (next.steps?.[0])
        next.steps[0].created.projectId = next.document.project.id
    }
    const delta = projectChanges(current.project, next.document.project)
    const common = {
      ...delta,
      steps: next.steps ?? [],
      warnings: next.warnings,
      dryRun: options.dryRun ?? false,
    }
    // Preparation and optional rendering use the identical candidate without any storage writes.
    const validation = await evaluate(
      current,
      next.document,
      { preview: options.preview },
      signal
    )
    if (options.dryRun || !delta.changed)
      return {
        ...common,
        revision: current.revision,
        summary: inspectDocument(next.document, current.assets),
        history: current.history,
        ...(validation.preview ? { preview: validation.preview } : {}),
      }
    const committed = snapshotSchema
      .extend({ projectId: idSchema, operationId: z.string() })
      .parse(
        await bridge.request(
          "apply",
          { document: next.document, revision: current.revision },
          signal
        )
      )
    const project = validateProject(committed.project)
    return {
      ...common,
      ...projectChanges(current.project, project),
      revision: committed.revision,
      applied: {
        projectId: project.id,
        revision: committed.revision,
        operationId: committed.operationId,
      },
      summary: inspectDocument(
        { schemaVersion: 1, project, assets: {} },
        committed.assets
      ),
      history: committed.history,
      ...(validation.preview ? { preview: validation.preview } : {}),
    }
  }
  server.registerTool(
    "pocketdraft_connection",
    {
      description:
        "Get connection state, recent operation IDs and pairing code. Paste the code only into the PocketDraft editor.",
      inputSchema: z.object({}),
      annotations: readOnly,
      outputSchema: output({
        connected: z.boolean(),
        pairingCode: z.string(),
        editorOrigin: z.string(),
        workspace: z.string(),
        protocolVersion: z.number(),
        version: z.string(),
        capabilities: z.array(z.string()),
        operations: z.array(z.unknown()),
      }),
    },
    (_, ctx) =>
      run(
        "connection",
        ctx,
        async () => ({
          connected: bridge.connected(),
          pairingCode: bridge.pairingCode,
          editorOrigin: editorOrigin,
          workspace,
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          version: LOCAL_MCP_VERSION,
          capabilities: [...BRIDGE_CAPABILITIES],
          operations: bridge.status(),
        }),
        false
      )
  )
  server.registerTool(
    "pocketdraft_operation_status",
    {
      description:
        "Read a recent browser operation receipt after a timeout/cancellation. No automatic retry. Receipts are bounded to 100 operations / ten minutes while the process runs.",
      inputSchema: z.object({ operationId: z.string().optional() }),
      annotations: readOnly,
      outputSchema: output({ operations: z.unknown() }),
    },
    ({ operationId }, ctx) =>
      run(
        "operation_status",
        ctx,
        async () => ({ operations: bridge.status(operationId) }),
        false
      )
  )
  server.registerTool(
    "pocketdraft_list_catalog",
    {
      description:
        "List templates, devices, frames, fonts, aspects, themes or gradients.",
      inputSchema: z.object({
        entity: z.enum(CATALOG_ENTITIES),
        query: z.string().optional(),
        platform: z.enum(["ios", "macos"]).optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(30),
      }),
      annotations: readOnly,
      outputSchema: output({ items: z.array(z.unknown()), total: z.number() }),
    },
    ({ entity, query, platform, offset, limit }, ctx) =>
      run(
        "list_catalog",
        ctx,
        async () => {
          const items = listCatalog(entity, { query, platform })
          return {
            items: items.slice(offset, offset + limit),
            total: items.length,
          }
        },
        false
      )
  )
  server.registerTool(
    "pocketdraft_get_catalog",
    {
      description: "Get one catalog item without waiting for browser work.",
      inputSchema: z.object({ entity: z.enum(CATALOG_ENTITIES), id: idSchema }),
      annotations: readOnly,
      outputSchema: output({ item: z.unknown() }),
    },
    ({ entity, id }, ctx) =>
      run(
        "get_catalog",
        ctx,
        async () => ({ item: getCatalog(entity, id) }),
        false
      )
  )
  server.registerTool(
    "pocketdraft_inspect_project",
    {
      description:
        "Read current revision, history entries and ordered layers with full styles and browser-measured pixel bounds. Filter by canvasIds/layerIds/kind/name/text; names/text only find candidates. No image bytes. Full project optional.",
      inputSchema: inspectionOptionsSchema.extend({
        includeProject: z.boolean().default(false),
      }),
      annotations: readOnly,
      outputSchema: output({
        revision: revisionSchema,
        projectId: idSchema,
        name: z.string(),
        schemaVersion: z.number(),
        activeCanvasId: idSchema,
        canvases: z.array(record),
        assets: z.array(record),
        missingAssetRefs: z.array(z.string()),
        project: record.optional(),
        history: z.unknown().optional(),
      }),
    },
    ({ includeProject, ...options }, ctx) =>
      run("inspect_project", ctx, async (signal) => {
        const current = await snapshot(signal)
        const document = {
          schemaVersion: 1 as const,
          project: current.project,
          assets: {},
        }
        const measured = await evaluate(
          current,
          document,
          { operation: "inspect", options },
          signal
        )
        const summary = inspectDocument(document, current.assets)
        return {
          ...summary,
          revision: current.revision,
          history: current.history,
          canvases: measured.canvases!.map((canvas) => ({
            ...summary.canvases.find((c) => c.id === canvas.id),
            ...canvas,
          })),
          ...(includeProject ? { project: current.project } : {}),
        }
      })
  )
  server.registerTool(
    "pocketdraft_batch_mutation",
    {
      description:
        "Apply 1–50 commands as one durable browser edit and one Undo step. Create/import must be first. Only new images cross the bridge. Pixel geometry runs in the browser. dryRun validates without saving; optional preview renders the candidate. Alias creations with as and reference them using {ref: alias}. Read command resources first.",
      inputSchema: recoverableInput(
        z
          .object({
            projectId: idSchema,
            revision: revisionSchema,
            commands: z.array(batchStepSchema).min(1).max(50),
            dryRun: z.boolean().default(false),
            preview: previewOptionsSchema.optional(),
          })
          .strict()
      ),
      annotations: write,
      outputSchema: mutationOutput,
    },
    (input, ctx) =>
      run("batch_mutation", ctx, async (signal) => {
        if (input.error) throw new BridgeError(input.error)
        const { projectId, revision, commands, ...options } = input.value!
        if (Buffer.byteLength(JSON.stringify(commands)) > MAX_REQUEST_BYTES)
          throw new Error("payload_too_large")
        return apply(
          await checked(projectId, signal, revision),
          commands,
          signal,
          options
        )
      })
  )
  server.registerTool(
    "pocketdraft_attach_file",
    {
      description:
        "Attach a local screenshot/image/background within --workspace. Changes are committed to the paired editor.",
      inputSchema: z.object({
        projectId: idSchema,
        revision: revisionSchema,
        file: z.string().min(1),
        target: z.enum(["screenshot", "image", "background"]),
        canvasId: idSchema.optional(),
        layerId: idSchema.optional(),
        cropPolicy: z.enum(["reset", "preserve"]).optional(),
      }),
      annotations: write,
      outputSchema: mutationOutput,
    },
    ({ projectId, revision, file, ...target }, ctx) =>
      run("attach_file", ctx, async (signal) => {
        const current = await checked(projectId, signal, revision)
        const bytes = await readWorkspaceImage(workspace, file, signal)
        validateImageBytes(bytes)
        return apply(
          current,
          [
            {
              command: "assets.attach",
              input: {
                ...target,
                url: `data:${sniffImageMime(bytes)};base64,${bytes.toString("base64")}`,
              },
            },
          ],
          signal
        )
      })
  )
  server.registerTool(
    "pocketdraft_preview",
    {
      description:
        "Render the paired canvas, optionally a region in logical pixels at a chosen scale and geometric bounds overlay. Returns an MCP image and dimensions.",
      inputSchema: z
        .object({
          ...previewOptionsSchema.shape,
          projectId: idSchema,
          revision: revisionSchema.optional(),
        })
        .strict(),
      annotations: readOnly,
      outputSchema: output({
        projectId: idSchema,
        revision: revisionSchema,
        files: z.array(record),
      }),
    },
    async ({ projectId, revision, ...options }, ctx) => {
      let image:
        | { mimeType: "image/png" | "image/jpeg"; data: string }
        | undefined
      const outcome = await run("preview", ctx, async (signal) => {
        const current = await checked(projectId, signal, revision)
        const rendered = filesSchema.parse(
          await bridge.request(
            "render",
            { ...options, revision: current.revision, preview: true },
            signal
          )
        )
        const first = rendered.files[0]
        if (first.mimeType === "application/json")
          throw new Error("invalid_preview")
        image = { mimeType: first.mimeType, data: first.data }
        return {
          projectId,
          revision: current.revision,
          files: rendered.files.map(fileMetadata),
        }
      })
      return image && !outcome.isError
        ? {
            ...outcome,
            content: [...outcome.content, { type: "image" as const, ...image }],
          }
        : outcome
    }
  )
  server.registerTool(
    "pocketdraft_export",
    {
      description:
        "Export PNG/JPEG or an editable project package into a new workspace/exports directory. Missing images fail. Use allCanvases for a set; package limits remain 8 MiB/image, 32 MiB total.",
      inputSchema: z.object({
        projectId: idSchema,
        canvasId: idSchema.optional(),
        canvasIds: z.array(idSchema).min(1).max(10).optional(),
        revision: revisionSchema.optional(),
        allCanvases: z.boolean().default(false),
        kind: z.enum(["image", "package"]).default("image"),
        format: z.enum(["png", "jpeg"]).default("png"),
        scale: z.number().min(0.1).max(4).default(1),
        quality: z.number().min(0).max(1).optional(),
        transparentBackground: z.boolean().default(false),
        slices: z.boolean().default(false),
      }),
      annotations: { ...write, destructiveHint: false, openWorldHint: false },
      outputSchema: output({
        projectId: idSchema,
        revision: revisionSchema,
        files: z.array(z.string()),
        manifest: z.array(record),
      }),
    },
    (
      {
        projectId,
        kind,
        allCanvases,
        canvasIds: selectedIds,
        revision,
        ...params
      },
      ctx
    ) =>
      run("export", ctx, async (signal) => {
        const current = await checked(projectId, signal, revision)
        if (
          [allCanvases, !!params.canvasId, !!selectedIds].filter(Boolean)
            .length > 1 ||
          (selectedIds && new Set(selectedIds).size !== selectedIds.length)
        )
          throw new Error(
            "invalid_input: choose distinct canvasIds, canvasId, or allCanvases"
          )
        if (
          kind === "package" &&
          (allCanvases || params.canvasId || selectedIds || params.slices)
        )
          throw new Error("invalid_input: packages contain the entire project")
        if (
          selectedIds?.some(
            (id) => !current.project.canvases.some((c) => c.id === id)
          )
        )
          throw new Error("canvas_not_found")
        const manifest: Record<string, unknown>[] = []
        const outputs: Array<{ data: string; extension: string }> = []
        const canvasIds =
          selectedIds ??
          (allCanvases && kind === "image"
            ? current.project.canvases.map((canvas) => canvas.id)
            : [params.canvasId])
        for (const canvasId of canvasIds) {
          const rendered = filesSchema.parse(
            await bridge.request(
              kind === "package" ? "package" : "render",
              { ...params, canvasId, revision: current.revision },
              signal
            )
          )
          manifest.push(...rendered.files.map(fileMetadata))
          outputs.push(
            ...rendered.files.map((file) => ({
              data: file.data,
              extension:
                kind === "package"
                  ? "pocketdraft"
                  : params.format === "png"
                    ? "png"
                    : "jpg",
            }))
          )
          if (
            outputs.reduce((size, file) => size + file.data.length, 0) >
            MAX_REQUEST_BYTES
          )
            throw new Error("export_too_large: export fewer canvases")
        }
        const files = await writeExports(workspace, outputs, signal)
        return {
          projectId,
          revision: current.revision,
          files,
          manifest: manifest.map((entry, index) => ({
            ...entry,
            path: files[index],
          })),
        }
      })
  )
  server.registerTool(
    "pocketdraft_validate_project",
    {
      description:
        "Check missing assets, bounds, crop and text layout with browser fonts. Overlaps are allowed. Optionally preflight an explicit layout.sync without changing the project.",
      inputSchema: z
        .object({
          projectId: idSchema,
          revision: revisionSchema.optional(),
          layoutSync: PUBLIC_COMMAND_SCHEMAS["layout.sync"].optional(),
        })
        .strict(),
      annotations: readOnly,
      outputSchema: output({
        projectId: idSchema,
        revision: revisionSchema,
        valid: z.boolean(),
        issues: z.array(record),
        layoutSync: record.optional(),
      }),
    },
    ({ projectId, revision, layoutSync }, ctx) =>
      run("validate_project", ctx, async (signal) => {
        const current = await checked(projectId, signal, revision)
        const checkedLayout = layoutSync
          ? projectChanges(
              current.project,
              syncLayout(current.project, layoutSync)
            )
          : undefined
        const checkedProject = await evaluate(
          current,
          { schemaVersion: 1, project: current.project, assets: {} },
          { operation: "validate" },
          signal
        )
        const issues = checkedProject.issues ?? []
        return {
          projectId,
          revision: current.revision,
          valid: !issues.some((issue) => issue.severity === "error"),
          issues,
          ...(checkedLayout ? { layoutSync: checkedLayout } : {}),
        }
      })
  )
  server.registerTool(
    "pocketdraft_history",
    {
      description:
        "Undo/redo exactly the history entry returned by inspect. Requires its entryId and current revision; saves atomically before moving history.",
      inputSchema: z
        .object({
          projectId: idSchema,
          revision: revisionSchema,
          action: z.enum(["undo", "redo"]),
          entryId: z.string().min(1),
        })
        .strict(),
      annotations: write,
      outputSchema: output({
        projectId: idSchema,
        revision: revisionSchema,
        operationId: z.string(),
        history: z.unknown(),
        summary: record,
      }),
    },
    ({ projectId, revision, action, entryId }, ctx) =>
      run("history", ctx, async (signal) => {
        await checked(projectId, signal, revision)
        const committed = snapshotSchema
          .extend({ projectId: idSchema, operationId: z.string() })
          .parse(
            await bridge.request(
              "history",
              { revision, action, entryId },
              signal
            )
          )
        const project = validateProject(committed.project)
        return {
          projectId: project.id,
          revision: committed.revision,
          operationId: committed.operationId,
          history: committed.history,
          summary: inspectDocument(
            { schemaVersion: 1, project, assets: {} },
            committed.assets
          ),
        }
      })
  )
  server.registerResource(
    "schema",
    "pocketdraft://schema/v1",
    { mimeType: "application/json" },
    async () => ({
      contents: [
        {
          uri: "pocketdraft://schema/v1",
          mimeType: "application/json",
          text: JSON.stringify(POCKETDRAFT_SCHEMA_V1),
        },
      ],
    })
  )
  for (const command of MUTATION_COMMANDS) {
    const uri = `pocketdraft://schema/v1/commands/${command}`
    server.registerResource(
      command,
      uri,
      { mimeType: "application/json" },
      async () => ({
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify({
              command,
              rules: COMMAND_RULES,
              inputSchema: z.toJSONSchema(PUBLIC_COMMAND_SCHEMAS[command]),
              example: COMMAND_EXAMPLES[command],
            }),
          },
        ],
      })
    )
  }
  return server
}
