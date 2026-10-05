import {
  allDevices,
  framesForDevice,
  getDevice,
  getFrame,
  type DeviceDefinition,
  type FrameDefinition,
} from "@/lib/pocket-draft/catalog"
import { PRESET_FONTS } from "@/lib/pocket-draft/fonts"
import { GRADIENT_PRESETS } from "@/lib/pocket-draft/gradients"
import { GOLDIE_THEMES } from "@/lib/pocket-draft/goldie-layouts"
import {
  CANVAS_ASPECT_LABELS,
  CANVAS_ASPECT_SIZES,
  type CanvasAspect,
} from "@/lib/pocket-draft/models"
import { TEMPLATES } from "@/lib/pocket-draft/templates"

import { PocketDraftMcpError } from "@/lib/pocket-draft/mcp/errors"
import {
  CATALOG_ENTITIES,
  type CatalogEntity,
} from "@/lib/pocket-draft/mcp/protocol"

function matchesQuery(
  query: string | undefined,
  parts: Array<string | undefined>
): boolean {
  if (!query) return true
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return parts.some((part) => part?.toLowerCase().includes(needle))
}

function frameCatalogId(frame: FrameDefinition): string {
  return `${frame.deviceID}/${frame.id}`
}

function projectDevice(device: DeviceDefinition) {
  return {
    id: device.id,
    name: device.name,
    defaultFrameID: device.defaultFrameID,
    portraitDisplayPixelSize: device.portraitDisplayPixelSize,
  }
}

function projectFrame(frame: FrameDefinition) {
  return {
    id: frameCatalogId(frame),
    frameId: frame.id,
    deviceId: frame.deviceID,
    nameZh: frame.name,
    nameEn: frame.nameEn,
    hex: frame.hex,
  }
}

function projectTemplate(template: (typeof TEMPLATES)[number]) {
  return {
    id: template.id,
    nameZh: template.nameZh,
    nameEn: template.nameEn,
    descriptionZh: template.descriptionZh,
    descriptionEn: template.descriptionEn,
    kind: template.kind ?? "layout",
    platform: template.platform ?? "ios",
    deviceCount: template.deviceCount,
    canvasAspect: template.canvasAspect,
    layoutKey: template.layoutKey ?? null,
    macLayoutKey: template.macLayoutKey ?? null,
    sequence: template.sequence ?? template.macSequence ?? null,
  }
}

export function listCatalog(
  entity: CatalogEntity,
  options?: { query?: string; platform?: "ios" | "macos" }
): unknown[] {
  switch (entity) {
    case "devices":
      return allDevices()
        .filter((device) =>
          matchesQuery(options?.query, [device.id, device.name])
        )
        .map(projectDevice)
    case "frames":
      return allDevices()
        .flatMap((device) => framesForDevice(device.id))
        .filter((frame) =>
          matchesQuery(options?.query, [
            frame.id,
            frame.deviceID,
            frame.name,
            frame.nameEn,
          ])
        )
        .map(projectFrame)
    case "templates":
      return TEMPLATES.filter((template) => {
        if (
          options?.platform &&
          (template.platform ?? "ios") !== options.platform
        ) {
          return false
        }
        return matchesQuery(options?.query, [
          template.id,
          template.nameZh,
          template.nameEn,
          template.layoutKey,
          template.macLayoutKey,
        ])
      }).map(projectTemplate)
    case "fonts":
      return PRESET_FONTS.filter((font) =>
        matchesQuery(options?.query, [
          font.id,
          font.nameZh,
          font.nameEn,
          font.category,
        ])
      ).map((font) => ({
        id: font.id,
        nameZh: font.nameZh,
        nameEn: font.nameEn,
        category: font.category,
        languages: font.languages,
        bundled: Boolean(font.bundled),
      }))
    case "aspects":
      return (Object.keys(CANVAS_ASPECT_LABELS) as CanvasAspect[])
        .filter((aspect) =>
          matchesQuery(options?.query, [aspect, CANVAS_ASPECT_LABELS[aspect]])
        )
        .map((aspect) => ({
          id: aspect,
          label: CANVAS_ASPECT_LABELS[aspect],
          size: aspect === "custom" ? null : CANVAS_ASPECT_SIZES[aspect],
        }))
    case "themes":
      return Object.values(GOLDIE_THEMES)
        .filter((theme) =>
          matchesQuery(options?.query, [theme.id, theme.nameZh, theme.nameEn])
        )
        .map((theme) => ({
          id: theme.id,
          nameZh: theme.nameZh,
          nameEn: theme.nameEn,
          isDark: theme.isDark,
        }))
    case "gradients":
      return GRADIENT_PRESETS.filter((preset) =>
        matchesQuery(options?.query, [
          preset.id,
          preset.nameZh,
          preset.nameEn,
          preset.category,
        ])
      ).map((preset) => ({
        id: preset.id,
        nameZh: preset.nameZh,
        nameEn: preset.nameEn,
        category: preset.category,
        kind: preset.kind,
        angle: preset.angle,
        stops: preset.stops,
      }))
  }
}

