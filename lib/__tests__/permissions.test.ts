import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  getUserRole,
  hasRole,
  canRead,
  canWrite,
  canManage,
  isAdmin,
  canReport,
  canReadForPerson,
  canWriteForPerson,
  hasAnyReadablePerson,
} from "@/lib/permissions"
import type { AppUser } from "@/lib/session"

// Minimal AppUser factory
function user(overrides: Partial<AppUser> = {}): AppUser {
  return { id: "local:1", name: "Test", email: "test@example.com", groups: [], ...overrides }
}

describe("getUserRole — local group strings", () => {
  it("returns 'admin' for local:admin", () => {
    expect(getUserRole(["local:admin"])).toBe("admin")
  })

  it("returns 'manager' for local:manage", () => {
    expect(getUserRole(["local:manage"])).toBe("manager")
  })

  it("returns 'readwrite' for local:write", () => {
    expect(getUserRole(["local:write"])).toBe("readwrite")
  })

  it("returns 'readonly' for local:read", () => {
    expect(getUserRole(["local:read"])).toBe("readonly")
  })

  it("returns null for an empty group list", () => {
    expect(getUserRole([])).toBeNull()
  })

  it("returns null for unrecognised groups", () => {
    expect(getUserRole(["some:other:group"])).toBeNull()
  })

  it("returns the highest role when multiple groups are present", () => {
    expect(getUserRole(["local:read", "local:admin"])).toBe("admin")
    expect(getUserRole(["local:read", "local:manage"])).toBe("manager")
  })
})

describe("getUserRole — Entra group IDs", () => {
  const ENV_VARS = {
    ENTRA_GROUP_ADMIN: "entra-admin-oid",
    ENTRA_GROUP_MANAGER: "entra-manager-oid",
    ENTRA_GROUP_READWRITE: "entra-rw-oid",
    ENTRA_GROUP_READONLY: "entra-ro-oid",
  }

  beforeEach(() => {
    Object.assign(process.env, ENV_VARS)
  })

  afterEach(() => {
    for (const key of Object.keys(ENV_VARS)) {
      delete process.env[key]
    }
  })

  it("maps Entra admin OID to admin role", () => {
    expect(getUserRole(["entra-admin-oid"])).toBe("admin")
  })

  it("maps Entra manager OID to manager role", () => {
    expect(getUserRole(["entra-manager-oid"])).toBe("manager")
  })

  it("returns null when Entra OID is not in any configured group", () => {
    expect(getUserRole(["unknown-oid"])).toBeNull()
  })
})

describe("hasRole / convenience predicates", () => {
  it("admin satisfies all role levels", () => {
    const groups = ["local:admin"]
    expect(isAdmin(groups)).toBe(true)
    expect(canManage(groups)).toBe(true)
    expect(canWrite(groups)).toBe(true)
    expect(canRead(groups)).toBe(true)
  })

  it("manager satisfies manage, write, read but not admin", () => {
    const groups = ["local:manage"]
    expect(isAdmin(groups)).toBe(false)
    expect(canManage(groups)).toBe(true)
    expect(canWrite(groups)).toBe(true)
    expect(canRead(groups)).toBe(true)
  })

  it("readwrite satisfies write and read but not manage", () => {
    const groups = ["local:write"]
    expect(canManage(groups)).toBe(false)
    expect(canWrite(groups)).toBe(true)
    expect(canRead(groups)).toBe(true)
  })

  it("readonly satisfies read only", () => {
    const groups = ["local:read"]
    expect(canWrite(groups)).toBe(false)
    expect(canRead(groups)).toBe(true)
  })

  it("empty groups satisfies nothing", () => {
    expect(canRead([])).toBe(false)
  })
})

describe("canReport", () => {
  it("returns true for local:report", () => {
    expect(canReport(["local:report"])).toBe(true)
  })

  it("returns true for local:admin (admin implies report)", () => {
    expect(canReport(["local:admin"])).toBe(true)
  })

  it("returns false for other local roles", () => {
    expect(canReport(["local:read"])).toBe(false)
    expect(canReport(["local:write"])).toBe(false)
  })
})

describe("canWriteForPerson", () => {
  it("grants access when the user has global canWrite role", () => {
    expect(canWriteForPerson(["local:write"], user(), "any-uid")).toBe(true)
  })

  it("grants access when the user's id matches the person's account_uid, regardless of role", () => {
    const u = user({ id: "local:5" })
    // personal link is sufficient even without any write role
    expect(canWriteForPerson([], u, "local:5")).toBe(true)
    expect(canWriteForPerson(["local:read"], u, "local:5")).toBe(true)
  })

  it("denies access when role is insufficient and uid does not match", () => {
    const u = user({ id: "local:5" })
    expect(canWriteForPerson([], u, "local:99")).toBe(false)
  })

  it("denies access when personUid is null", () => {
    expect(canWriteForPerson([], user({ id: "local:5" }), null)).toBe(false)
  })
})

describe("canReadForPerson", () => {
  it("grants access when the user has global canRead role", () => {
    expect(canReadForPerson(["local:read"], user(), "any-uid")).toBe(true)
  })

  it("grants access via personal link when global role is absent", () => {
    const u = user({ id: "local:5" })
    expect(canReadForPerson([], u, "local:5")).toBe(true)
  })

  it("denies access when neither role nor personal link matches", () => {
    const u = user({ id: "local:5" })
    expect(canReadForPerson([], u, "local:99")).toBe(false)
  })
})

describe("hasAnyReadablePerson", () => {
  it("allows global readers without scanning links", () => {
    expect(hasAnyReadablePerson([], ["local:read"], user())).toBe(true)
  })

  it("allows demoted sessions with a matching personal link", () => {
    const u = user({ id: "oid-abc" })
    expect(hasAnyReadablePerson([null, "oid-abc"], [], u)).toBe(true)
  })

  it("denies sessions with no group and no personal link", () => {
    const u = user({ id: "oid-abc" })
    expect(hasAnyReadablePerson([null, "other"], [], u)).toBe(false)
  })
})
