/**
 * Goldie OFL typefaces served from /pocket-draft/fonts.
 * Canvas 2D needs a real family name, so these are declared with @font-face
 * rather than next/font (which hashes the family).
 */

export type BundledFontFace = {
  family: string
  weight: number
  file: string
}

export const BUNDLED_FONT_FILES: BundledFontFace[] = [
  { family: "DM Mono", weight: 400, file: "DMMono-400.ttf" },
  { family: "DM Mono", weight: 500, file: "DMMono-500.ttf" },
  { family: "DM Sans", weight: 400, file: "DMSans-400.ttf" },
  { family: "DM Sans", weight: 700, file: "DMSans-700.ttf" },
  { family: "Lato", weight: 400, file: "Lato-400.ttf" },
  { family: "Lato", weight: 700, file: "Lato-700.ttf" },
  { family: "Merriweather", weight: 400, file: "Merriweather-400.ttf" },
  { family: "Merriweather", weight: 700, file: "Merriweather-700.ttf" },
  { family: "Montserrat", weight: 400, file: "Montserrat-400.ttf" },
  { family: "Montserrat", weight: 700, file: "Montserrat-700.ttf" },
]

export const BUNDLED_FONT_FACE_CSS = BUNDLED_FONT_FILES.map(
  (font) => `@font-face {
  font-family: "${font.family}";
  src: url("/pocket-draft/fonts/${font.file}") format("truetype");
  font-weight: ${font.weight};
  font-style: normal;
  font-display: swap;
}`
).join("\n")

let loadPromise: Promise<void> | null = null

/** Load every bundled cut so canvas measureText / fillText see real glyphs. */
export function ensurePocketDraftFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) {
    return Promise.resolve()
  }
  if (!loadPromise) {
    loadPromise = Promise.all(
      BUNDLED_FONT_FILES.map((font) =>
        document.fonts.load(`${font.weight} 64px "${font.family}"`)
      )
    )
      .then(() => undefined)
      .catch((error) => {
        loadPromise = null
        throw error
      })
  }
  return loadPromise
}
