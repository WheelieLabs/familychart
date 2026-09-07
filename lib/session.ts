// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared session types used across all server components and API routes.
 * Using explicit interfaces and casting rather than module augmentation
 * avoids TypeScript declaration merging issues with next-auth beta.
 */

export interface AppUser {
  id?: string
  /** Microsoft Entra directory Object ID (`oid`); `sub` stays in `id`. */
  entraOid?: string | null
  name?: string | null
  email?: string | null
  image?: string | null
  groups?: string[]
}

export interface AppSession {
  user?: AppUser
  expires: string
}
