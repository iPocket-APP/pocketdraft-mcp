import { describe, expect, it } from "vitest"
import { HistoryManager } from "./history"
import { createBlankProject } from "./models"
describe("guarded history", () => {
  it("prepares without moving history; failed saves leave the expected entry available", () => {
    const initial = createBlankProject(),
      history = new HistoryManager(initial)
    history.commit({ ...initial, name: "MCP" }, "MCP edit")
    const entry = history.describe().undo!,
      before = history.describe()
    const target = history.prepare("undo", entry.entryId)
    expect(target).toEqual(initial)
    expect(history.describe()).toEqual(before)
    history.complete("undo", entry.entryId, target)
    expect(history.canUndo).toBe(false)
    const redo = history.describe().redo!
    expect(history.prepare("redo", redo.entryId).name).toBe("MCP")
    history.complete("redo", redo.entryId, { ...initial, name: "MCP" })
    expect(history.describe().undo).toEqual(entry)
  })
  it("rejects uninspected human edits and does not add duplicate entries", () => {
    const p = createBlankProject(),
      h = new HistoryManager(p)
    const next = { ...p, name: "MCP" }
    h.commit(next, "MCP")
    const entry = h.describe().undo!
    h.commit(next, "Same value")
    expect(h.describe().undo).toEqual(entry)
    h.commit({ ...next, name: "Human" }, "typing")
    expect(() => h.prepare("undo", entry.entryId)).toThrow("history_conflict")
  })
})
