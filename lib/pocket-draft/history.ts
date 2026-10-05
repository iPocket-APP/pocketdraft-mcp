import {
  cloneProject,
  referencedAssets,
  type Project,
} from "@/lib/pocket-draft/models"

type Snapshot = { project: Project; label: string; entryId: string }
export type HistoryAction = "undo" | "redo"

export class HistoryManager {
  private undoStack: Snapshot[]
  private redoStack: Snapshot[] = []
  private readonly capacity: number

  constructor(initial: Project, limit = 40) {
    this.undoStack = [
      {
        project: cloneProject(initial),
        label: "initial",
        entryId: crypto.randomUUID(),
      },
    ]
    this.capacity = Math.max(2, limit)
  }

  reset(project: Project) {
    this.undoStack = [
      {
        project: cloneProject(project),
        label: "initial",
        entryId: crypto.randomUUID(),
      },
    ]
    this.redoStack = []
  }

  commit(project: Project, label: string) {
    const last = this.undoStack.at(-1)
    if (last && JSON.stringify(last.project) === JSON.stringify(project)) return
    this.undoStack.push({
      project: cloneProject(project),
      label,
      entryId: crypto.randomUUID(),
    })
    if (this.undoStack.length > this.capacity) {
      this.undoStack.splice(0, this.undoStack.length - this.capacity)
    }
    this.redoStack = []
  }

  describe() {
    const entry = (snapshot: Snapshot | undefined) =>
      snapshot ? { entryId: snapshot.entryId, label: snapshot.label } : null
    return {
      undo: this.canUndo ? entry(this.undoStack.at(-1)) : null,
      redo: entry(this.redoStack.at(-1)),
    }
  }

  prepare(action: HistoryAction, entryId: string): Project {
    const current = this.describe()[action]
    if (!current || current.entryId !== entryId)
      throw new Error(
        "history_conflict: inspect the current history entry before retrying"
      )
    const target =
      action === "undo" ? this.undoStack.at(-2)! : this.redoStack.at(-1)!
    return cloneProject(target.project)
  }

  /** Called only after durable storage succeeds for guarded MCP history operations. */
  complete(action: HistoryAction, entryId: string, committed: Project) {
    this.prepare(action, entryId)
    if (action === "undo") {
      this.redoStack.push(this.undoStack.pop()!)
      this.undoStack.at(-1)!.project = cloneProject(committed)
    } else {
      const next = this.redoStack.pop()!
      this.undoStack.push({ ...next, project: cloneProject(committed) })
    }
  }

  undo(): Project | null {
    const entry = this.describe().undo
    if (!entry) return null
    const target = this.prepare("undo", entry.entryId)
    this.complete("undo", entry.entryId, target)
    return target
  }

  redo(): Project | null {
    const entry = this.describe().redo
    if (!entry) return null
    const target = this.prepare("redo", entry.entryId)
    this.complete("redo", entry.entryId, target)
    return target
  }

  get canUndo() {
    return this.undoStack.length > 1
  }

  get canRedo() {
    return this.redoStack.length > 0
  }

  allReferencedAssets(): Set<string> {
    const refs = new Set<string>()
    for (const snapshot of [...this.undoStack, ...this.redoStack]) {
      for (const ref of referencedAssets(snapshot.project)) refs.add(ref)
    }
    return refs
  }
}
