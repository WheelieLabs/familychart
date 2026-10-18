// SPDX-License-Identifier: AGPL-3.0-only

/** One level in a page's trail: a link (`href`), an in-page step (`onClick`) or, last, the current page. */
export interface Crumb {
  label: string
  href?: string
  onClick?: () => void
}

const HOME_CRUMB: Crumb = { label: "Home", href: "/" }
const MANAGEMENT_CRUMB: Crumb = { label: "Management", href: "/management" }
const ADMINISTRATION_CRUMB: Crumb = { label: "Administration", href: "/admin/overview" }
const DIAGNOSTICS_CRUMB: Crumb = { label: "Diagnostics", href: "/diagnostics" }

/** The person hub: Home › Name. */
export function personHubTrail(name: string): Crumb[] {
  return [HOME_CRUMB, { label: name }]
}

/** A person's page under the hub: Name › Page, with any deeper steps after it. */
export function personTrail(personId: number | string, name: string, ...rest: Crumb[]): Crumb[] {
  return [{ label: name?.trim() || "Person", href: `/${personId}` }, ...rest]
}

export function managementTrail(...rest: Crumb[]): Crumb[] {
  return [MANAGEMENT_CRUMB, ...rest]
}

export function administrationTrail(...rest: Crumb[]): Crumb[] {
  return [ADMINISTRATION_CRUMB, ...rest]
}

export function diagnosticsTrail(...rest: Crumb[]): Crumb[] {
  return [DIAGNOSTICS_CRUMB, ...rest]
}
