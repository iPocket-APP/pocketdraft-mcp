import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

// Exercise only a temporary installation, never a user's paired editor.
const root = fileURLToPath(new URL("../", import.meta.url))
const exec = promisify(execFile)
const npmCli = process.env.npm_execpath
assert(npmCli, "Run this script with npm run verify:package")
const npm = (args, cwd) =>
  exec(process.execPath, [npmCli, ...args], {
    cwd,
    maxBuffer: 2 * 1024 * 1024,
    timeout: 180_000,
  })
const temporary = await mkdtemp(path.join(tmpdir(), "pocketdraft-package-"))
let child
const pending = new Map()
let id = 0
let stderr = ""

function request(method, params = {}) {
  const requestId = ++id
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error(`MCP request timed out: ${method}`))
    }, 15_000)
    pending.set(requestId, { resolve, reject, timer })
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) + "\n"
    )
  })
}

try {
  const { stdout } = await npm(
    ["pack", "--json", "--pack-destination", temporary],
    root
  )
  const [packed] = JSON.parse(stdout.slice(stdout.indexOf("[")))
  const allowed = (name) =>
    ["package.json", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"].includes(name) ||
    name.startsWith("dist/") || name.startsWith("licenses/")
  assert(packed.files.every((file) => allowed(file.path)), "Unexpected tarball file")
  assert(packed.files.some((file) => file.path === "dist/index.mjs"))
  assert(packed.files.some((file) => file.path === "licenses/Goldie.txt"))
  await writeFile(
    path.join(temporary, "package.json"),
    JSON.stringify({ name: "pocketdraft-install-check", private: true })
  )
  await npm([
    "install", "--omit=dev", "--no-audit", "--no-fund",
    path.join(temporary, packed.filename),
  ], temporary)

  const installed = path.join(temporary, "node_modules/pocketdraft-mcp")
  const manifest = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8"))
  child = spawn(process.execPath, [
    path.join(installed, "dist/index.mjs"), "--workspace", temporary,
  ], { cwd: temporary, stdio: ["pipe", "pipe", "pipe"] })
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000) })
  child.on("error", (error) => {
    for (const item of pending.values()) {
      clearTimeout(item.timer)
      item.reject(error)
    }
    pending.clear()
  })
  child.on("exit", () => {
    for (const item of pending.values()) {
      clearTimeout(item.timer)
      item.reject(new Error("MCP process exited before replying"))
    }
    pending.clear()
  })
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line)
    const item = pending.get(message.id)
    if (!item) return
    pending.delete(message.id)
    clearTimeout(item.timer)
    if (message.error) item.reject(new Error(message.error.message))
    else item.resolve(message.result)
  })
  const initialized = await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "package-verification", version: "1.0.0" },
  })
  assert.equal(initialized.serverInfo.version, manifest.version)
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")
  const { tools } = await request("tools/list")
  assert.equal(tools.length, 11)
  assert(tools.some((tool) => tool.name === "pocketdraft_batch_mutation"))
  assert(tools.some((tool) => tool.name === "pocketdraft_history"))
  const catalog = await request("tools/call", {
    name: "pocketdraft_list_catalog", arguments: { entity: "devices" },
  })
  assert.notEqual(catalog.isError, true)
  assert(catalog.structuredContent.total > 0)
  const unpaired = await request("tools/call", {
    name: "pocketdraft_inspect_project", arguments: {},
  })
  assert.equal(unpaired.isError, true)
  assert.match(JSON.stringify(unpaired), /browser_not_connected/)
  console.log(`Verified pocketdraft-mcp ${manifest.version}: ${packed.files.length} package files, independent production install, ${tools.length} tools, catalog and unpaired error over real stdio.`)
} catch (error) {
  if (stderr) console.error(stderr)
  throw error
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit")
    child.stdin.end()
    const timer = setTimeout(() => child.kill("SIGKILL"), 2000)
    await exited
    clearTimeout(timer)
  }
  for (const item of pending.values()) clearTimeout(item.timer)
  await rm(temporary, { recursive: true, force: true })
}
