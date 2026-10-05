import "fake-indexeddb/auto"
import { afterEach, expect, it, vi } from "vitest"
const fonts = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock("./bundled-fonts", () => ({ ensurePocketDraftFonts: fonts }))
import { createBlankProject } from "./models"
import { runBrowserBridge } from "./bridge-client"
import { projectRevision } from "./browser-bridge"
import {
  errorData,
  compatibleBridge,
  BRIDGE_CAPABILITIES,
  BRIDGE_PROTOCOL_VERSION,
} from "./bridge-protocol"
import { startBridge } from "../../src/bridge"
import { abortable } from "./abort"
let bridge: Awaited<ReturnType<typeof startBridge>>,
  controller: AbortController,
  task: Promise<unknown>
afterEach(async () => {
  controller?.abort()
  await task
  await bridge?.close()
})
const origin = "https://tools.ipocket.xyz"
async function setup(timeout = 60_000) {
  bridge = await startBridge([origin], 0, timeout)
  controller = new AbortController()
  const project = createBlankProject()
  const apply = vi.fn(
    async (
      _document: unknown,
      _revision: string,
      _deadline: number,
      signal: AbortSignal,
      checkpoint?: () => Promise<void>
    ) => {
      await checkpoint?.()
      await abortable(new Promise<void>(() => {}), signal)
      return { projectId: project.id, revision: await projectRevision(project) }
    }
  )
  let connected!: () => void
  const ready = new Promise<void>((resolve) => {
    connected = resolve
  })
  task = runBrowserBridge(bridge.pairingCode, {
    signal: controller.signal,
    getEditor: () => ({
      hydrated: true,
      editingTextId: null,
      getBridgeProject: () => project,
      applyBridgeDocument: apply,
    }),
    connected,
    fetch: (url, options) =>
      fetch(url, {
        ...options,
        headers: { ...options?.headers, Origin: origin },
      }),
  }).catch((error) => error)
  await ready
  return { apply, project }
}
it("propagates cancellation while browser work is active, then keeps polling", async () => {
  const { apply, project } = await setup()
  const operation = new AbortController()
  const result = bridge
    .request(
      "apply",
      { revision: await projectRevision(project), document: {} },
      operation.signal
    )
    .catch((error) => error)
  await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce())
  operation.abort()
  expect(await result).toMatchObject({ data: { code: "cancelled" } })
  await vi.waitFor(
    () =>
      expect(bridge.status()).toMatchObject([
        { state: "cancelled", finishedAt: expect.any(Number) },
      ]),
    { timeout: 2000 }
  )
  // Wait for the actual browser receipt, not just local cancellation state.
  await vi.waitFor(
    () =>
      expect(
        (bridge.status() as Array<{ error?: { message: string } }>)[0]?.error
          ?.message
      ).toContain("local MCP stopped"),
    { timeout: 2000 }
  )
  expect(await bridge.request("snapshot")).toMatchObject({
    project: { id: project.id },
    assets: {},
  })
  expect(bridge.connected()).toBe(true)
})
it("recovers from an operation deadline without requiring a new pairing", async () => {
  // Exercise a deadline after delivery, without depending on sub-40ms HTTP I/O.
  const { project, apply } = await setup(1000)
  const pending = bridge
    .request("apply", {
      revision: await projectRevision(project),
      document: {},
    })
    .catch((error) => error)
  await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce())
  expect(await pending).toBeInstanceOf(Error)
  await vi.waitFor(() =>
    expect(
      (bridge.status() as Array<{ error?: { code: string } }>)[0]?.error?.code
    ).toBe("cancelled")
  )
  expect(await bridge.request("snapshot")).toMatchObject({
    project: { id: project.id },
  })
})
it("normalizes DOM abort codes and checks all required capabilities", () => {
  expect(errorData(new DOMException("Stopped", "AbortError"))).toMatchObject({
    code: "cancelled",
  })
  expect(
    compatibleBridge({
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      capabilities: BRIDGE_CAPABILITIES,
    })
  ).toBe(true)
  expect(
    compatibleBridge({
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      capabilities: [],
    })
  ).toBe(false)
})

it("rejects a manual revision change during browser measurement", async () => {
  const { project } = await setup()
  let release!: () => void
  fonts.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  const pending = bridge
    .request("evaluate", {
      document: { schemaVersion: 1, project, assets: {} },
      revision: await projectRevision(project),
      operation: "inspect",
    })
    .catch((error) => error)
  await vi.waitFor(() => expect(release).toBeTypeOf("function"))
  project.name = "Human edited during measurement"
  release()
  expect(await pending).toMatchObject({ data: { code: "revision_conflict" } })
  expect(await bridge.request("snapshot")).toMatchObject({
    project: { name: "Human edited during measurement" },
  })
})
