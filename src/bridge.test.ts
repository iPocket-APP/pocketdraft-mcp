import { afterEach, describe, expect, it } from "vitest"
import {
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_CAPABILITIES,
} from "../lib/pocket-draft/bridge-protocol"
import { startBridge } from "./bridge"
let bridge: Awaited<ReturnType<typeof startBridge>>
afterEach(async () => {
  await bridge?.close()
})
async function setup() {
  bridge = await startBridge(["https://tools.ipocket.xyz"])
  const headers: Record<string, string> = {
    Origin: "https://tools.ipocket.xyz",
    Authorization: `Bearer ${bridge.pairingCode.split(":")[1]}`,
    "Content-Type": "application/json",
  }
  const post = (path: string, body?: unknown, extra?: Record<string, string>) =>
    fetch(`http://127.0.0.1:${bridge.port}/${path}`, {
      method: "POST",
      headers: { ...headers, ...extra },
      body: JSON.stringify(
        body ??
          (path === "connect"
            ? {
                protocolVersion: BRIDGE_PROTOCOL_VERSION,
                capabilities: BRIDGE_CAPABILITIES,
              }
            : {})
      ),
    })
  return { headers, post }
}
describe("local browser pairing", () => {
  it("denies hostile origins, missing credentials and invalid sessions", async () => {
    const { post } = await setup()
    expect(
      (await post("connect", {}, { Origin: "https://evil.example" })).status
    ).toBe(403)
    expect(
      (await post("connect", {}, { Authorization: "Bearer bad" })).status
    ).toBe(401)
    expect((await post("poll")).status).toBe(409)
    await expect(bridge.request("snapshot")).rejects.toThrow("Open PocketDraft")
  })
  it("rejects old editor protocols before creating a session", async () => {
    const { post } = await setup()
    expect((await post("connect", { protocolVersion: 1 })).status).toBe(426)
    expect(bridge.connected()).toBe(false)
    expect((await post("connect")).status).toBe(200)
  })
  it("supports preflight only for the configured origin", async () => {
    await setup()
    const response = await fetch(`http://127.0.0.1:${bridge.port}/connect`, {
      method: "OPTIONS",
      headers: { Origin: "https://tools.ipocket.xyz" },
    })
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://tools.ipocket.xyz"
    )
    expect(response.headers.get("access-control-allow-private-network")).toBe(
      "true"
    )
  })
  it("pairs only one editor, routes replies and rejects concurrent commands", async () => {
    const { post, headers } = await setup()
    const paired = await (await post("connect")).json()
    headers["X-PocketDraft-Session"] = paired.sessionId
    expect((await post("connect")).status).toBe(409)
    const response = bridge.request("snapshot")
    await expect(bridge.request("snapshot")).rejects.toThrow(
      "finishing an operation"
    )
    const command = await (await post("poll")).json()
    expect(command.method).toBe("snapshot")
    expect((await post("reply", { id: "wrong", result: {} })).status).toBe(200)
    await post("reply", { id: command.id, result: { revision: "1" } })
    await expect(response).resolves.toEqual({ revision: "1" })
    const rejected = bridge.request("apply", {}).catch((error) => error.message)
    await post("disconnect")
    expect(await rejected).toContain("Browser disconnected")
    expect(bridge.connected()).toBe(false)
    const next = await (await post("connect")).json()
    expect(next.sessionId).not.toBe(paired.sessionId)
    expect((await post("poll")).status).toBe(409)
  })
})

it("cancels delivered work, retains its receipt and accepts late replies without disconnecting", async () => {
  const { post, headers } = await setup()
  headers["X-PocketDraft-Session"] = (
    await (await post("connect")).json()
  ).sessionId
  const controller = new AbortController()
  const pending = bridge
    .request("apply", {}, controller.signal)
    .catch((error) => error)
  const command = await (await post("poll")).json()
  controller.abort()
  expect(((await pending) as { data: unknown }).data).toMatchObject({
    code: "cancelled",
    operationId: command.id,
  })
  expect(await (await post("heartbeat", { id: command.id })).json()).toEqual({
    cancelled: true,
  })
  await expect(bridge.request("snapshot")).rejects.toThrow(
    "finishing an operation"
  )
  expect(
    (
      await post("reply", {
        id: command.id,
        error: { code: "cancelled", message: "cancelled" },
      })
    ).status
  ).toBe(200)
  expect(bridge.status(command.id)).toMatchObject({
    state: "cancelled",
    cancelRequested: true,
  })
  expect((await post("reply", { id: command.id, result: {} })).status).toBe(200)
  expect(bridge.connected()).toBe(true)
  const fresh = bridge.request("snapshot")
  const next = await (await post("poll")).json()
  await post("reply", { id: next.id, result: { fresh: true } })
  expect(await fresh).toEqual({ fresh: true })
})
it("records a completed commit even when cancellation crossed its final reply", async () => {
  const { post, headers } = await setup()
  headers["X-PocketDraft-Session"] = (
    await (await post("connect")).json()
  ).sessionId
  const controller = new AbortController()
  const result = bridge
    .request("apply", {}, controller.signal)
    .catch((error) => error)
  const command = await (await post("poll")).json()
  controller.abort()
  await result
  await post("reply", {
    id: command.id,
    result: {
      projectId: "committed",
      revision: "a".repeat(64),
      project: { content: "large".repeat(10000) },
    },
  })
  expect(bridge.status(command.id)).toMatchObject({
    state: "completed",
    result: { projectId: "committed" },
  })
  expect(bridge.status(command.id)).not.toHaveProperty("result.project")
})
it("times out without breaking the session or retaining image payloads", async () => {
  // Leave time for the real HTTP poll to receive the operation on a busy runner.
  bridge = await startBridge(["https://tools.ipocket.xyz"], 0, 1000)
  const headers = {
    Origin: "https://tools.ipocket.xyz",
    Authorization: `Bearer ${bridge.pairingCode.split(":")[1]}`,
    "Content-Type": "application/json",
    "X-PocketDraft-Session": "",
  }
  const post = (route: string, body: unknown) =>
    fetch(`http://127.0.0.1:${bridge.port}/${route}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  headers["X-PocketDraft-Session"] = (
    await (
      await post("connect", {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        capabilities: BRIDGE_CAPABILITIES,
      })
    ).json()
  ).sessionId
  const work = bridge.request("render").catch((error) => error)
  const command = await (await post("poll", {})).json()
  expect(((await work) as { data: { code: string } }).data.code).toBe(
    "browser_timeout"
  )
  expect(
    (
      await post("reply", {
        id: command.id,
        result: { files: [{ data: "large-base64" }] },
      })
    ).status
  ).toBe(200)
  expect(bridge.connected()).toBe(true)
  expect(bridge.status(command.id)).not.toHaveProperty("result")
})
