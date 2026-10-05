/** Abort promptly, disposing resources that finish decoding after cancellation. */
export function abortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  dispose?: (value: T) => void
): Promise<T> {
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new DOMException("Cancelled", "AbortError"))
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) abort()
    promise
      .then((value) => {
        if (signal.aborted) dispose?.(value)
        else resolve(value)
      }, reject)
      .finally(() => signal.removeEventListener("abort", abort))
  })
}
