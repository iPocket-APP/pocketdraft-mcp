import { isIP } from "node:net"
import { PocketDraftMcpError } from "./errors"

export function isPublicAddress(raw: string): boolean {
  const host = raw.replace(/^\[|\]$/g, "").toLowerCase()
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number)
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    )
  }
  if (isIP(host) === 6) {
    // Only global unicast; excludes mapped, loopback, ULA, link-local and multicast.
    const first = parseInt(host.split(":")[0], 16)
    const second = parseInt(host.split(":")[1] || "0", 16)
    return (
      first >= 0x2000 &&
      first <= 0x3fff &&
      !host.startsWith("2001:db8:") &&
      !host.startsWith("2002:") &&
      !(first === 0x2001 && second <= 0x1ff)
    )
  }
  return false
}
export function localAssetsEnabled() {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.POCKET_DRAFT_MCP_ALLOW_LOCAL_ASSETS === "true"
  )
}
export function isLoopback(host: string) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)
}
export function assertAllowedAssetUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new PocketDraftMcpError("invalid_input", "Invalid asset URL.")
  }
  const host = url.hostname.toLowerCase()
  const local = isLoopback(host) && localAssetsEnabled()
  if (
    url.username ||
    url.password ||
    (!local && url.protocol !== "https:") ||
    (local && !["http:", "https:"].includes(url.protocol))
  )
    throw new PocketDraftMcpError(
      "asset_error",
      "Use a public HTTPS image URL without credentials."
    )
  if (
    !local &&
    (isLoopback(host) ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host === "localhost." ||
      (isIP(host.replace(/^\[|\]$/g, "")) && !isPublicAddress(host)))
  )
    throw new PocketDraftMcpError(
      "asset_error",
      "Image URL host is not allowed."
    )
  return url
}
