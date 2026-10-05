import { lookup } from "node:dns/promises"
import { request as httpsRequest } from "node:https"
import { request as httpRequest } from "node:http"
import { Readable } from "node:stream"
import { isLoopback, isPublicAddress, localAssetsEnabled } from "./url-policy"
import { PocketDraftMcpError } from "./errors"

// Pin the connection to the validated DNS answer. A separate preflight lookup
// followed by global fetch would leave a DNS rebinding window.
export async function nodePublicFetch(
  url: URL,
  signal: AbortSignal
): Promise<Response> {
  const host = url.hostname.replace(/^\[|\]$/g, "")
  const answers = await new Promise<Array<{ address: string; family: number }>>(
    (resolve, reject) => {
      const abort = () => reject(signal.reason)
      signal.addEventListener("abort", abort, { once: true })
      if (signal.aborted) {
        signal.removeEventListener("abort", abort)
        reject(signal.reason)
        return
      }
      lookup(host, { all: true })
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort))
    }
  )
  signal.throwIfAborted()
  if (
    !answers.length ||
    (!(localAssetsEnabled() && isLoopback(host)) &&
      answers.some((a) => !isPublicAddress(a.address)))
  )
    throw new PocketDraftMcpError(
      "asset_error",
      "Image host resolves to a non-public address."
    )
  const address = answers[0]
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        signal,
        headers: {
          Accept: "image/png,image/jpeg,image/gif,image/webp",
          "Accept-Encoding": "identity",
        },
        lookup: (_hostname, options, callback) =>
          options.all
            ? callback(null, [address])
            : callback(null, address.address, address.family),
      },
      (res) => {
        const headers = new Headers()
        for (const [name, value] of Object.entries(res.headers))
          if (value !== undefined)
            headers.set(name, Array.isArray(value) ? value.join(", ") : value)
        const status = res.statusCode ?? 502
        if ([204, 205, 304].includes(status)) {
          res.resume()
          resolve(new Response(null, { status, headers }))
          return
        }
        resolve(
          new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, {
            status,
            headers,
          })
        )
      }
    )
    request.on("error", reject)
    request.end()
  })
}
