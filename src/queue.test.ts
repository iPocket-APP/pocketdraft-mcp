import { expect, it, vi } from "vitest"
import { EditorQueue } from "./queue"
it("removes cancelled waiters immediately without running their work", async () => {
  const queue = new EditorQueue(),
    signal = new AbortController().signal
  let finish!: () => void
  const first = queue.run(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    signal
  )
  const cancelled = new AbortController(),
    work = vi.fn(async () => "bad")
  const second = queue.run(work, cancelled.signal)
  cancelled.abort()
  await expect(second).rejects.toThrow()
  expect(work).not.toHaveBeenCalled()
  finish()
  await first
  expect(await queue.run(async () => "next", signal)).toBe("next")
})
