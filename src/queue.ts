import { BridgeError } from "../lib/pocket-draft/bridge-protocol"

type Job = { start: () => Promise<void>; cancel: () => void }
/** Only editor operations serialize. Cancellation removes a waiter immediately. */
export class EditorQueue {
  private jobs: Job[] = []
  private running = false
  run<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted()
    if (this.jobs.length >= 16)
      return Promise.reject(
        new BridgeError({
          code: "editor_busy",
          message: "Editor queue is full; wait for the current operation.",
        })
      )
    return new Promise<T>((resolve, reject) => {
      const cancel = () => {
        const index = this.jobs.indexOf(job)
        if (index < 0) return
        this.jobs.splice(index, 1)
        signal.removeEventListener("abort", cancel)
        reject(signal.reason)
      }
      const job: Job = {
        cancel,
        start: async () => {
          signal.removeEventListener("abort", cancel)
          try {
            signal.throwIfAborted()
            resolve(await fn())
          } catch (error) {
            reject(error)
          }
        },
      }
      this.jobs.push(job)
      signal.addEventListener("abort", cancel, { once: true })
      if (signal.aborted) cancel()
      void this.drain()
    })
  }
  private async drain() {
    if (this.running) return
    this.running = true
    try {
      while (this.jobs.length) await this.jobs.shift()!.start()
    } finally {
      this.running = false
    }
  }
}
