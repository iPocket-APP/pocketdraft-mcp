import catalogData from "@/lib/pocket-draft/catalog-data.json"

import type { Color, DeviceOrientation, Rect } from "@/lib/pocket-draft/models"
import { colorFromHex } from "@/lib/pocket-draft/models"

export type DeviceKind = "phone" | "tablet" | "mac" | "watch"

export type CornerRadii = {
  topLeading: number
  topTrailing: number
  bottomLeading: number
  bottomTrailing: number
}

export type ScreenGeometry = {
  frame: Rect
  cornerRadius: number
  imageAspectRatio: number
  cornerRadii?: CornerRadii
}

export type DeviceDefinition = {
  id: string
  name: string
  defaultFrameID: string
  portraitDisplayPixelSize: { width: number; height: number }
  portraitGeometry: ScreenGeometry
  landscapeGeometry: ScreenGeometry
}

export type FrameDefinition = {
  id: string
  deviceID: string
  name: string
  nameEn: string
  color: Color
  hex: string
}

const FRAME_NAME_EN: Record<string, string> = {
  "cosmic-orange": "Cosmic Orange",
  "deep-blue": "Deep Blue",
  silver: "Silver",
  burgundy: "Burgundy",
  glacier: "Glacier",
  "night-sky": "Night Sky",
  "star-white": "Star White",
  "mist-blue": "Mist Blue",
  black: "Black",
  white: "White",
  lavender: "Lavender",
  sage: "Sage",
  "cloud-white": "Cloud White",
  "sky-blue": "Sky Blue",
  "light-gold": "Light Gold",
  "space-black": "Space Black",
  "space-gray": "Space Gray",
  starlight: "Starlight",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
  yellow: "Yellow",
  dark: "Dark",
  light: "Light",
  "jet-black": "Jet Black",
  "rose-gold": "Rose Gold",
  "natural-titanium": "Natural Titanium",
  "black-titanium": "Black Titanium",
  "slate-titanium": "Slate Titanium",
  "gold-titanium": "Gold Titanium",
}

const devices = catalogData.devices as DeviceDefinition[]
const frames: FrameDefinition[] = catalogData.frames.map((frame) => ({
  id: frame.id,
  deviceID: frame.deviceID,
  name: frame.name,
  nameEn: FRAME_NAME_EN[frame.id] ?? frame.name,
  color: colorFromHex(frame.color),
  hex: frame.color,
}))

export const DEFAULT_DEVICE_ID = "iphone-18-pro-max"

export function isWatchDevice(deviceId: string): boolean {
  return deviceId.startsWith("apple-watch-")
}

export function isVectorDevice(deviceId: string): boolean {
  return deviceId === "macos-window"
}

export function isIPadDevice(deviceId: string): boolean {
  return deviceId.startsWith("ipad-")
}

export function deviceKind(deviceId: string): DeviceKind {
  if (isWatchDevice(deviceId)) return "watch"
  if (isIPadDevice(deviceId)) return "tablet"
  if (deviceId.startsWith("mac")) return "mac"
  return "phone"
}

export const DEVICE_KIND_ORDER: DeviceKind[] = [
  "phone",
  "tablet",
  "mac",
  "watch",
]

export function allDevices(): DeviceDefinition[] {
  return devices
}

export function getDevice(id: string): DeviceDefinition | undefined {
  return devices.find((device) => device.id === id)
}

export function framesForDevice(deviceId: string): FrameDefinition[] {
  return frames.filter((frame) => frame.deviceID === deviceId)
}

export function getFrame(
  deviceId: string,
  frameId: string
): FrameDefinition | undefined {
  return frames.find(
    (frame) => frame.deviceID === deviceId && frame.id === frameId
  )
}

export function defaultFrameId(deviceId: string): string {
  return getDevice(deviceId)?.defaultFrameID ?? "silver"
}

export function screenCornerRadii(
  geometry: ScreenGeometry,
  screenWidth: number
): [number, number, number, number] {
  const radii = geometry.cornerRadii
  if (!radii) {
    const radius = screenWidth * geometry.cornerRadius
    return [radius, radius, radius, radius]
  }
  return [
    screenWidth * radii.topLeading,
    screenWidth * radii.topTrailing,
    screenWidth * radii.bottomTrailing,
    screenWidth * radii.bottomLeading,
  ]
}

export function geometryFor(
  deviceId: string,
  orientation: DeviceOrientation
): ScreenGeometry {
  const device = getDevice(deviceId)
  const fallback: ScreenGeometry = {
    frame: { x: 0.05, y: 0.02, width: 0.9, height: 0.96 },
    cornerRadius: 0.1,
    imageAspectRatio: orientation === "portrait" ? 0.49 : 2.04,
  }
  if (!device) return fallback
  return orientation === "portrait"
    ? device.portraitGeometry
    : device.landscapeGeometry
}

export function frameAssetPath(
  deviceId: string,
  frameId: string,
  orientation: DeviceOrientation
): string {
  return `/device-frames/${deviceId}/${frameId}/${orientation}/frame.png`
}

export function thumbAssetPath(
  deviceId: string,
  frameId: string,
  orientation: DeviceOrientation = "portrait"
): string {
  return `/device-frames/${deviceId}/${frameId}/${orientation}/thumb.png`
}

export function frameCacheKey(
  deviceId: string,
  frameId: string,
  orientation: DeviceOrientation
): string {
  return `frame:${deviceId}:${frameId}:${orientation}`
}

export function orientationForSize(size: {
  width: number
  height: number
}): DeviceOrientation {
  return size.width > size.height ? "landscape" : "portrait"
}

export function frameLabel(frame: FrameDefinition, locale: string): string {
  return locale.startsWith("zh") ? frame.name : frame.nameEn
}
