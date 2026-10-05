import { afterEach, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock("node:dns/promises", () => ({ lookup: state.lookup }))
import { nodePublicFetch } from "./node-fetch"
afterEach(() => {
  vi.unstubAllEnvs()
  state.lookup.mockReset()
})
it("rejects DNS names resolving to private or mixed addresses before connecting", async () => {
  vi.stubEnv("NODE_ENV", "production")
  for (const answers of [
    [{ address: "127.0.0.1", family: 4 }],
    [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ],
  ]) {
    state.lookup.mockResolvedValue(answers)
    await expect(
      nodePublicFetch(
        new URL("https://example.com/image"),
        new AbortController().signal
      )
    ).rejects.toThrow("non-public")
  }
})
it("cancels a pending DNS lookup", async () => {
  state.lookup.mockImplementation(() => new Promise(() => {}))
  const controller = new AbortController()
  const pending = nodePublicFetch(
    new URL("https://example.com/image"),
    controller.signal
  )
  controller.abort(new Error("cancelled"))
  await expect(pending).rejects.toThrow("cancelled")
})
