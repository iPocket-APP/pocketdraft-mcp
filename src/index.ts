import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"
import { realpath, stat } from "node:fs/promises"
import { resolve } from "node:path"
import { startBridge } from "./bridge"
import { createLocalMcpServer } from "./server"
import { MAX_REQUEST_BYTES } from "../lib/pocket-draft/mcp/protocol"

const args = process.argv.slice(2)
if (args.includes("--help")) {
  console.log(
    "pocketdraft-mcp [--workspace /path] [--origin https://tools.ipocket.xyz] [--port 0]\nConnect over MCP stdio, call pocketdraft_connection, and paste its pairing code into the browser editor."
  )
  process.exit(0)
}
const options: Record<string, string> = {}
for (let i = 0; i < args.length; i += 2) {
  if (!["--workspace", "--origin", "--port"].includes(args[i]) || !args[i + 1])
    throw new Error("Invalid CLI arguments; use --help")
  options[args[i]] = args[i + 1]
}
const workspace = await realpath(
  resolve(options["--workspace"] ?? process.cwd())
)
if (!(await stat(workspace)).isDirectory())
  throw new Error("--workspace must be an existing directory")
const origin = options["--origin"] ?? "https://tools.ipocket.xyz"
const url = new URL(origin)
if (url.origin !== origin || !["https:", "http:"].includes(url.protocol))
  throw new Error("--origin must be an exact HTTP(S) origin")
const port = Number(options["--port"] ?? 0)
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error("Invalid port")
const bridge = await startBridge([origin], port)
const server = createLocalMcpServer(bridge, workspace, origin)
let closing = false
const shutdown = async () => {
  if (closing) return
  closing = true
  await bridge.close()
  await server.close()
  process.exit(0)
}
process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)
process.stdin.once("end", shutdown)
await server.connect(
  new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: MAX_REQUEST_BYTES + 65536,
  })
)
