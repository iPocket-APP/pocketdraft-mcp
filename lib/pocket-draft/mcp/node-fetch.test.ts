import { createServer } from "node:http"
import { once } from "node:events"
import { afterEach, expect, it, vi } from "vitest"
import { resolveAssetSource } from "./fetch-asset"
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
)
afterEach(() => vi.unstubAllEnvs())
it("pins a development DNS connection and follows allowed local redirects", async () => {
  vi.stubEnv("NODE_ENV", "development")
  vi.stubEnv("POCKET_DRAFT_MCP_ALLOW_LOCAL_ASSETS", "true")
  const server = createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/image" })
      res.end()
      return
    }
    res.writeHead(200, { "content-type": "image/png" })
    res.end(PNG)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const address = server.address() as { port: number }
    const asset = await resolveAssetSource(
      `http://127.0.0.1:${address.port}/redirect`
    )
    expect(asset.width).toBe(1)
    expect(asset.mimeType).toBe("image/png")
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve()))
    )
  }
})
