import { AsyncLocalStorage } from "node:async_hooks"
import { PocketDraftMcpError } from "./errors"
import { MAX_PACKAGE_ASSET_BYTES } from "./protocol"

type CallContext = {
  signal: AbortSignal
  bytes: number
  dataSizes: Map<string, number>
  assetMode: "inline" | "reference"
  cache: Map<string, Promise<import("./fetch-asset").ResolvedAsset>>
  publicFetch: boolean
  availableAssets: ReadonlySet<string>
  evaluate?: (
    document: import("./document").PocketDraftDocument,
    command: string,
    input: Record<string, unknown>
  ) => Promise<import("../models").Project>
  validatedProjects: WeakMap<object, import("../models").Project>
  validatedCanvases: WeakSet<object>
}
const storage = new AsyncLocalStorage<CallContext>()
export function callContext() {
  return storage.getStore()
}
export function accountBytes(count: number) {
  const ctx = callContext()
  if (!ctx) return
  ctx.bytes += count
  if (ctx.bytes > MAX_PACKAGE_ASSET_BYTES)
    throw new PocketDraftMcpError(
      "asset_error",
      "Call asset budget exceeded (32 MiB)."
    )
  ctx.signal.throwIfAborted()
}
export function withCallContext<T>(
  fn: () => Promise<T>,
  options?: {
    signal?: AbortSignal
    assetMode?: "inline" | "reference"
    publicFetch?: boolean
    availableAssets?: ReadonlySet<string>
    evaluate?: CallContext["evaluate"]
  }
): Promise<T> {
  if (callContext()) return fn()
  const controller = new AbortController()
  const timer = setTimeout(
    () =>
      controller.abort(
        new PocketDraftMcpError("timeout", "Call exceeded 60 seconds.")
      ),
    60000
  )
  const signal = options?.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal
  return storage
    .run(
      {
        signal,
        bytes: 0,
        dataSizes: new Map(),
        assetMode: options?.assetMode ?? "inline",
        cache: new Map(),
        publicFetch: options?.publicFetch ?? false,
        availableAssets: options?.availableAssets ?? new Set(),
        evaluate: options?.evaluate,
        validatedProjects: new WeakMap(),
        validatedCanvases: new WeakSet(),
      },
      fn
    )
    .finally(() => clearTimeout(timer))
}
