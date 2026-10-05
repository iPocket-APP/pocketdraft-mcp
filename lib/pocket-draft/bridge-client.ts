import { referencedAssets, type Project } from "./models"
import {
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_CAPABILITIES,
  bridgeCommandSchema,
  compatibleBridge,
  errorData,
} from "./bridge-protocol"
import {
  BridgeImageCache,
  browserSnapshot,
  projectRevision,
  renderBridgeProject,
  exportBridgePackage,
  evaluateBridgeDocument,
} from "./browser-bridge"

export type BridgeEditor = {
  hydrated: boolean
  editingTextId: string | null
  getBridgeProject: () => Project
  getBridgeHistory?: () => unknown
  applyBridgeHistory?: (
    action: "undo" | "redo",
    entryId: string,
    revision: string,
    deadline: number,
    signal: AbortSignal,
    checkpoint?: () => Promise<void>
  ) => Promise<unknown>
  applyBridgeDocument: (
    document: unknown,
    revision: string,
    deadline: number,
    signal: AbortSignal,
    checkpoint?: () => Promise<void>
  ) => Promise<{ projectId: string; revision: string }>
}

/** Transport lifecycle is separate from React, so real HTTP pairing/cancellation can be tested. */
export async function runBrowserBridge(
  code: string,
  options: {
    signal: AbortSignal
    getEditor: () => BridgeEditor
    connected: () => void
    fetch?: typeof fetch
  }
) {
  const match = /^(\d{1,5}):([a-f0-9]{64})$/.exec(code.trim())
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535)
    throw new Error("invalid_pairing_code")
  const url = `http://127.0.0.1:${match[1]}`,
    fetcher = options.fetch ?? fetch
  let sessionId = ""
  const images = new BridgeImageCache()
  const headers = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${match[2]}`,
    "X-PocketDraft-Session": sessionId,
  })
  const post = async (path: string, body: unknown = {}) => {
    const response = await fetcher(`${url}/${path}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.any([
        options.signal,
        AbortSignal.timeout(path === "poll" ? 30_000 : 15_000),
      ]),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? "connection_failed")
    return data
  }
  let disconnected = false
  const disconnect = () => {
    if (!sessionId || disconnected) return
    disconnected = true
    void fetcher(`${url}/disconnect`, {
      method: "POST",
      headers: headers(),
      keepalive: true,
    }).catch(() => {})
  }
  options.signal.addEventListener("abort", disconnect, { once: true })
  try {
    const paired = await post("connect", {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      capabilities: BRIDGE_CAPABILITIES,
    })
    sessionId = paired.sessionId
    options.signal.throwIfAborted()
    if (!compatibleBridge(paired))
      throw new Error(
        "protocol_mismatch: update the local MCP package and reload the editor"
      )
    options.connected()
    while (!options.signal.aborted) {
      const raw = await post("poll")
      if (!raw) continue
      const command = bridgeCommandSchema.parse(raw)
      const cancellation = new AbortController()
      const signal = AbortSignal.any([
        options.signal,
        cancellation.signal,
        AbortSignal.timeout(Math.max(0, command.deadline - Date.now())),
      ])
      let heartbeatBusy = false
      const checkpoint = async () => {
        signal.throwIfAborted()
        const response = await post("heartbeat", { id: command.id })
        if (response.cancelled)
          cancellation.abort(
            new Error("cancelled: local MCP stopped this operation")
          )
        signal.throwIfAborted()
      }
      const heartbeat = setInterval(() => {
        if (heartbeatBusy || signal.aborted) return
        heartbeatBusy = true
        void checkpoint()
          .catch((error) => cancellation.abort(error))
          .finally(() => {
            heartbeatBusy = false
          })
      }, 500)
      let reply: { result?: unknown; error?: ReturnType<typeof errorData> }
      try {
        signal.throwIfAborted()
        const editor = options.getEditor()
        if (!editor.hydrated) throw new Error("editor_loading")
        if (command.method === "snapshot")
          reply = {
            result: {
              ...(await browserSnapshot(editor.getBridgeProject(), signal)),
              history: editor.getBridgeHistory?.(),
            },
          }
        else if (command.method === "apply") {
          if (editor.editingTextId)
            throw new Error("editor_busy: finish text editing first")
          reply = {
            result: await editor.applyBridgeDocument(
              command.params.document,
              String(command.params.revision),
              command.deadline,
              signal,
              checkpoint
            ),
          }
        } else if (command.method === "history") {
          if (editor.editingTextId) throw new Error("editor_busy")
          if (!editor.applyBridgeHistory) throw new Error("history_unavailable")
          if (!["undo", "redo"].includes(String(command.params.action)))
            throw new Error("invalid_history_action")
          reply = {
            result: await editor.applyBridgeHistory(
              command.params.action as "undo" | "redo",
              String(command.params.entryId),
              String(command.params.revision),
              command.deadline,
              signal,
              checkpoint
            ),
          }
        } else {
          const project = editor.getBridgeProject()
          if ((await projectRevision(project)) !== command.params.revision)
            throw new Error("revision_conflict")
          reply = {
            result:
              command.method === "evaluate"
                ? await evaluateBridgeDocument(
                    command.params.document,
                    command.params,
                    signal,
                    images,
                    referencedAssets(project)
                  )
                : command.method === "package"
                  ? await exportBridgePackage(project, signal)
                  : await renderBridgeProject(
                      project,
                      command.params,
                      signal,
                      images
                    ),
          }
          if (
            (await projectRevision(options.getEditor().getBridgeProject())) !==
            command.params.revision
          )
            throw new Error("revision_conflict")
        }
      } catch (error) {
        reply = { error: errorData(error) }
      } finally {
        clearInterval(heartbeat)
      }
      // Uses the session signal, so a cancelled operation can still send its final receipt.
      await post("reply", { id: command.id, ...reply })
    }
  } finally {
    images.close()
    options.signal.removeEventListener("abort", disconnect)
    disconnect()
  }
}
