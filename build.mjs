import { build } from "esbuild"
import { chmod, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL(".", import.meta.url))
const manifest = JSON.parse(
  await readFile(new URL("package.json", import.meta.url), "utf8")
)
const protocol = await readFile(
  new URL("lib/pocket-draft/bridge-protocol.ts", import.meta.url),
  "utf8"
)
if (!protocol.includes(`LOCAL_MCP_VERSION = "${manifest.version}"`))
  throw new Error("Package and shared bridge versions must match")

await build({
  absWorkingDir: root,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: [
    "@modelcontextprotocol/server",
    "@modelcontextprotocol/server/*",
    "zod",
  ],
  banner: {
    js: "#!/usr/bin/env node\n// Third-party notices: ../THIRD_PARTY_NOTICES.md and ../licenses/Goldie.txt",
  },
})
await chmod(new URL("dist/index.mjs", import.meta.url), 0o755)
