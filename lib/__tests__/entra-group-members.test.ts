// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  listConfiguredEntraGroups,
  loadAccessControlMemberships,
} from "@/lib/entra-group-members"
import {
  __resetAppOnlyGraphTokenCacheForTests,
  __setAppOnlyGraphTokenAdapterForTests,
} from "@/lib/entra-graph-token"

describe("listConfiguredEntraGroups", () => {
  it("returns only set ENTRA_GROUP_* vars", () => {
    const groups = listConfiguredEntraGroups({
      ENTRA_GROUP_ADMIN: "aaa",
      ENTRA_GROUP_READONLY: "  bbb  ",
      ENTRA_GROUP_MANAGER: "",
    })
    expect(groups).toEqual([
      { role: "Admin", envVar: "ENTRA_GROUP_ADMIN", groupId: "aaa" },
      { role: "ReadOnly", envVar: "ENTRA_GROUP_READONLY", groupId: "bbb" },
    ])
  })
})

describe("loadAccessControlMemberships", () => {
  const originalClientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID
  const originalTenant = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID
  const originalSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET

  beforeEach(() => {
    __resetAppOnlyGraphTokenCacheForTests()
    __setAppOnlyGraphTokenAdapterForTests(null)
  })

  afterEach(() => {
    __setAppOnlyGraphTokenAdapterForTests(null)
    __resetAppOnlyGraphTokenCacheForTests()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    if (originalClientId === undefined) delete process.env.AUTH_MICROSOFT_ENTRA_ID_ID
    else process.env.AUTH_MICROSOFT_ENTRA_ID_ID = originalClientId
    if (originalTenant === undefined) delete process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID
    else process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID = originalTenant
    if (originalSecret === undefined) delete process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET
    else process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = originalSecret
  })

  it("reports no_groups_configured when env empty", async () => {
    const result = await loadAccessControlMemberships({})
    expect(result.status).toBe("no_groups_configured")
    expect(result.groups).toEqual([])
  })

  it("reports graph_not_configured when groups set but Graph env missing", async () => {
    delete process.env.AUTH_MICROSOFT_ENTRA_ID_ID
    delete process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID
    delete process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET
    const result = await loadAccessControlMemberships({
      ENTRA_GROUP_ADMIN: "group-oid",
    })
    expect(result.status).toBe("graph_not_configured")
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.groupId).toBe("group-oid")
  })

  it("lists members via Graph when a fake token adapter is injected", async () => {
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "client-id"
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = "client-secret"
    process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID = "tenant-id"
    __setAppOnlyGraphTokenAdapterForTests({
      getToken: async () => "fake-token",
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/oauth2/")) {
        throw new Error("token endpoint must not be called when adapter is injected")
      }
      if (url.includes("/groups/") && !url.includes("/members")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ displayName: "Admins" }),
        }
      }
      if (url.includes("/members")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            value: [
              {
                id: "user-1",
                displayName: "Alice",
                mail: "alice@example.com",
                "@odata.type": "#microsoft.graph.user",
              },
            ],
          }),
        }
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await loadAccessControlMemberships({
      ENTRA_GROUP_ADMIN: "group-oid",
    })
    expect(result.status).toBe("ok")
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]).toMatchObject({
      role: "Admin",
      groupId: "group-oid",
      groupDisplayName: "Admins",
      members: [
        {
          id: "user-1",
          displayName: "Alice",
          email: "alice@example.com",
          type: "user",
        },
      ],
    })
  })
})
