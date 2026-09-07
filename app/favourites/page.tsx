// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import ConfirmModal from "@/components/ConfirmModal"
import type { Person, ObservationTypeConfig, FavouriteResolved } from "@/lib/domain-types"
import { fractionalAgeYears } from "@/lib/person/person-age"
import { mainContentTargetProps } from "@/lib/a11y"

interface MedCatalogResult {
  id: number
  name: string
  default_dosage: number | null
  dosage_unit: string
}

interface ConfirmDlg {
  title: string
  message: string
  variant: "danger" | "warning" | "primary"
  onConfirm: () => Promise<void>
}

function personInitials(name: string): string {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
}

function derivedLabel(fav: FavouriteResolved): string {
  if (fav.label) return fav.label
  const p = fav.person_name ?? "Unknown"
  const a =
    fav.action_kind === "medication"
      ? (fav.medication_name ?? "Unknown medication")
      : (fav.observation_type ?? "Unknown observation")
  return `${p} · ${a}`
}

const inputClass =
  "w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-800 text-sm"

const primaryBtnClass =
  "bg-fc-blue text-white font-bold px-4 py-2 rounded-lg " +
  "hover:bg-fc-blue-mid active:bg-fc-blue-dark disabled:opacity-50 transition-colors text-sm"

const outlineBtnClass =
  "border border-gray-300 bg-white text-gray-700 font-bold px-4 py-2 rounded-lg " +
  "hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50 transition-colors text-sm"

