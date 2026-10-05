import { z } from "zod"

// Shared by the installed package and the web editor. No Node/browser globals.
export const LOCAL_MCP_VERSION = "4.0.0"
export const BRIDGE_PROTOCOL_VERSION = 3
export const BRIDGE_CAPABILITIES = [
  "asset-manifest",
  "atomic-commit",
  "operation-cancellation",
  "precision-editing",
  "guarded-history",
] as const
export const BRIDGE_TIMEOUT_MS = 60_000
export const LOCAL_MCP_TOOLS = [
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
] as const
export const revisionSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Use the revision returned by inspect_project")
export const assetManifestSchema = z.record(
  z.string().min(1).max(256),
  z.object({
    bytes: z.number().int().nonnegative(),
    mimeType: z.string(),
  })
)
export type AssetManifest = z.infer<typeof assetManifestSchema>
export const snapshotSchema = z.object({
  revision: revisionSchema,
  project: z.unknown(),
  assets: assetManifestSchema,
  history: z.unknown().optional(),
})
export const bridgeDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  project: z.unknown(),
  assets: z.record(z.string().min(1).max(256), z.string()),
})
export const bridgeCommandSchema = z.object({
  id: z.string(),
  method: z.enum([
    "snapshot",
    "apply",
    "render",
    "package",
    "evaluate",
    "history",
  ]),
  params: z.record(z.string(), z.unknown()),
  deadline: z.number().finite(),
})
export const bridgeErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional(),
  commandIndex: z.number().int().optional(),
  operationId: z.string().optional(),
  candidates: z
    .array(z.object({ id: z.string(), name: z.string(), kind: z.string() }))
    .optional(),
  objectId: z.string().optional(),
  hint: z.string().optional(),
})
export type BridgeErrorData = z.infer<typeof bridgeErrorSchema>
export class BridgeError extends Error {
  constructor(readonly data: BridgeErrorData) {
    super(data.message)
    this.name = "BridgeError"
  }
}
export function errorData(error: unknown): BridgeErrorData {
  if (error instanceof BridgeError) return error.data
  if (error instanceof z.ZodError)
    return {
      code: "invalid_input",
      message: "Invalid input",
      details: error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    }
  const candidate = error as Partial<BridgeErrorData> | undefined
  const message = error instanceof Error ? error.message : "operation_failed"
  return {
    code:
      typeof candidate?.code === "string"
        ? candidate.code
        : error instanceof Error &&
            ["AbortError", "TimeoutError"].includes(error.name)
          ? "cancelled"
          : message.split(":")[0].replace(/\s+/g, "_").slice(0, 80),
    message,
    ...(candidate?.details ? { details: candidate.details } : {}),
    ...(candidate?.candidates ? { candidates: candidate.candidates } : {}),
    ...(candidate?.objectId ? { objectId: candidate.objectId } : {}),
    ...(candidate?.hint ? { hint: candidate.hint } : {}),
    ...(candidate?.commandIndex !== undefined
      ? { commandIndex: candidate.commandIndex }
      : {}),
  }
}
export function compatibleBridge(value: unknown) {
  const result = z
    .object({
      protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
      capabilities: z.array(z.string()),
    })
    .safeParse(value)
  return (
    result.success &&
    BRIDGE_CAPABILITIES.every((capability) =>
      result.data.capabilities.includes(capability)
    )
  )
}

export const previewOptionsSchema = z
  .object({
    canvasId: z.string().optional(),
    region: z
      .object({
        x: z.number().finite().nonnegative(),
        y: z.number().finite().nonnegative(),
        width: z.number().finite().positive(),
        height: z.number().finite().positive(),
      })
      .strict()
      .optional(),
    showBounds: z.boolean().default(false),
    scale: z.number().min(0.1).max(4).optional(),
  })
  .strict()
