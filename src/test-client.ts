import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
export type ToolReply = {
  isError?: boolean
  structuredContent: Record<string, unknown>
  content: Array<{
    type: string
    text?: string
    data?: string
    mimeType?: string
  }>
}
export class TestMcpClient {
  private id = 0
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  readonly process: ChildProcessWithoutNullStreams
  stderr = ""
  constructor(
    entry: string,
    workspace: string,
    origin = "https://tools.ipocket.xyz",
    private requestTimeoutMs = 30_000
  ) {
    this.process = spawn(
      process.execPath,
      [entry, "--workspace", workspace, "--origin", origin],
      { stdio: ["pipe", "pipe", "pipe"] }
    )
    this.process.stderr.on("data", (chunk) => {
      this.stderr += chunk
    })
    createInterface({ input: this.process.stdout }).on("line", (line) => {
      const message = JSON.parse(line) as {
        id?: number
        result?: unknown
        error?: { message: string }
      }
      if (message.id === undefined) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
    this.process.once("exit", () => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer)
        request.reject(new Error("MCP process exited"))
      }
      this.pending.clear()
    })
  }
  notify(method: string, params?: unknown) {
    this.process.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n"
    )
  }
  request<T = Record<string, unknown>>(method: string, params: unknown = {}) {
    const id = ++this.id
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC timed out: ${method}`))
      }, this.requestTimeoutMs)
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      })
      this.process.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"
      )
    })
    return { id, promise }
  }
  call<T = Record<string, unknown>>(method: string, params: unknown = {}) {
    return this.request<T>(method, params).promise
  }
  tool(name: string, args: unknown = {}) {
    return this.call<ToolReply>("tools/call", { name, arguments: args })
  }
  cancel(id: number) {
    this.notify("notifications/cancelled", {
      requestId: id,
      reason: "test cancellation",
    })
    const pending = this.pending.get(id)
    if (pending) {
      this.pending.delete(id)
      clearTimeout(pending.timer)
      pending.reject(new Error("Cancelled"))
    }
  }
  async initialize() {
    await this.call("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "pocketdraft-test", version: "1" },
    })
    this.notify("notifications/initialized")
  }
  async close() {
    if (this.process.exitCode !== null) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => this.process.kill("SIGKILL"), 2000)
      this.process.once("exit", () => {
        clearTimeout(timer)
        resolve()
      })
      this.process.stdin.end()
    })
  }
}
