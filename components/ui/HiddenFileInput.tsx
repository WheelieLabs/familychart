// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import type { ChangeEvent, RefObject } from "react"

/**
 * A file input with no visible control of its own, for a screen whose buttons open the picker (Take
 * photo, Choose from library). The visible buttons carry the accessible names, so the input itself is
 * left out of the page; open it with `inputRef.current?.click()`. Picking the same file twice works.
 */
export default function HiddenFileInput({
  inputRef,
  accept,
  capture,
  onFile,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  accept: string
  /** Opens the camera instead of the library on a phone. */
  capture?: "user" | "environment"
  onFile: (file: File) => void
}) {
  function handle(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (file) onFile(file)
  }
  return <input ref={inputRef} type="file" hidden accept={accept} capture={capture} onChange={handle} />
}
