// SPDX-License-Identifier: AGPL-3.0-only

/** Mirrors the server-side guardrail in app/api/upload/route.ts — client-side check only. */
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024

export interface CropAreaPixels {
  x: number
  y: number
  width: number
  height: number
}

export interface CompressOptions {
  /** Longer edge of the output image, in pixels. */
  maxEdge: number
  /** JPEG quality, 0–1. */
  quality: number
}

/**
 * Crops `source` to `area` (a pixel rect in the source image's natural, EXIF-corrected
 * coordinates), downscales so its longer edge is at most `maxEdge`, and re-encodes as
 * JPEG at `quality`. EXIF orientation is baked into the output pixels via
 * createImageBitmap's default "from-image" handling.
 */
export async function cropAndCompressImage(
  source: Blob,
  area: CropAreaPixels,
  { maxEdge, quality }: CompressOptions,
): Promise<Blob> {
  const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" })
  try {
    const scale = Math.min(1, maxEdge / Math.max(area.width, area.height))
    const outWidth = Math.max(1, Math.round(area.width * scale))
    const outHeight = Math.max(1, Math.round(area.height * scale))

    const canvas = document.createElement("canvas")
    canvas.width = outWidth
    canvas.height = outHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas context unavailable")
    ctx.drawImage(bitmap, area.x, area.y, area.width, area.height, 0, 0, outWidth, outHeight)

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality))
    if (!blob) throw new Error("Image encoding failed")
    return blob
  } finally {
    bitmap.close()
  }
}
