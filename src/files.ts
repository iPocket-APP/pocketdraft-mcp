import { open, realpath, mkdir, writeFile, rename, rm } from "node:fs/promises"
import path from "node:path"
import { constants } from "node:fs"
import { MAX_ASSET_BYTES } from "../lib/pocket-draft/mcp/protocol"

export function isWithin(root: string, target: string, paths = path) {
  const relative = paths.relative(root, target)
  return (
    relative !== ".." &&
    !relative.startsWith(`..${paths.sep}`) &&
    !paths.isAbsolute(relative)
  )
}
export async function workspacePath(workspace: string, input: string) {
  const [root, target] = await Promise.all([
    realpath(workspace),
    realpath(path.resolve(workspace, input)),
  ])
  if (!isWithin(root, target)) throw new Error("path_outside_workspace")
  return target
}
export async function readWorkspaceImage(
  workspace: string,
  input: string,
  signal: AbortSignal
) {
  signal.throwIfAborted()
  const target = await workspacePath(workspace, input)
  const file = await open(
    target,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
  )
  try {
    const stat = await file.stat()
    if (!stat.isFile()) throw new Error("not_a_file")
    if (stat.size > MAX_ASSET_BYTES) throw new Error("image_too_large")
    // Bounded read also protects against a file growing after stat().
    const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_ASSET_BYTES + 1))
    let size = 0
    while (size < buffer.length) {
      signal.throwIfAborted()
      const { bytesRead } = await file.read(
        buffer,
        size,
        buffer.length - size,
        size
      )
      if (!bytesRead) break
      size += bytesRead
    }
    if (size > stat.size || size > MAX_ASSET_BYTES)
      throw new Error("file_changed: retry after the file finishes writing")
    return buffer.subarray(0, size)
  } finally {
    await file.close()
  }
}
export async function writeExports(
  workspace: string,
  files: Array<{ data: string; extension: string }>,
  signal: AbortSignal
) {
  const root = path.join(workspace, "exports")
  await mkdir(root, { recursive: true })
  const canonical = await workspacePath(workspace, root)
  const id = crypto.randomUUID(),
    temporary = path.join(canonical, `.pending-${id}`),
    output = path.join(canonical, id)
  await mkdir(temporary)
  try {
    for (const [i, file] of files.entries()) {
      signal.throwIfAborted()
      if (!/^(png|jpg|pocketdraft)$/.test(file.extension))
        throw new Error("invalid_export_type")
      await writeFile(
        path.join(temporary, `${i + 1}.${file.extension}`),
        Buffer.from(file.data, "base64"),
        { flag: "wx", signal }
      )
    }
    signal.throwIfAborted()
    await rename(temporary, output)
    return files.map((file, i) =>
      path.join(output, `${i + 1}.${file.extension}`)
    )
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
}
