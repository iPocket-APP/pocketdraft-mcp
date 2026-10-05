export const POCKETDRAFT_MCP_NAME = "pocketdraft"
export const POCKETDRAFT_MCP_PROTOCOL_VERSION = 1
export const SCHEMA_RESOURCE_URI = "pocketdraft://schema/v1"

export const CATALOG_ENTITIES = [
  "devices",
  "frames",
  "templates",
  "fonts",
  "aspects",
  "themes",
  "gradients",
] as const

export type CatalogEntity = (typeof CATALOG_ENTITIES)[number]

export const MUTATION_COMMANDS = [
  "projects.create",
  "projects.rename",
  "projects.import",
  "canvases.add",
  "canvases.delete",
  "canvases.rename",
  "canvases.switch",
  "canvases.setAspect",
  "templates.apply",
  "templates.applySet",
  "layers.addDevice",
  "layers.addText",
  "layers.addImage",
  "layers.update",
  "layers.delete",
  "layers.reorder",
  "layers.setBackground",
  "layers.setDevicePadding",
  "assets.attach",
  "layout.sync",
  "canvases.duplicate",
  "canvases.reorder",
  "layers.duplicate",
  "assets.reuse",
  "devices.clearScreenshot",
  "devices.setCrop",
  "devices.resetCrop",
  "layers.move",
  "layers.position",
  "layers.resize",
  "layers.rotate",
  "layers.align",
  "layers.distribute",
  "texts.reflow",
  "texts.fit",
] as const

export type MutationCommand = (typeof MUTATION_COMMANDS)[number]

export const MAX_ASSET_BYTES = 8 * 1024 * 1024
export const MAX_PACKAGE_ASSET_BYTES = 32 * 1024 * 1024

export const MAX_REQUEST_BYTES = 48 * 1024 * 1024
