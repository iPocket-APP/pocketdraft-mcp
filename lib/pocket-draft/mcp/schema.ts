import { COMMAND_RULES } from "./commands"
import {
  LOCAL_MCP_TOOLS,
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_CAPABILITIES,
} from "../bridge-protocol"
import {
  MAXIMUM_CANVAS_COUNT,
  MAXIMUM_DEVICE_COPIES,
  MAXIMUM_LAYER_COUNT,
  CANVAS_DIMENSION_RANGE,
} from "@/lib/pocket-draft/models"

import {
  CATALOG_ENTITIES,
  MAX_ASSET_BYTES,
  MAX_PACKAGE_ASSET_BYTES,
  MUTATION_COMMANDS,
  POCKETDRAFT_MCP_PROTOCOL_VERSION,
  SCHEMA_RESOURCE_URI,
} from "@/lib/pocket-draft/mcp/protocol"

export const POCKETDRAFT_SCHEMA_V1 = {
  uri: SCHEMA_RESOURCE_URI,
  protocolVersion: POCKETDRAFT_MCP_PROTOCOL_VERSION,
  tools: [...LOCAL_MCP_TOOLS],
  bridge: {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    capabilities: BRIDGE_CAPABILITIES,
  },
  catalogEntities: [...CATALOG_ENTITIES],
  limits: {
    canvases: MAXIMUM_CANVAS_COUNT,
    layers: MAXIMUM_LAYER_COUNT,
    deviceCopies: MAXIMUM_DEVICE_COPIES,
    canvasDimensions: CANVAS_DIMENSION_RANGE,
    maxBatchCommands: 50,
    maxAssetBytes: MAX_ASSET_BYTES,
    maxPackageAssetBytes: MAX_PACKAGE_ASSET_BYTES,
  },
  document: {
    schemaVersion: 1,
    description:
      "The paired browser owns the working project and IndexedDB. Inspect returns its revision and an asset manifest. Only newly attached assets are transmitted during edits.",
    fields: {
      schemaVersion: 1,
      project: "PocketDraft Project (schemaVersion 2)",
      assets: "Map of assetRef to a data URL or https URL",
    },
  },
  mutations: {
    description:
      "pocketdraft_batch_mutation applies commands as one durable browser edit. Writes require the exact projectId and revision returned by inspect. Cancellation is best effort once the storage transaction commits.",
    commands: [...MUTATION_COMMANDS],
    rules: COMMAND_RULES,
    input: {
      schemaVersion: 1,
      projectId: "Current paired project ID",
      revision: "Exact 64-character revision from inspect",
      dryRun:
        "Validate and compute without storing or adding history; optional preview renders the candidate",
      commands:
        "1–50 {command,input,as?} steps, with schemas/examples generated from the command registry",
    },
    notes: {
      "templates.apply":
        "Applies a single-layout template to canvasId or the active canvas.",
      "templates.applySet":
        "Requires a set template. Screenshot sets create missing canvases; asset-event-pair appends two new canvases and requires two free slots.",
      "assets.attach":
        "target: screenshot (default), image, or background. url may be https or a data URL.",
      "layers.update":
        "Patch name, opacity, isVisible, isLocked, transform, and kind-specific content fields. Background cannot be deleted.",
      "layout.sync":
        "Explicit targets, optional layer mapping, selective scope and fields. Any incompatible target fails the complete batch.",
    },
  },
  export: {
    type: "pocket-draft-project",
    version: 1,
    description:
      "pocketdraft_export with kind=package validates all referenced images and creates an importable package. PNG/JPEG rendering runs in the browser.",
  },
  assets: {
    formats: ["png", "jpeg", "gif", "webp"],
    referenceMode:
      "Validated URL retained in document; export checks content hash. No server storage.",
    allowed: [
      "https URLs",
      "data URLs",
      "http://localhost only with development opt-in",
    ],
    blocked: ["private/link-local IP hosts", "credentials in URLs"],
  },
} as const
