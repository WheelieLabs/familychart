// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useRef, useState, type RefObject } from "react"
import PhotoCropModal from "@/components/PhotoCropModal"
import Button from "@/components/ui/Button"
import HiddenFileInput from "@/components/ui/HiddenFileInput"
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

  function handlePicked(file: File) {
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
      <div className="fc-photo-actions fc-photo-actions--phone">
        <Button
          variant="secondary"
          onClick={() => openPicker(cameraInputRef)}
          pending={uploading}
          pendingLabel="Uploading…"
        >
          Take Photo
        </Button>
        <Button
          variant="secondary"
          onClick={() => openPicker(libraryInputRef)}
          pending={uploading}
          pendingLabel="Uploading…"
        >
          Choose from Library
        </Button>
      </div>
      <div className="fc-photo-actions fc-photo-actions--desktop">
        <Button
          variant="secondary"
          onClick={() => openPicker(libraryInputRef)}
          pending={uploading}
          pendingLabel="Uploading…"
        >
          {hasPhoto ? "Change Photo" : "Upload Photo"}
        </Button>
      </div>

      <HiddenFileInput inputRef={cameraInputRef} accept="image/jpeg,image/png,image/webp" capture="environment" onFile={handlePicked} />
      <HiddenFileInput inputRef={libraryInputRef} accept="image/jpeg,image/png,image/webp" onFile={handlePicked} />

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