export function getCatalog(entity: CatalogEntity, id: string): unknown {
  switch (entity) {
    case "devices": {
      const device = getDevice(id)
      if (!device) {
        throw new PocketDraftMcpError("not_found", `Unknown device: ${id}`)
      }
      return {
        ...projectDevice(device),
        portraitGeometry: device.portraitGeometry,
        landscapeGeometry: device.landscapeGeometry,
        frames: framesForDevice(device.id).map(projectFrame),
      }
    }
    case "frames": {
      const [deviceId, frameId] = id.includes("/")
        ? id.split("/")
        : [undefined, id]
      if (!deviceId || !frameId) {
        throw new PocketDraftMcpError(
          "invalid_input",
          "Frame id must be deviceId/frameId."
        )
      }
      const frame = getFrame(deviceId, frameId)
      if (!frame) {
        throw new PocketDraftMcpError("not_found", `Unknown frame: ${id}`)
      }
      return projectFrame(frame)
    }
    case "templates": {
      const template = TEMPLATES.find((item) => item.id === id)
      if (!template) {
        throw new PocketDraftMcpError("not_found", `Unknown template: ${id}`)
      }
      return projectTemplate(template)
    }
    case "fonts": {
      const font = PRESET_FONTS.find((item) => item.id === id)
      if (!font) {
        throw new PocketDraftMcpError("not_found", `Unknown font: ${id}`)
      }
      return {
        id: font.id,
        nameZh: font.nameZh,
        nameEn: font.nameEn,
        category: font.category,
        languages: font.languages,
        bundled: Boolean(font.bundled),
        css: font.css,
      }
    }
    case "aspects": {
      if (!(id in CANVAS_ASPECT_LABELS)) {
        throw new PocketDraftMcpError("not_found", `Unknown aspect: ${id}`)
      }
      const aspect = id as CanvasAspect
      return {
        id: aspect,
        label: CANVAS_ASPECT_LABELS[aspect],
        size: aspect === "custom" ? null : CANVAS_ASPECT_SIZES[aspect],
      }
    }
    case "themes": {
      const theme = GOLDIE_THEMES[id as keyof typeof GOLDIE_THEMES]
      if (!theme) {
        throw new PocketDraftMcpError("not_found", `Unknown theme: ${id}`)
      }
      return {
        id: theme.id,
        nameZh: theme.nameZh,
        nameEn: theme.nameEn,
        isDark: theme.isDark,
        background: theme.background,
        headlineColor: theme.headlineColor,
        subheadColor: theme.subheadColor,
      }
    }
    case "gradients": {
      const preset = GRADIENT_PRESETS.find((item) => item.id === id)
      if (!preset) {
        throw new PocketDraftMcpError("not_found", `Unknown gradient: ${id}`)
      }
      return preset
    }
  }
}

export function parseCatalogEntity(value: unknown): CatalogEntity {
  if (
    typeof value === "string" &&
    (CATALOG_ENTITIES as readonly string[]).includes(value)
  ) {
    return value as CatalogEntity
  }
  throw new PocketDraftMcpError(
    "invalid_input",
    `entity must be one of: ${CATALOG_ENTITIES.join(", ")}`
  )
}
