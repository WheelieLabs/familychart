// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useRef, useState, type RefObject } from "react"
import PhotoCropModal from "@/components/PhotoCropModal"
import { markAppLockSuppressed } from "@/lib/app-lock-navigation"
import type { CompressOptions } from "@/lib/photo-pipeline"

interface PersonPhotoCaptureProps extends CompressOptions {
  /** Fixed crop aspect ratio (width / height) — 1 for a square avatar. */
  aspect: number
  uploading: boolean
  /** Whether a photo is already set, for the desktop button label. */
  hasPhoto: boolean
  /** Cropped, compressed, ready-to-upload image. Consumer performs the actual upload. */
  onPhoto: (blob: Blob) => void | Promise<void>
}

/**
 * Take Photo / Choose from Library buttons (mobile) or a single picker (desktop), wired to the
 * shared crop + compress pipeline. Marks AppLock as suppressed before opening the native
 * camera/file picker — backgrounding the tab for that isn't the user leaving the app, and
 * AppLock would otherwise discard the in-progress photo and bounce the user home.
 */
export default function PersonPhotoCapture({
  aspect,
  maxEdge,
  quality,
  uploading,
  hasPhoto,
  onPhoto,
}: PersonPhotoCaptureProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)
  const [pickedImage, setPickedImage] = useState<File | null>(null)
  const [pickedImageSrc, setPickedImageSrc] = useState<string | null>(null)

  useEffect(() => {
    return () => { if (pickedImageSrc) URL.revokeObjectURL(pickedImageSrc) }
  }, [pickedImageSrc])

  function openPicker(ref: RefObject<HTMLInputElement | null>) {
    markAppLockSuppressed(sessionStorage)
    ref.current?.click()
  }

  function handlePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setPickedImage(file)
    setPickedImageSrc(URL.createObjectURL(file))
  }

  async function handleCropped(blob: Blob) {
    setPickedImage(null)
    setPickedImageSrc(null)
    await onPhoto(blob)
  }

  return (
    <>
      <div className="flex gap-2 lg:hidden">
        <button type="button" onClick={() => openPicker(cameraInputRef)} disabled={uploading}
          className="flex-1 bg-fc-blue text-white text-sm font-bold px-4 py-2 rounded-lg
                     hover:bg-fc-blue-mid disabled:opacity-50 transition-colors">
          {uploading ? "Uploading…" : "Take Photo"}
        </button>
        <button type="button" onClick={() => openPicker(libraryInputRef)} disabled={uploading}
          className="flex-1 bg-fc-blue text-white text-sm font-bold px-4 py-2 rounded-lg
                     hover:bg-fc-blue-mid disabled:opacity-50 transition-colors">
          {uploading ? "Uploading…" : "Choose from Library"}
        </button>
      </div>
      <button type="button" onClick={() => openPicker(libraryInputRef)} disabled={uploading}
        className="hidden lg:inline-flex bg-fc-blue text-white text-sm font-bold px-4 py-2 rounded-lg
                   hover:bg-fc-blue-mid disabled:opacity-50 transition-colors">
        {uploading ? "Uploading…" : hasPhoto ? "Change Photo" : "Upload Photo"}
      </button>

      <input ref={cameraInputRef} type="file" accept="image/jpeg,image/png,image/webp"
        capture="environment" className="hidden" onChange={handlePicked} />
      <input ref={libraryInputRef} type="file" accept="image/jpeg,image/png,image/webp"
        className="hidden" onChange={handlePicked} />

      <PhotoCropModal
        image={pickedImage}
        imageSrc={pickedImageSrc}
        aspect={aspect}
        maxEdge={maxEdge}
        quality={quality}
        onCancel={() => { setPickedImage(null); setPickedImageSrc(null) }}
        onComplete={handleCropped}
      />
    </>
  )
}
