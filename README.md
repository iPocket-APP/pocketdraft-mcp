# PocketDraft MCP

Control the PocketDraft browser editor from an MCP agent. Edits appear in the paired tab, remain editable by hand, and support Undo. No Chromium installation, native rendering library, browser automation or hosted MCP service is required.

## Install and connect

Requires Node.js 22 or later and an MCP client that supports stdio. Install the
versioned package from [GitHub Releases](https://github.com/iPocket-APP/pocketdraft-mcp/releases)
in a directory of your choice:

```sh
mkdir pocketdraft-agent
cd pocketdraft-agent
npm install https://github.com/iPocket-APP/pocketdraft-mcp/releases/download/v4.1.0/pocketdraft-mcp-4.1.0.tgz
```

Or build directly from source:

```sh
git clone https://github.com/iPocket-APP/pocketdraft-mcp.git
cd pocketdraft-mcp
npm ci
npm run check
npm pack
```

`npm ci` runs the `prepare` script to build `dist/index.mjs`. The generated tarball
can be installed elsewhere with `npm install /absolute/path/pocketdraft-mcp-4.1.0.tgz`.
This release is distributed through GitHub; it is not an npm registry publication.

Configure your MCP client using absolute paths:

```json
{
  "mcpServers": {
    "pocketdraft": {
      "command": "node",
      "args": [
        "/absolute/install/directory/node_modules/pocketdraft-mcp/dist/index.mjs",
        "--workspace", "/absolute/path/to/screenshots-and-exports"
      ]
    }
  }
}
```

The workspace directory must exist. Ask the agent to call `pocketdraft_connection`. Open https://tools.ipocket.xyz/zh/tools/pocket-draft (or the English editor), click **Connect MCP / 连接 MCP**, and paste the complete pairing code. If your browser requests local network access for this connection, allow it. Keep the page open. Use the same browser profile as your existing projects.

The code is scoped to one MCP process. One process pairs with one tab at a time; disconnect before pairing a different tab. Reloading or closing the page ends the connection. Reconnect explicitly; pairing credentials are not persisted. Multiple MCP processes use separate random loopback ports. Use `--port` only if a fixed port is necessary.

For a development editor, add `--origin http://localhost:3010`. Only that exact origin will be accepted. The default is `https://tools.ipocket.xyz`. Browsers or enterprise policies that block loopback access cannot use the bridge; run the local editor if permitted, rather than weakening browser security settings.

## Version compatibility

Version 4.1 uses bridge protocol 3 and requires the `app-store-assets` capability. Update the editor and this package together. Older editors/packages are rejected during pairing, before any project changes. Document/package formats remain unchanged. For local development use the matching editor checkout with `--origin http://localhost:3010`. The public website is deployed separately; publishing this repository or installing this package does not update the website. If pairing reports a version mismatch, update both the editor and package to a version with the `app-store-assets` capability.

## Tools

- `pocketdraft_connection`: connection state, pairing code, workspace, capabilities and recent operation IDs.
- `pocketdraft_list_catalog`, `pocketdraft_get_catalog`: templates, devices and styles.
- `pocketdraft_inspect_project`: latest project revision and history, filtered ordered layers with complete styles and browser-measured pixel geometry; optional full project. Existing image bytes do not cross the bridge, so inspecting/editing large browser projects is independent of package image limits.
- `pocketdraft_batch_mutation`: 35 typed commands, applied as one browser edit. Required `projectId` and `revision` come from inspect. A first `projects.create` or `projects.import` creates a new project instead of replacing the current one.
- `pocketdraft_attach_file`: local screenshot/image/background attachment, scoped to the workspace.
- `pocketdraft_preview`: browser-rendered preview, optionally cropped to a logical-pixel region and enlarged with `scale`, with `showBounds` overlays; returned as an MCP image.
- `pocketdraft_export`: one canvas as PNG/JPEG, optional panorama slices, or the whole editable `.pocketdraft` package. Use `canvasIds` for a selected set, `allCanvases: true` for a complete set, or `canvasId` for one canvas. The `manifest` maps every path to its canvas, slice and pixel dimensions. Packages always contain the full project. JPEG quality and PNG transparent backgrounds are configurable. Files are written to a new `exports/<id>/` directory, never overwritten.

- `pocketdraft_validate_project`: missing assets, out-of-canvas bounds, invalid crop and text-fit checks. Overlap alone is allowed. Optional `layoutSync` preflights an explicit synchronization without modifying the project.
- `pocketdraft_history`: guarded Undo/Redo. Pass `action`, the current project ID/revision, and the exact `entryId` from inspect history. Saves successfully before moving history.
- `pocketdraft_operation_status`: lookup an operation ID or list recent operations. A completed receipt can resolve a write whose final reply crossed a cancellation. Receipts live in process memory for up to ten minutes, bounded to 100 operations. Restarting the process loses them.

Command schemas and examples are exposed through `pocketdraft://schema/v1/commands/<command>` resources. Finish active text editing before asking the agent to change the project. After a revision conflict, inspect again and reconsider the requested edit. After a timeout or cancellation, inspect the operation status and project before retrying: a transaction may already have committed. Cancellation removes queued work, aborts requests/preparation/storage where possible and never blindly retries a write. Disconnection never triggers an automatic retry.

## Precision editing and migration from v3

Version 4 rejects wrong-kind properties, conflicting flat/nested content, unknown device frames, out-of-range numbers, locked mutations and incompatible requested sync targets. These previously could appear successful without fulfilling the request. Tool errors include command index, field paths, object ID where available, and a correction hint. Read-only catalog resources and document/package formats keep their existing IDs.

`inspect_project` supports `canvasIds`, `layerIds`, `kind`, `name`, `text`, and `exact`. Layer `index` increases from background to front. Geometry contains center, unrotated frame, rotated bounds, degrees and text layout; device crop offsets are also reported in logical pixels. Search only finds candidates: subsequent writes use IDs or batch-local aliases. Assets are listed once per reference.

All new placement/dimension/gap/crop offset inputs use **canvas logical pixels**; rotation commands use **degrees**. Legacy `layers.update.transform` retains normalized centers, unitless scale and radians. Legacy `screenshotOffset` retains screen-relative fractions. Text style values (fontSize, lineSpacing, kerning, boxWidth and effect padding) are unscaled local pixels. `layers.resize` scales the entire layer with its aspect ratio; `texts.reflow` changes wrapping without changing glyph size. `texts.fit` fits the unrotated box (including pill padding) with real browser fonts and preserves the copy. Align/distribute use rotated bounds including pills, excluding shadows.

Text creation and updates accept complete `stroke`, `shadow`, `pill` objects and spacing/width. Use `null` to clear an effect or explicit box width. `layers.duplicate` copies within/across canvases and returns a copy map; `canvases.duplicate` takes the source ID, and `canvases.reorder` takes every canvas ID exactly once. `assets.reuse` attaches an existing project asset by reference. Screenshot replacement preserves device position/size/orientation and resets crop; use `cropPolicy: "preserve"` explicitly to retain a valid crop. `devices.clearScreenshot` also resets crop.

Locked layers require a separate preceding unlock before editing content, moving/resizing, deleting or reordering. Visibility/lock-only updates remain allowed. `layout.sync` requires target IDs, supports explicit layer mapping and selective scope/fields, and fails the entire batch on any incompatible requested target. Its foreground style sync preserves target copy and assets; size/background follow their scope switches.

A composable batch (substitute the project ID/revision returned by inspect):

```json
{
  "projectId": "CURRENT_PROJECT_ID",
  "revision": "CURRENT_REVISION",
  "dryRun": true,
  "preview": { "showBounds": true },
  "commands": [
    { "command": "layers.addText", "as": "title", "input": { "string": "精细排版 PocketDraft", "fontName": "dm-sans", "fontSize": 60 } },
    { "command": "texts.fit", "input": { "layerId": { "ref": "title" }, "width": 600, "height": 160, "minFontSize": 24, "maxFontSize": 60, "maxLines": 2 } },
    { "command": "layers.move", "input": { "layerId": { "ref": "title" }, "dx": 0, "dy": -12 } }
  ]
}
```

`dryRun` uses the same validation, browser geometry, image collision checks and optional rendering without writing IndexedDB or history. Trial IDs are temporary. Re-run against the still-current revision with `dryRun: false` to commit. Each step reports created IDs, copy maps, affected objects and changed fields. Setting identical values returns `changed: false`; an entirely unchanged batch does not commit. The final committed summary/revision reflects the browser's saved state.

## Architecture and data

Agent → local stdio MCP → authenticated loopback HTTP bridge → paired web editor.

The browser is the project authority and retains normal IndexedDB auto-save. Routine snapshots transfer project structure and an image manifest. Edits send only newly attached/imported images. The browser validates and commits project, new assets and active selection in one IndexedDB transaction, then updates the visible editor and Undo history. Existing assets remain in the browser. A bounded image cache reuses renders within a paired session. Routine MCP responses contain summaries and structured results. Requested previews, text, and project details are returned to the agent and are subject to its provider's data handling. Local MCP does not upload projects to a hosted PocketDraft MCP service. Explicit remote asset URLs still require network access and retain the existing URL/image validation.

The website continues to provide editor code, fonts and frames, and performs image rendering. This is not a fully offline renderer. The installed package is independently runnable, but editing and rendering require a paired browser tab. Web and MCP versions must have compatible document schemas; an unsupported version fails validation.

## Website relationship

This repository contains the local MCP server and the shared PocketDraft
protocol/domain modules. It does not deploy an MCP endpoint or the editor website.
Edits and rendered previews appear in the explicitly paired browser tab. The
website and this package must be released with compatible bridge versions.

## Limits and diagnostics

New images support PNG/JPEG/GIF/WebP, up to 8 MiB each and 32 MiB per call. Editable packages use the same limits as import; export fails explicitly on missing/invalid/oversized assets. These package limits do not prevent inspecting or making text/layout edits to larger existing browser projects. Exports are published as complete directories; failed partial directories are removed.

The bridge binds only to 127.0.0.1 and requires the configured Origin, a random bearer token and session ID. File reads resolve workspace boundaries, reject directories and enforce bounded reads. Windows path containment is covered by tests; native Windows browser acceptance still needs platform testing.

Set `POCKETDRAFT_MCP_DEBUG=1` in your MCP client environment for JSON diagnostics on stderr (tool, duration and error code only). stdout remains MCP protocol output. The editor queue is bounded; local catalog/status reads bypass it. Late operation replies do not disconnect the session. Reloading/closing the editor still requires explicit re-pairing.

## App Store creative assets

Use `pocketdraft_list_catalog` with `entity: "aspects"` to discover `appStoreHeader`, `appStoreSearch`, `appStoreUniversal`, `appStoreEventCard`, and `appStoreEventDetails`. Each entry includes the allowed dimensions, formats, opacity requirements, official artwork safe area when available, and Apple source links. Canvas settings accept edges from 64 to 5244 pixels. Existing larger panorama projects can still be read.

Create with `projects.create` and an asset aspect, or change an existing canvas with `canvases.setAspect`. `templates.apply` supports `asset-blank-<aspect>` and `asset-hero-<aspect>` (header/search/universal). `templates.applySet` with `asset-event-pair` appends two matching image-only event canvases; it never overwrites existing canvases and needs two available slots. Hero and event-pair templates reuse the active canvas's image when available; blank templates clear the current canvas.

Header (3840×1646) and universal (5244×2950) exports require PNG at their exact size. Search (3:2), event card (16:9), and event detail (9:16) support PNG/JPEG within the catalog's resolution range; default canvases offer scales 0.5 and 1. Header/search/universal PNGs are encoded as RGB with no alpha channel. Full-image export rejects transparency for these placements, as well as cropped regions, debug bounds and panorama slices. Preview supports cropped regions without applying upload constraints. `pocketdraft_validate_project` reports dimensions as errors and text/device safe-area overflow as warnings. Successful `pocketdraft_export` results also include a `warnings` array for the selected canvases; composition warnings do not block file creation.

The browser and MCP use original images for final export; previews use bounded bitmaps. Files above the existing 32 MiB bridge export limit require the browser's local download. Fixed-size artwork is never silently downscaled. Project schema 2 and package version 1 remain unchanged. No App Store Connect upload or publication is performed.

## Development and release checks

```sh
npm ci
npm run check
npm run verify:package
```

The source is self-contained: no checkout of `ipocket-tools`, pnpm workspace,
Next.js, Chromium, fonts or native Canvas installation is needed to build the
server. The checked-in npm lockfile pins dependencies. `src/` contains the Node
stdio server, authenticated loopback bridge and workspace file handling.
`lib/pocket-draft/` contains the shared protocol, catalog, document/mutation logic
and browser helpers used by the compatibility regression tests. Runtime browser
rendering still happens in the paired website, not this Node process.

Tests cover the real stdio subprocess and simulated browser replies, bridge
authentication, cancellation, queue limits, workspace containment, strict
mutations, batch references, geometry operations, history and IndexedDB failure
handling. They do not replace visual acceptance against the matching live editor.
`verify:package` builds and packs an allowlisted tarball, installs it with production
dependencies in a temporary directory outside the checkout, and checks MCP
initialization, tool discovery, catalog access and disconnected-editor errors over
actual stdio. GitHub Actions runs both checks for pushes and pull requests.

Protocol/domain changes should be coordinated with the editor. Bump the shared
`LOCAL_MCP_VERSION` and `package.json` together; increase the bridge protocol when
compatibility changes. Do not add browser fallbacks that silently approximate
fonts or cropping in Node.

`.gitignore` excludes dependencies, build output, local credentials, editor
metadata, workspace assets, `.pocketdraft` projects, logs, tarballs and exports.
The npm `files` allowlist ships only the bundled executable, README and license
notices. Packaged releases are attached to GitHub Releases instead of committed
to source control.

## Third-party notices

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the adapted Goldie layouts
and separately installed dependencies.

## License

The original PocketDraft code currently reserves all rights; no open-source
license is granted. See [LICENSE](LICENSE). Third-party portions retain their
own notices and terms.
