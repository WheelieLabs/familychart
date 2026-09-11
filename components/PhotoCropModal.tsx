// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useState } from "react"
import Cropper, { type Area, type Point } from "react-easy-crop"
import Modal from "@/components/Modal"
import { cropAndCompressImage, UPLOAD_MAX_BYTES, type CompressOptions } from "@/lib/photo-pipeline"

interface PhotoCropModalProps extends CompressOptions {
  /** The raw picked image, before cropping. Modal is open whenever this is non-null. */
  image: Blob | null
  imageSrc: string | null
  /** Fixed crop aspect ratio (width / height) — 1 for a square avatar. */
  aspect: number
  onCancel: () => void
  /** Cropped, compressed, ready-to-upload image. Consumer performs the actual upload. */
  onComplete: (blob: Blob) => void
}

/**
 * Reusable crop + compress step of the photo pipeline: fixed-aspect crop UI over
 * react-easy-crop, then downscale/re-encode via cropAndCompressImage. The pick step
 * (camera / library / desktop file input) is left to the consumer.
 */
export default function PhotoCropModal({
  image,
  imageSrc,
  aspect,
  maxEdge,
  quality,
  onCancel,
  onComplete,
}: PhotoCropModalProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = image != null && imageSrc != null

  function reset() {
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setCroppedAreaPixels(null)
    setPreparing(false)
    setError(null)
  }

  function handleCancel() {
    reset()
    onCancel()
  }

  async function handleUsePhoto() {
    if (!image || !croppedAreaPixels) return
    setError(null)
    setPreparing(true)
    try {
      const blob = await cropAndCompressImage(image, croppedAreaPixels, { maxEdge, quality })
      if (blob.size > UPLOAD_MAX_BYTES) {
        setError("Photo is still too large after compression. Try a tighter crop.")
        return
      }
      reset()
      onComplete(blob)
    } catch {
      setError("Couldn't prepare that photo. Please try again.")
    } finally {
      setPreparing(false)
    }
  }

  return (
    <Modal open={open} onClose={handleCancel} title="Crop photo">
      {image != null && imageSrc != null && (
        <>
          <div className="relative w-full aspect-square bg-black/80 rounded-xl overflow-hidden">
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_area, pixels) => setCroppedAreaPixels(pixels)}
            />
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex gap-3">
            <button type="button" onClick={handleCancel} disabled={preparing}
              className="flex-1 border border-gray-400 rounded-xl py-3 text-gray-700 font-bold disabled:opacity-50">
              Cancel
            </button>
            <button type="button" onClick={handleUsePhoto} disabled={preparing || !croppedAreaPixels}
              className="flex-1 bg-fc-blue text-white font-bold rounded-xl py-3 disabled:opacity-50">
              {preparing ? "Preparing…" : "Use Photo"}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
