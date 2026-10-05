import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { randomBytes, timingSafeEqual } from "node:crypto"
import {
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_CAPABILITIES,
  BRIDGE_TIMEOUT_MS,
  LOCAL_MCP_VERSION,
  BridgeError,
  bridgeErrorSchema,
  compatibleBridge,
  type BridgeErrorData,
} from "../lib/pocket-draft/bridge-protocol"
import { MAX_REQUEST_BYTES } from "../lib/pocket-draft/mcp/protocol"

type Operation = {
  id: string
  method: string
  state:
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "timed_out"
    | "unknown"
  startedAt: number
  finishedAt?: number
  delivered: boolean
  cancelRequested: boolean
  error?: BridgeErrorData
  result?: unknown
}
type Pending = {
  operation: Operation
  params: unknown
  deadline: number
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  cleanup: () => void
  settled: boolean
}

export async function startBridge(
  origins: string[],
  port = 0,
  timeoutMs = BRIDGE_TIMEOUT_MS
) {
  const token = randomBytes(32).toString("hex")
  let session: { id: string; origin: string; seen: number } | undefined
  let poll: ServerResponse | undefined
  let pending: Pending | undefined
  let boundPort = 0
  const operations = new Map<string, Operation>()
  const send = (res: ServerResponse, status: number, data: unknown) => {
    if (res.destroyed || res.writableEnded) return false
    const body = JSON.stringify(data)
    if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) {
      res.writeHead(413, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      res.end(JSON.stringify({ error: "payload_too_large" }))
      return false
    }
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    })
    res.end(body)
    return true
  }
  const finish = (
    active: Pending,
    error?: BridgeErrorData,
    result?: unknown
  ) => {
    active.cleanup()
    if (!active.settled) {
      active.settled = true
      if (error)
        active.reject(
          new BridgeError({ ...error, operationId: active.operation.id })
        )
      else active.resolve(result)
    }
  }
  const release = () => {
    session = undefined
    if (poll) send(poll, 409, { error: "disconnected" })
    poll = undefined
    if (pending) {
      pending.operation.state = pending.operation.delivered
        ? "unknown"
        : "cancelled"
      pending.operation.finishedAt = Date.now()
      finish(pending, {
        code: "browser_disconnected",
        message:
          "Browser disconnected; inspect the project and operation status before retrying.",
      })
      pending = undefined
    }
  }
  const deliver = () => {
    if (!poll || !pending || pending.operation.delivered) return
    pending.operation.delivered = send(poll, 200, {
      id: pending.operation.id,
      method: pending.operation.method,
      params: pending.params,
      deadline: pending.deadline,
    })
    poll = undefined
  }
  const read = async (req: IncomingMessage) => {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_REQUEST_BYTES) throw new Error("payload_too_large")
      chunks.push(chunk)
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString() || "{}")
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("invalid_request")
    return value as Record<string, unknown>
  }
  const pruneOperations = () => {
    for (const [id, operation] of operations)
      if (
        pending?.operation.id !== id &&
        Date.now() - operation.startedAt > 600_000
      )
        operations.delete(id)
  }
  const server = createServer(async (req, res) => {
    try {
      const origin = req.headers.origin
      if (
        req.headers.host !== `127.0.0.1:${boundPort}` ||
        !origin ||
        !origins.includes(origin)
      ) {
        send(res, 403, { error: "origin_denied" })
        return
      }
      res.setHeader("Access-Control-Allow-Origin", origin)
      res.setHeader("Vary", "Origin")
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Authorization, Content-Type, X-PocketDraft-Session"
        )
        res.setHeader("Access-Control-Allow-Private-Network", "true")
        send(res, 204, null)
        return
      }
      const supplied = Buffer.from(req.headers.authorization ?? ""),
        expected = Buffer.from(`Bearer ${token}`)
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      ) {
        send(res, 401, { error: "invalid_pairing_code" })
        return
      }
      if (req.method !== "POST") {
        send(res, 405, { error: "method_not_allowed" })
        return
      }
      if (session && Date.now() - session.seen > 90_000) release()
      if (req.url === "/connect") {
        if (session) {
          send(res, 409, { error: "another_editor_connected" })
          return
        }
        if (!compatibleBridge(await read(req))) {
          send(res, 426, {
            error:
              "protocol_mismatch: update both the local MCP package and the editor",
            protocolVersion: BRIDGE_PROTOCOL_VERSION,
          })
          return
        }
        session = {
          id: randomBytes(24).toString("hex"),
          origin,
          seen: Date.now(),
        }
        send(res, 200, {
          sessionId: session.id,
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          capabilities: BRIDGE_CAPABILITIES,
          version: LOCAL_MCP_VERSION,
        })
        return
      }
      if (
        !session ||
        req.headers["x-pocketdraft-session"] !== session.id ||
        origin !== session.origin
      ) {
        send(res, 409, { error: "disconnected" })
        return
      }
      session.seen = Date.now()
      if (req.url === "/disconnect") {
        release()
        send(res, 200, { ok: true })
        return
      }
      if (req.url === "/heartbeat") {
        const data = await read(req)
        send(res, 200, {
          cancelled:
            !pending ||
            pending.operation.id !== data.id ||
            pending.operation.cancelRequested ||
            Date.now() >= pending.deadline,
        })
        return
      }
      if (req.url === "/poll") {
        if (poll) {
          send(res, 409, { error: "duplicate_poll" })
          return
        }
        poll = res
        const timeout = setTimeout(() => {
          if (poll === res) {
            send(res, 200, null)
            poll = undefined
          }
        }, 20_000)
        res.on("close", () => {
          clearTimeout(timeout)
          if (poll === res) poll = undefined
        })
        deliver()
        return
      }
      if (req.url === "/reply") {
        const data = await read(req)
        if (
          !pending ||
          data.id !== pending.operation.id ||
          !pending.operation.delivered
        ) {
          // A late/duplicate reply is not a broken browser session. Never run it again.
          send(res, 200, { ok: true, ignored: true })
          return
        }
        const active = pending
        const error =
          data.error === undefined
            ? undefined
            : bridgeErrorSchema.parse(data.error)
        active.operation.state = error
          ? active.operation.state === "timed_out"
            ? "timed_out"
            : active.operation.cancelRequested
              ? "cancelled"
              : "failed"
          : "completed"
        active.operation.finishedAt = Date.now()
        if (error) active.operation.error = error
        else delete active.operation.error
        // Keep durable identity even for large projects, without retaining their contents.
        if (
          !error &&
          ["apply", "history"].includes(active.operation.method) &&
          data.result &&
          typeof data.result === "object"
        ) {
          const receipt = data.result as Record<string, unknown>
          if (
            typeof receipt.projectId === "string" &&
            receipt.projectId.length <= 256 &&
            typeof receipt.revision === "string" &&
            receipt.revision.length <= 64
          )
            active.operation.result = {
              projectId: receipt.projectId,
              revision: receipt.revision,
            }
        }
        const value =
          ["apply", "history"].includes(active.operation.method) &&
          data.result &&
          typeof data.result === "object"
            ? { ...data.result, operationId: active.operation.id }
            : data.result
        finish(active, error, value)
        pending = undefined
        send(res, 200, { ok: true })
        return
      }
      send(res, 404, { error: "not_found" })
    } catch (error) {
      send(res, 400, {
        error: error instanceof Error ? error.message : "invalid_request",
      })
    }
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 10_000
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  boundPort = (server.address() as { port: number }).port
  return {
    port: boundPort,
    pairingCode: `${boundPort}:${token}`,
    connected: () => Boolean(session && Date.now() - session.seen <= 90_000),
    status: (id?: string) => {
      pruneOperations()
      return id
        ? (operations.get(id) ?? null)
        : [...operations.values()].slice(-10)
    },
    async request(
      method:
        | "snapshot"
        | "apply"
        | "render"
        | "package"
        | "evaluate"
        | "history",
      params: unknown = {},
      signal?: AbortSignal
    ): Promise<unknown> {
      signal?.throwIfAborted()
      if (!session || Date.now() - session.seen > 90_000) {
        release()
        throw new BridgeError({
          code: "browser_not_connected",
          message: "Open PocketDraft and connect using the pairing code.",
        })
      }
      if (pending)
        throw new BridgeError({
          code: "editor_busy",
          message:
            "The browser is finishing an operation; inspect its status before retrying.",
          operationId: pending.operation.id,
        })
      pruneOperations()
      while (operations.size >= 100)
        operations.delete(operations.keys().next().value!)
      return new Promise((resolve, reject) => {
        const operation: Operation = {
          id: randomBytes(16).toString("hex"),
          method,
          state: "running",
          startedAt: Date.now(),
          delivered: false,
          cancelRequested: false,
        }
        operations.set(operation.id, operation)
        const cancel = (timeout: boolean) => {
          if (!pending || pending.operation.id !== operation.id) return
          operation.cancelRequested = true
          operation.state = timeout ? "timed_out" : "cancelled"
          operation.finishedAt = Date.now()
          const error = {
            code: timeout ? "browser_timeout" : "cancelled",
            message:
              "Operation stopped. Inspect operation status and the project before retrying a write.",
          }
          operation.error = error
          finish(pending, error)
          // Keep a delivered operation occupying the editor until its final reply.
          if (!operation.delivered) pending = undefined
        }
        const onAbort = () => cancel(signal?.reason?.name === "TimeoutError")
        const timer = setTimeout(() => cancel(true), timeoutMs)
        pending = {
          operation,
          params,
          deadline: Date.now() + timeoutMs,
          resolve,
          reject,
          settled: false,
          cleanup: () => {
            clearTimeout(timer)
            signal?.removeEventListener("abort", onAbort)
          },
        }
        signal?.addEventListener("abort", onAbort, { once: true })
        if (signal?.aborted) onAbort()
        else deliver()
      })
    },
    async close() {
      release()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
