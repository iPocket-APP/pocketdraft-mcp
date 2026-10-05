import { TEMPLATES } from "../templates"
import { afterEach, describe, expect, it, vi } from "vitest"
import "fake-indexeddb/auto"
import {
  createEmptyDocument,
  parseDocument,
  exportProjectPackageFromDocument,
} from "./document"
import { batchMutation, previewMutation } from "./mutations"
import { decodeImageDataUrl, imageSizeFromBytes } from "./image-bytes"
import { resolveAssetSource, readLimitedBody } from "./fetch-asset"
import { withCallContext } from "./call-context"
import { assertAllowedAssetUrl } from "./url-policy"
import { MAX_ASSET_BYTES, MAX_REQUEST_BYTES } from "./protocol"
import { importProjectPackage, listProjects, getAsset } from "../storage"

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
describe("document and command boundaries", () => {
  it("rejects unknown document/project/package versions and malformed canvases", async () => {
    const doc = createEmptyDocument()
    expect(() => parseDocument({ ...doc, schemaVersion: 999 })).toThrow(
      "Invalid input"
    )
    expect(() =>
      parseDocument({ ...doc, project: { ...doc.project, schemaVersion: 999 } })
    ).toThrow()
    expect(() =>
      parseDocument({ ...doc, project: { ...doc.project, canvases: [{}] } })
    ).toThrow("Invalid input")
    await expect(
      previewMutation("projects.import", {
        package: {
          type: "pocket-draft-project",
          version: 999,
          project: doc.project,
        },
      })
    ).rejects.toThrow("Unsupported package")
  })
  it("rejects duplicate ids, limits and invalid numeric input with field details", async () => {
    const doc = createEmptyDocument(),
      canvas = doc.project.canvases[0]
    expect(() =>
      parseDocument({
        ...doc,
        project: { ...doc.project, canvases: [canvas, canvas] },
      })
    ).toThrow()
    expect(() =>
      parseDocument({
        ...doc,
        project: {
          ...doc.project,
          canvases: Array.from({ length: 11 }, (_, i) => ({
            ...canvas,
            id: String(i),
          })),
        },
      })
    ).toThrow()
    await expect(
      previewMutation("layers.addText", { document: doc, fontSize: -1 })
    ).rejects.toMatchObject({
      code: "invalid_input",
      details: [{ path: "fontSize", message: expect.any(String) }],
    })
    await expect(
      previewMutation("layers.addText", { document: doc, fontSize: Infinity })
    ).rejects.toThrow()
    await expect(
      previewMutation("assets.attach", {
        document: doc,
        url: PNG,
        target: "typo",
      })
    ).rejects.toThrow()
  })
  it("batch has no partial result and does not mutate the input", async () => {
    const doc = createEmptyDocument(),
      original = JSON.stringify(doc)
    await expect(
      batchMutation({
        document: doc as unknown as Record<string, unknown>,
        commands: [
          { command: "projects.rename", input: { name: "Changed" } },
          { command: "layers.delete", input: { layerId: "missing" } },
        ],
      })
    ).rejects.toMatchObject({ commandIndex: 1 })
    expect(JSON.stringify(doc)).toBe(original)
    await expect(
      batchMutation({
        commands: [{ command: "projects.create", input: { document: doc } }],
      })
    ).rejects.toMatchObject({ commandIndex: 0 })
  })
  it("does not export missing resources", async () => {
    const result = await previewMutation("layers.addDevice", {
      document: createEmptyDocument(),
      url: PNG,
    })
    result.document.assets = {}
    await expect(
      exportProjectPackageFromDocument(result.document)
    ).rejects.toMatchObject({ code: "missing_asset" })
  })
})
describe("image boundary", () => {
  it("rejects fake MIME, truncated images and malformed base64", () => {
    for (const source of [
      "data:image/png;base64,aGVsbG8=",
      PNG.replace("image/png", "image/jpeg"),
      PNG.slice(0, -8),
      "data:image/png;base64,!!!!",
    ]) {
      expect(() => decodeImageDataUrl(source)).toThrow()
    }
    expect(decodeImageDataUrl(PNG).length).toBeGreaterThan(50)
  })
  it("recognizes short lossless WebP dimensions", () => {
    const bytes = new Uint8Array(26)
    bytes.set([
      82, 73, 70, 70, 18, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 76, 5, 0, 0, 0,
      47, 0, 0, 0, 0, 0,
    ])
    expect(imageSizeFromBytes(bytes)).toEqual({ width: 1, height: 1 })
  })
  it.each([
    "http://localhost:3010/x",
    "https://[::ffff:127.0.0.1]/x",
    "https://[::1]/x",
    "https://[fd00::1]/x",
    "https://10.0.0.1/x",
    "https://169.254.169.254/x",
    "https://user:pass@example.com/x",
  ])("blocks %s", (url) => {
    expect(() => assertAllowedAssetUrl(url)).toThrow()
  })
  it("only allows local assets in explicit development mode", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("POCKET_DRAFT_MCP_ALLOW_LOCAL_ASSETS", "true")
    expect(assertAllowedAssetUrl("http://localhost:3010/x").hostname).toBe(
      "localhost"
    )
    vi.stubEnv("NODE_ENV", "production")
    expect(() => assertAllowedAssetUrl("http://localhost:3010/x")).toThrow()
  })
  it("cancels oversized streaming bodies and aborted reads", async () => {
    const cancel = vi.fn()
    const response = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(MAX_ASSET_BYTES + 1))
        },
        cancel,
      })
    )
    await expect(
      readLimitedBody(response, new AbortController().signal)
    ).rejects.toThrow("8 MiB")
    expect(cancel).toHaveBeenCalled()
    const controller = new AbortController()
    const pending = readLimitedBody(
      new Response(new ReadableStream({ cancel })),
      controller.signal
    )
    controller.abort()
    await expect(pending).rejects.toThrow()
  })
  it("validates redirects and deduplicates URLs within a call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/x" },
      })
    )
    vi.stubGlobal("fetch", fetchMock)
    await expect(
      withCallContext(() => resolveAssetSource("https://example.com/x"), {
        publicFetch: true,
      })
    ).rejects.toThrow("not allowed")
    fetchMock.mockImplementation(
      async () => new Response(new Uint8Array(decodeImageDataUrl(PNG)))
    )
    fetchMock.mockClear()
    await withCallContext(
      async () => {
        await Promise.all([
          resolveAssetSource("https://example.com/x"),
          resolveAssetSource("https://example.com/x"),
        ])
      },
      { publicFetch: true }
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it("keeps URLs in reference mode and refuses changed images at export", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(decodeImageDataUrl(PNG))))
    )
    const result = await withCallContext(
      () =>
        batchMutation({
          commands: [
            { command: "projects.create", input: {} },
            {
              command: "layers.addDevice",
              input: { url: "https://example.com/x" },
            },
          ],
        }),
      { publicFetch: true, assetMode: "reference" }
    )
    const [ref] = Object.keys(result.document.assets)
    expect(result.document.assets[ref]).toBe("https://example.com/x")
    const bytes = decodeImageDataUrl(PNG)
    bytes[29] ^= 1
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(bytes)))
    )
    await expect(
      withCallContext(() => exportProjectPackageFromDocument(result.document), {
        publicFetch: true,
      })
    ).rejects.toMatchObject({ code: "asset_changed" })
  })
})
describe("editor import round trip", () => {
  it("creates, batches, attaches, exports and imports through real storage", async () => {
    const result = await batchMutation({
      commands: [
        { command: "projects.create", input: { name: "Integration" } },
        { command: "templates.apply", input: { templateId: "layout-classic" } },
        { command: "assets.attach", input: { url: PNG } },
      ],
    })
    const pkg = await exportProjectPackageFromDocument(result.document)
    const imported = await importProjectPackage(
      new File([JSON.stringify(pkg)], "test.pocketdraft")
    )
    expect(imported.project.id).not.toBe(pkg.project.id)
    expect(imported.project.canvases).toEqual(pkg.project.canvases)
    expect(await getAsset(Object.keys(pkg.assets)[0])).toBeInstanceOf(Blob)
    expect(
      (await listProjects()).some((p) => p.id === imported.project.id)
    ).toBe(true)
  })
  it("invalid import writes neither projects nor partial assets", async () => {
    const before = await listProjects()
    const doc = createEmptyDocument()
    await expect(
      importProjectPackage(
        new File(
          [
            JSON.stringify({
              type: "pocket-draft-project",
              version: 1,
              project: doc.project,
              assets: {
                "orphan.png": PNG,
                "bad.png": "data:image/png;base64,aGVsbG8=",
              },
            }),
          ],
          "bad.pocketdraft"
        )
      )
    ).rejects.toThrow()
    expect(await listProjects()).toEqual(before)
    expect(await getAsset("orphan.png")).toBeNull()
  })
})

describe("catalog compatibility", () => {
  it.each(TEMPLATES.map((t) => [t.id, t.kind] as const))(
    "validates generated %s",
    async (id, kind) => {
      const result = await previewMutation(
        kind === "set" ? "templates.applySet" : "templates.apply",
        { document: createEmptyDocument(), templateId: id, locale: "en" }
      )
      expect(() => parseDocument(result.document)).not.toThrow()
    }
  )
})
