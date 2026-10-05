import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
  readdir,
  readFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, expect, it } from "vitest"
import {
  isWithin,
  readWorkspaceImage,
  workspacePath,
  writeExports,
} from "./files"
const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})
it("contains POSIX and Windows paths, including siblings and other drives", () => {
  expect(isWithin("C:\\work", "C:\\outside\\image.png", path.win32)).toBe(false)
  expect(isWithin("C:\\work", "D:\\image.png", path.win32)).toBe(false)
  expect(isWithin("C:\\work", "C:\\work2\\image.png", path.win32)).toBe(false)
  expect(isWithin("C:\\work", "C:\\work\\nested\\image.png", path.win32)).toBe(
    true
  )
  expect(isWithin("/work", "/outside/a", path.posix)).toBe(false)
  expect(isWithin("/work", "/work/a", path.posix)).toBe(true)
})
it("denies symlinks outside the workspace and non-files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mcp-path-"))
  roots.push(root)
  const workspace = path.join(root, "work")
  await mkdir(workspace)
  await writeFile(path.join(root, "outside.png"), "private")
  await symlink(
    path.join(root, "outside.png"),
    path.join(workspace, "link.png")
  )
  await expect(workspacePath(workspace, "link.png")).rejects.toThrow(
    "path_outside_workspace"
  )
  await expect(
    readWorkspaceImage(workspace, ".", new AbortController().signal)
  ).rejects.toThrow("not_a_file")
})
it("publishes complete exports and removes failed partial directories", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "mcp-export-"))
  roots.push(workspace)
  const signal = new AbortController().signal
  const files = await writeExports(
    workspace,
    [{ data: Buffer.from("image").toString("base64"), extension: "png" }],
    signal
  )
  expect(await readFile(files[0], "utf8")).toBe("image")
  await expect(
    writeExports(
      workspace,
      [
        { data: "", extension: "png" },
        { data: "", extension: "../bad" },
      ],
      signal
    )
  ).rejects.toThrow("invalid_export_type")
  expect((await readdir(path.join(workspace, "exports"))).length).toBe(1)
})