export default function FavouritesPage() {
  const [people, setPeople] = useState<Person[]>([])
  const [obsConfigs, setObsConfigs] = useState<ObservationTypeConfig[]>([])
  const [favourites, setFavourites] = useState<FavouriteResolved[]>([])
  const [loadingFavs, setLoadingFavs] = useState(true)

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null)
  const [selectedKind, setSelectedKind] = useState<"medication" | "observation" | null>(null)
  const [medQuery, setMedQuery] = useState("")
  const [medSuggestions, setMedSuggestions] = useState<MedCatalogResult[]>([])
  const [showMedSuggestions, setShowMedSuggestions] = useState(false)
  const [loadingMedSearch, setLoadingMedSearch] = useState(false)
  const [selectedMedCatalog, setSelectedMedCatalog] = useState<MedCatalogResult | null>(null)
  const [selectedObsType, setSelectedObsType] = useState<string | null>(null)
  const [createLabel, setCreateLabel] = useState("")
  const [createDefaultValue, setCreateDefaultValue] = useState("")
  const [createError, setCreateError] = useState("")
  const [createSaving, setCreateSaving] = useState(false)

  // Edit
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editLabel, setEditLabel] = useState("")
  const [editDefaultValue, setEditDefaultValue] = useState("")
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState("")

  // Reorder
  const [reordering, setReordering] = useState(false)

  // Delete confirm
  const [confirmDlg, setConfirmDlg] = useState<ConfirmDlg | null>(null)
  const [instanceTimezone, setInstanceTimezone] = useState<string | null>(null)

  const loadFavourites = useCallback(async () => {
    setLoadingFavs(true)
    try {
      const res = await fetch("/api/favourites")
      if (res.ok) setFavourites(await res.json())
    } finally {
      setLoadingFavs(false)
    }
  }, [])

  useEffect(() => {
    void loadFavourites()
    fetch("/api/people")
      .then(r => r.ok ? r.json() : [])
      .then((rows: Person[]) => setPeople(rows))
      .catch(() => {})
    fetch("/api/observation-type-config")
      .then(r => r.ok ? r.json() : [])
      .then((rows: ObservationTypeConfig[]) => setObsConfigs(rows))
      .catch(() => {})
    fetch("/api/me")
      .then(r => (r.ok ? r.json() : null))
      .then((me: { instanceTimezone?: string } | null) => {
        if (typeof me?.instanceTimezone === "string" && me.instanceTimezone.trim() !== "") {
          setInstanceTimezone(me.instanceTimezone)
        }
      })
      .catch(() => {})
  }, [loadFavourites])

  function clearKindDependentState() {
    setSelectedMedCatalog(null)
    setMedQuery("")
    setMedSuggestions([])
    setSelectedObsType(null)
    setCreateDefaultValue("")
  }

  function clearPersonDependentState() {
    setSelectedKind(null)
    clearKindDependentState()
    setCreateLabel("")
    setCreateError("")
  }

  function selectPerson(person: Person) {
    if (selectedPerson?.id === person.id) {
      setSelectedPerson(null)
      clearPersonDependentState()
    } else {
      setSelectedPerson(person)
      clearPersonDependentState()
    }
  }

  function selectKind(kind: "medication" | "observation") {
    if (selectedKind === kind) {
      setSelectedKind(null)
      clearKindDependentState()
    } else {
      setSelectedKind(kind)
      clearKindDependentState()
    }
  }

  // Debounced medication search — same source (/api/medications?q=&person_id=) as record-medication
  useEffect(() => {
    if (selectedKind !== "medication" || !selectedPerson) return
    const q = medQuery.trim()
    if (q.length < 1) {
      setMedSuggestions([])
      setShowMedSuggestions(false)
      return
    }
    if (selectedMedCatalog && q === selectedMedCatalog.name.trim()) return
    setShowMedSuggestions(true)
    const t = setTimeout(() => {
      setLoadingMedSearch(true)
      fetch(`/api/medications?q=${encodeURIComponent(q)}&person_id=${selectedPerson.id}`)
        .then(r => r.ok ? r.json() : [])
        .then((list: unknown) => { if (Array.isArray(list)) setMedSuggestions(list as MedCatalogResult[]) })
        .catch(() => setMedSuggestions([]))
        .finally(() => setLoadingMedSearch(false))
    }, 200)
    return () => clearTimeout(t)
  }, [medQuery, selectedKind, selectedPerson, selectedMedCatalog])

  // Age-filtered observation types — mirrors record-observation/page.tsx exactly
  const personAgeYears = useMemo(() => {
    if (!selectedPerson?.date_of_birth || !instanceTimezone) return null
    const age = fractionalAgeYears(selectedPerson.date_of_birth, instanceTimezone)
    return Number.isFinite(age) ? age : null
  }, [selectedPerson, instanceTimezone])

  const availableObsConfigs = useMemo(
    () =>
      obsConfigs.filter(
        cfg =>
          cfg.is_active !== 0 &&
          (cfg.max_age_years == null || personAgeYears == null || personAgeYears <= cfg.max_age_years)
      ),
    [obsConfigs, personAgeYears]
  )

  // Live preview label during create
  const createPreviewLabel = useMemo(() => {
    if (!selectedPerson) return ""
    const personPart = selectedPerson.name
    let actionPart = ""
    if (selectedKind === "medication" && selectedMedCatalog) {
      actionPart = selectedMedCatalog.name
    } else if (selectedKind === "observation" && selectedObsType) {
      actionPart = selectedObsType
    }
    if (!actionPart) return ""
    return createLabel.trim() || `${personPart} · ${actionPart}`
  }, [selectedPerson, selectedKind, selectedMedCatalog, selectedObsType, createLabel])

  function resetCreate() {
    setShowCreate(false)
    setSelectedPerson(null)
    setSelectedKind(null)
    setSelectedMedCatalog(null)
    setMedQuery("")
    setMedSuggestions([])
    setSelectedObsType(null)
    setCreateLabel("")
    setCreateDefaultValue("")
    setCreateError("")
  }

  async function handleCreate() {
    if (!selectedPerson || !selectedKind) return
    if (selectedKind === "medication" && !selectedMedCatalog) return
    if (selectedKind === "observation" && !selectedObsType) return

    setCreateSaving(true)
    setCreateError("")
    try {
      const body: Record<string, unknown> = {
        person_id: selectedPerson.id,
        action_kind: selectedKind,
        label: createLabel.trim() || null,
      }
      if (selectedKind === "medication") {
        body.medication_id = selectedMedCatalog!.id
        body.default_value = createDefaultValue.trim() || null
      } else {
        body.observation_type = selectedObsType
      }

      const res = await fetch("/api/favourites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        setCreateError(j.error ?? "Save failed — please try again.")
        return
      }
      resetCreate()
      await loadFavourites()
    } finally {
      setCreateSaving(false)
    }
  }

  function openEdit(fav: FavouriteResolved) {
    setEditingId(fav.id)
    setEditLabel(fav.label ?? "")
    setEditDefaultValue(fav.default_value ?? "")
    setEditError("")
  }

  async function saveEdit() {
    if (!editingId) return
    setEditSaving(true)
    setEditError("")
    try {
      const body: Record<string, unknown> = { label: editLabel.trim() || null }
      const fav = favourites.find(f => f.id === editingId)
      if (fav?.action_kind === "medication") {
        body.default_value = editDefaultValue.trim() || null
      }
      const res = await fetch(`/api/favourites/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        setEditError(j.error ?? "Save failed.")
        return
      }
      setEditingId(null)
      await loadFavourites()
    } finally {
      setEditSaving(false)
    }
  }

  function promptDelete(fav: FavouriteResolved) {
    setConfirmDlg({
      title: "Remove favourite?",
      message: "This removes the shortcut. Records and medications are not affected.",
      variant: "warning",
      onConfirm: async () => {
        await fetch(`/api/favourites/${fav.id}`, { method: "DELETE" })
        setConfirmDlg(null)
        await loadFavourites()
      },
    })
  }

  async function moveUp(i: number) {
    if (i === 0 || reordering) return
    const a = favourites[i]
    const b = favourites[i - 1]
    setReordering(true)
    try {
      await Promise.all([
        fetch(`/api/favourites/${a.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sort_order: b.sort_order }),
        }),
        fetch(`/api/favourites/${b.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sort_order: a.sort_order }),
        }),
      ])
      await loadFavourites()
    } finally {
      setReordering(false)
    }
  }

  async function moveDown(i: number) {
    if (i === favourites.length - 1 || reordering) return
    const a = favourites[i]
    const b = favourites[i + 1]
    setReordering(true)
    try {
      await Promise.all([
        fetch(`/api/favourites/${a.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sort_order: b.sort_order }),
        }),
        fetch(`/api/favourites/${b.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sort_order: a.sort_order }),
        }),
      ])
      await loadFavourites()
    } finally {
      setReordering(false)
    }
  }

  const itemReady =
    (selectedKind === "medication" && selectedMedCatalog != null) ||
    (selectedKind === "observation" && selectedObsType != null)

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Favourites" />

      <main {...mainContentTargetProps} className="flex-1 bg-fc-blue overflow-y-auto fc-scroll">

        {/* ── Favourites list card ── */}
        <div className="bg-fc-panel m-3 rounded-xl p-4 flex flex-col gap-3">
          <h2 className="font-bold text-gray-800 text-lg">Your Favourites</h2>

          {loadingFavs && (
            <p className="text-sm text-gray-500">Loading…</p>
          )}

          {!loadingFavs && favourites.length === 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-gray-600 leading-relaxed">
                Favourites are shortcuts to the people and actions you use most often — like a frequent
                PRN medication or a regular check-in. Tap a favourite from the home screen to open the
                record form pre-filled and ready to adjust.
              </p>
              {!showCreate && (
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className={primaryBtnClass + " self-start"}
                >
                  Add your first favourite
                </button>
              )}
            </div>
          )}

          {!loadingFavs && favourites.length > 0 && (
            <div className="flex flex-col gap-2">
              {favourites.map((fav, i) => (
                <div key={fav.id} className={fav.resolved ? undefined : "opacity-60"}>
                  <div className="flex items-center gap-3 rounded-xl bg-gray-100 px-3 py-2.5">
                    {/* Person avatar */}
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden"
                      style={{ backgroundColor: fav.person_color ?? "#256AA5" }}
                    >
                      <span className="text-white font-bold text-xs">
                        {personInitials(fav.person_name ?? "?")}
                      </span>
                    </div>

                    {/* Label */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">
                        {derivedLabel(fav)}
                      </p>
                      <p className="text-xs text-gray-500 capitalize">{fav.action_kind}</p>
                      {!fav.resolved && (
                        <p className="text-xs text-amber-700 mt-0.5">
                          Unavailable — target removed or deactivated
                        </p>
                      )}
                    </div>

                    {/* Reorder */}
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        type="button"
                        aria-label="Move up"
                        disabled={i === 0 || reordering}
                        onClick={() => void moveUp(i)}
                        className="text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-sm leading-none px-1 py-0.5"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        aria-label="Move down"
                        disabled={i === favourites.length - 1 || reordering}
                        onClick={() => void moveDown(i)}
                        className="text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-sm leading-none px-1 py-0.5"
                      >
                        ▼
                      </button>
                    </div>

                    {/* Edit (resolved only) */}
                    {fav.resolved && (
                      <button
                        type="button"
                        onClick={() => {
                          if (editingId === fav.id) { setEditingId(null) } else { openEdit(fav) }
                        }}
                        className="shrink-0 text-sm font-semibold text-fc-blue hover:text-fc-blue-mid px-2 py-1 rounded transition-colors"
                      >
                        {editingId === fav.id ? "Cancel" : "Edit"}
                      </button>
                    )}

                    {/* Remove */}
                    <button
                      type="button"
                      onClick={() => promptDelete(fav)}
                      className="shrink-0 text-sm font-semibold text-red-600 hover:text-red-700 px-2 py-1 rounded transition-colors"
                    >
                      Remove
                    </button>
                  </div>

                  {/* Inline edit form */}
                  {editingId === fav.id && (
                    <div className="mt-1 mx-1 rounded-xl border border-gray-200 bg-white px-3 py-3 flex flex-col gap-3">
                      <div>
                        <label className="text-xs font-bold text-gray-700 block mb-1">
                          Custom label (optional)
                        </label>
                        <input
                          value={editLabel}
                          onChange={e => setEditLabel(e.target.value)}
                          placeholder={derivedLabel(fav)}
                          className={inputClass}
                        />
                      </div>
                      {fav.action_kind === "medication" && (
                        <div>
                          <label className="text-xs font-bold text-gray-700 block mb-1">
                            Default dose (optional)
                          </label>
                          <input
                            value={editDefaultValue}
                            onChange={e => setEditDefaultValue(e.target.value)}
                            placeholder="e.g. 2"
                            className={inputClass}
                          />
                        </div>
                      )}
                      {editError && <p className="text-red-600 text-xs">{editError}</p>}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          disabled={editSaving}
                          className={outlineBtnClass}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveEdit()}
                          disabled={editSaving}
                          className={primaryBtnClass}
                        >
                          {editSaving ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {!loadingFavs && favourites.length > 0 && !showCreate && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className={primaryBtnClass + " self-start mt-1"}
            >
              + Add favourite
            </button>
          )}
        </div>

        {/* ── Create form card ── */}
        {showCreate && (
          <div className="bg-fc-panel m-3 rounded-xl p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-gray-800 text-lg">Add favourite</h2>
              <button
                type="button"
                onClick={resetCreate}
                className="text-gray-500 hover:text-gray-700 text-sm font-semibold px-2 py-1 rounded"
              >
                Cancel
              </button>
            </div>

            {/* Step 1: Person */}
            <div>
              <label className="text-sm font-bold text-gray-700 block mb-2">
                Who is this for?
              </label>
              <div className="flex flex-wrap gap-2">
                {people.map(person => {
                  const isSelected = selectedPerson?.id === person.id
                  return (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => selectPerson(person)}
                      className={
                        "flex items-center gap-2 px-3 py-2 rounded-xl border-2 font-semibold text-sm transition-colors " +
                        (isSelected
                          ? "border-fc-blue bg-fc-blue text-white"
                          : "border-gray-200 bg-white text-gray-800 hover:border-fc-blue")
                      }
                    >
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                        style={{ backgroundColor: person.color }}
                      >
                        <span className={`font-bold text-xs ${isSelected ? "text-white" : "text-white"}`}>
                          {personInitials(person.name)}
                        </span>
                      </div>
                      {person.name}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Step 2: Kind toggle */}
            {selectedPerson && (
              <div>
                <label className="text-sm font-bold text-gray-700 block mb-2">Action</label>
                <div className="flex gap-2">
                  {(["medication", "observation"] as const).map(kind => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => selectKind(kind)}
                      className={
                        "flex-1 py-2.5 rounded-xl border-2 font-semibold text-sm capitalize transition-colors " +
                        (selectedKind === kind
                          ? "border-fc-blue bg-fc-blue text-white"
                          : "border-gray-200 bg-white text-gray-800 hover:border-fc-blue")
                      }
                    >
                      {kind}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 3a: Medication picker — same search source as record-medication */}
            {selectedKind === "medication" && (
              <div>
                <label className="text-sm font-bold text-gray-700 block mb-2">
                  Medication
                  {selectedPerson?.date_of_birth && (
                    <span className="text-xs font-normal text-gray-500 ml-2">age-filtered</span>
                  )}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={medQuery}
                    placeholder="Start typing to search…"
                    onChange={e => { setMedQuery(e.target.value); setSelectedMedCatalog(null) }}
                    onFocus={() => !selectedMedCatalog && medQuery.length > 0 && setShowMedSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowMedSuggestions(false), 150)}
                    className={inputClass}
                  />
                  {showMedSuggestions && medQuery.trim().length > 0 && !selectedMedCatalog && (
                    <ul className="absolute z-10 w-full bg-white border border-gray-300 rounded shadow-lg max-h-48 overflow-y-auto">
                      {loadingMedSearch && (
                        <li className="px-3 py-2 text-sm text-gray-500">Searching…</li>
                      )}
                      {!loadingMedSearch && medSuggestions.length === 0 && (
                        <li className="px-3 py-2 text-sm text-gray-500">No medications found</li>
                      )}
                      {!loadingMedSearch && medSuggestions.map(med => (
                        <li key={med.id}>
                          <button
                            type="button"
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => {
                              setSelectedMedCatalog(med)
                              setMedQuery(med.name)
                              setMedSuggestions([])
                              setShowMedSuggestions(false)
                              setCreateDefaultValue(
                                med.default_dosage != null ? String(med.default_dosage) : ""
                              )
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-fc-panel text-gray-800 text-sm"
                          >
                            <span className="font-medium">{med.name}</span>
                            {med.default_dosage != null && (
                              <span className="text-gray-500 text-xs ml-2">
                                ({med.default_dosage} {med.dosage_unit})
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {selectedMedCatalog && (
                  <div className="mt-1.5 flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-fc-blue bg-fc-blue/10 text-sm">
                    <span className="font-semibold text-gray-900 flex-1">{selectedMedCatalog.name}</span>
                    {selectedMedCatalog.default_dosage != null && (
                      <span className="text-gray-500 text-xs">
                        {selectedMedCatalog.default_dosage} {selectedMedCatalog.dosage_unit}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => { setSelectedMedCatalog(null); setMedQuery(""); setCreateDefaultValue("") }}
                      className="text-xs text-gray-500 hover:text-gray-700 ml-1"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Step 3b: Observation type picker */}
            {selectedKind === "observation" && (
              <div>
                <label className="text-sm font-bold text-gray-700 block mb-2">Observation type</label>
                {availableObsConfigs.length === 0 && (
                  <p className="text-sm text-gray-500">No observation types available.</p>
                )}
                <div className="flex flex-col gap-1.5">
                  {availableObsConfigs.map(cfg => {
                    const isSelected = selectedObsType === cfg.observation_type
                    return (
                      <button
                        key={cfg.observation_type}
                        type="button"
                        onClick={() => setSelectedObsType(isSelected ? null : cfg.observation_type)}
                        className={
                          "flex items-center px-3 py-2.5 rounded-xl border-2 text-sm font-semibold transition-colors " +
                          (isSelected
                            ? "border-fc-blue bg-fc-blue/10 text-gray-900"
                            : "border-gray-200 bg-white text-gray-700 hover:border-fc-blue")
                        }
                      >
                        {cfg.observation_type}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Step 4: Details */}
            {itemReady && (
              <div className="flex flex-col gap-3 border-t border-gray-200 pt-3">
                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1">
                    Custom label (optional)
                  </label>
                  <input
                    value={createLabel}
                    onChange={e => setCreateLabel(e.target.value)}
                    placeholder={createPreviewLabel}
                    className={inputClass}
                  />
                  <p className="text-xs text-gray-400 mt-1">Leave blank to use the default label.</p>
                </div>

                {selectedKind === "medication" && (
                  <div>
                    <label className="text-xs font-bold text-gray-700 block mb-1">
                      Default dose (optional)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        value={createDefaultValue}
                        onChange={e => setCreateDefaultValue(e.target.value)}
                        placeholder="e.g. 2"
                        className="w-28 bg-white border border-gray-300 rounded px-3 py-2 text-gray-800 text-sm"
                      />
                      {selectedMedCatalog && (
                        <span className="text-sm text-gray-500">{selectedMedCatalog.dosage_unit}</span>
                      )}
                    </div>
                  </div>
                )}

                {createPreviewLabel && (
                  <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-700">
                    <span className="text-gray-400 text-xs block mb-0.5">Preview</span>
                    ⭐ {createPreviewLabel}
                  </div>
                )}

                {createError && (
                  <p className="text-red-600 text-sm font-medium">{createError}</p>
                )}

                <div className="flex gap-2">
                  <button type="button" onClick={resetCreate} className={outlineBtnClass}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCreate()}
                    disabled={createSaving}
                    className={primaryBtnClass}
                  >
                    {createSaving ? "Saving…" : "Save favourite"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <AppFooter />

      {confirmDlg && (
        <ConfirmModal
          open
          title={confirmDlg.title}
          message={confirmDlg.message}
          variant={confirmDlg.variant}
          confirmLabel="Remove"
          onConfirm={confirmDlg.onConfirm}
          onCancel={() => setConfirmDlg(null)}
        />
      )}
    </div>
  )
}
