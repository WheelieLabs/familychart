// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { rejectDemoImportProfanity } from "@/lib/demo/demo-profanity-guard"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { canWrite } from "@/lib/permissions"
import { importRecords, type ImportRecord } from "@/lib/spreadsheet-import"
import { logger } from "@/lib/logger"

const MAX_IMPORT_ROWS = 2000

export async function POST(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult

  const body = await request.json() as {
    person_id: number
    import_type?: "medications" | "observations" | "both"
    records: ImportRecord[]
  }
  const { person_id: personId, records } = body

  if (!personId || !records?.length) {
    return NextResponse.json({ error: "person_id and records are required" }, { status: 400 })
  }
  if (records.length > MAX_IMPORT_ROWS) {
    return NextResponse.json(
      { error: `Import exceeds maximum of ${MAX_IMPORT_ROWS} rows` },
      { status: 413 },
    )
  }

  // Authorise write before demo purgomalum fan-out so a denied person_id
  // cannot force outbound moderation requests.
  const db = getDb()
  const person = authorisePersonAccess(db, authResult, personId, "write")
  if (person instanceof NextResponse) return person

  const importProfanity = await rejectDemoImportProfanity(records)
  if (importProfanity) return importProfanity

  const userEmail = authResult.session.user?.email ?? null

  // Creating global medication catalogue rows requires the global readwrite+ role.
  // A personal-link / read-only writer (authorisePersonAccess passes via people.account_uid)
  // may import only against medications that already exist — it cannot inject new catalogue
  // entries visible to every person/caregiver.
  const canCreateCatalogue = canWrite(authResult.groups)

  let result
  try {
    result = importRecords(db, personId, records, userEmail, canCreateCatalogue)
  } catch (e) {
    logger.error("import_failed", {
      person_id: personId,
      err: e instanceof Error ? e.message : String(e),
    })
    return NextResponse.json(
      { error: "Import failed — all changes rolled back", detail: (e as Error).message },
      { status: 500 },
    )
  }

  auditLog(db, userEmail, "IMPORT", "medication_records", null, {
    person_id: personId,
    medication_records: result.imported,
    observations_created: result.observationsCreated,
    import_type: body.import_type ?? null,
    source: "spreadsheet_import",
  })
  logger.info("import_complete", {
    person_id: personId,
    medication_records: result.imported,
    observations_created: result.observationsCreated,
  })

  return NextResponse.json({
    imported: result.imported,
    observations_created: result.observationsCreated,
    errors: result.errors,
    person_name: person.name,
  })
}
