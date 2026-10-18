// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { HYDRATION_OBSERVATION_TYPE } from "@/lib/hydration/hydration-presets"
import { Fragment, useState, useEffect, useMemo, useCallback } from "react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import ConfirmModal from "@/components/ConfirmModal"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import { ChipGroup } from "@/components/ui/Chip"
import { Input } from "@/components/ui/controls"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import EntityRowActions from "@/components/ui/EntityRowActions"
import FormField, { FieldRow } from "@/components/ui/FormField"
import IconButton from "@/components/ui/IconButton"
import ListCard, { CardList } from "@/components/ui/ListCard"
import PageContainer from "@/components/ui/PageContainer"
import Panel from "@/components/ui/Panel"
import SuggestionList from "@/components/ui/SuggestionList"
import Badge from "@/components/ui/Badge"
import type { Person, ObservationTypeConfig, FavouriteResolved } from "@/lib/domain-types"
import { fractionalAgeYears } from "@/lib/person/person-age"
import { disabledWhen } from "@/lib/ui/disabled-props"

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

function derivedLabel(fav: FavouriteResolved): string {
  if (fav.label) return fav.label
  const p = fav.person_name ?? "Unknown"
  const a =
    fav.action_kind === "medication"
      ? (fav.medication_name ?? "Unknown medication")
      : (fav.observation_type ?? "Unknown observation")
  return `${p} · ${a}`
}

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
        if (selectedObsType === HYDRATION_OBSERVATION_TYPE) {
          body.default_value = createDefaultValue.trim() || null
        }
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
      if (fav?.action_kind === "medication" || fav?.observation_type === HYDRATION_OBSERVATION_TYPE) {
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

  const kindLabel = (kind: string) => (kind === "medication" ? "Medication" : "Observation")

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Favourites" />

      <PageContainer>
        {loadingFavs && <p className="fc-admin-note">Loading…</p>}

        {!loadingFavs && favourites.length === 0 && (
          <EmptyState
            icon={EMPTY_STATE_ICONS.noFavourites}
            heading="No favourites yet"
            action={!showCreate ? <Button onClick={() => setShowCreate(true)}>Add your first favourite</Button> : undefined}
          >
            Favourites are shortcuts to the people and actions you use most often, like a frequent PRN medication.
          </EmptyState>
        )}

        {!loadingFavs && favourites.length > 0 && (
          <>
            <p className="fc-section-copy fc-surface-copy">
              Tap a favourite from the Quick record sheet to open the record form pre-filled and ready to adjust.
            </p>
            <CardList>
              {favourites.map((fav, i) => (
                <Fragment key={fav.id}>
                  <ListCard
                    avatar={{ src: null, name: fav.person_name ?? "?" }}
                    title={derivedLabel(fav)}
                    inactive={!fav.resolved}
                    meta={[kindLabel(fav.action_kind)]}
                    extras={!fav.resolved ? <Badge tone="warning">Unavailable — target removed or deactivated</Badge> : undefined}
                    trailing={
                      <div className="fc-fav-actions">
                        <IconButton label="Move up" disabled={i === 0 || reordering} onClick={() => void moveUp(i)}>▲</IconButton>
                        <IconButton label="Move down" disabled={i === favourites.length - 1 || reordering} onClick={() => void moveDown(i)}>▼</IconButton>
                        <EntityRowActions
                          name={derivedLabel(fav)}
                          editLabel={editingId === fav.id ? "Cancel" : "Edit"}
                          onEdit={fav.resolved ? () => { if (editingId === fav.id) { setEditingId(null) } else { openEdit(fav) } } : undefined}
                          deleteLabel="Remove"
                          onDelete={() => promptDelete(fav)}
                        />
                      </div>
                    }
                  />

                  {editingId === fav.id && (
                    <li>
                      <Panel>
                        <FormField label="Custom label" optional>
                          <Input value={editLabel} onChange={e => setEditLabel(e.target.value)} placeholder={derivedLabel(fav)} />
                        </FormField>
                        {fav.action_kind === "medication" && (
                          <FormField label="Default dose" optional>
                            <Input value={editDefaultValue} onChange={e => setEditDefaultValue(e.target.value)} placeholder="e.g. 2" />
                          </FormField>
                        )}
                        {fav.observation_type === HYDRATION_OBSERVATION_TYPE && (
                          <FormField label="Amount, mL" optional>
                            <Input value={editDefaultValue} onChange={e => setEditDefaultValue(e.target.value)} inputMode="numeric" placeholder="e.g. 375" />
                          </FormField>
                        )}
                        {editError && <Banner kind="error">{editError}</Banner>}
                        <div className="fc-form-actions">
                          <Button variant="secondary" onClick={() => setEditingId(null)} {...disabledWhen(editSaving && "Saving…")}>Cancel</Button>
                          <Button onClick={() => void saveEdit()} pending={editSaving}>Save</Button>
                        </div>
                      </Panel>
                    </li>
                  )}
                </Fragment>
              ))}
            </CardList>
          </>
        )}

        {!loadingFavs && favourites.length > 0 && !showCreate && (
          <div>
            <Button onClick={() => setShowCreate(true)}>+ Add favourite</Button>
          </div>
        )}

        {showCreate && (
          <Panel>
            <div className="fc-log-head">
              <h2 className="fc-section-title">Add favourite</h2>
              <Button variant="quiet" onClick={resetCreate}>Cancel</Button>
            </div>

            <ChipGroup
              legend="Who is this for?"
              value={selectedPerson ? String(selectedPerson.id) : ""}
              options={people.map(person => ({ value: String(person.id), label: person.name }))}
              onChange={id => {
                const person = people.find(p => String(p.id) === id)
                if (person && selectedPerson?.id !== person.id) selectPerson(person)
              }}
            />

            {selectedPerson && (
              <ChipGroup
                legend="Action"
                value={selectedKind ?? ""}
                options={[
                  { value: "medication", label: "Medication" },
                  { value: "observation", label: "Observation" },
                ]}
                onChange={kind => { if (kind !== selectedKind) selectKind(kind as "medication" | "observation") }}
              />
            )}

            {selectedKind === "medication" && (
              <FormField
                label="Medication"
                hint={selectedPerson?.date_of_birth ? "Filtered for this person's age." : undefined}
              >
                <div
                  className="fc-suggest-wrap"
                  onBlur={e => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setShowMedSuggestions(false)
                  }}
                >
                  <Input
                    type="text"
                    value={medQuery}
                    autoComplete="off"
                    placeholder="Start typing to search…"
                    onChange={e => { setMedQuery(e.target.value); setSelectedMedCatalog(null) }}
                    onFocus={() => !selectedMedCatalog && medQuery.length > 0 && setShowMedSuggestions(true)}
                  />
                  {showMedSuggestions && medQuery.trim().length > 0 && !selectedMedCatalog && (
                    loadingMedSearch ? (
                      <p className="fc-field__hint">Searching…</p>
                    ) : medSuggestions.length === 0 ? (
                      <p className="fc-field__hint">No medications found</p>
                    ) : (
                      <SuggestionList
                        items={medSuggestions.map(med => ({
                          key: med.id,
                          onSelect: () => {
                            setSelectedMedCatalog(med)
                            setMedQuery(med.name)
                            setMedSuggestions([])
                            setShowMedSuggestions(false)
                            setCreateDefaultValue(med.default_dosage != null ? String(med.default_dosage) : "")
                          },
                          label: (
                            <>
                              <span className="fc-suggest__name">{med.name}</span>
                              {med.default_dosage != null && (
                                <span className="fc-suggest__detail">({med.default_dosage} {med.dosage_unit})</span>
                              )}
                            </>
                          ),
                        }))}
                      />
                    )
                  )}
                </div>
                {selectedMedCatalog && (
                  <div className="fc-pill">
                    {selectedMedCatalog.name}
                    {selectedMedCatalog.default_dosage != null && ` · ${selectedMedCatalog.default_dosage} ${selectedMedCatalog.dosage_unit}`}
                    <IconButton
                      label="Clear medication"
                      onClick={() => { setSelectedMedCatalog(null); setMedQuery(""); setCreateDefaultValue("") }}
                    >
                      ✕
                    </IconButton>
                  </div>
                )}
              </FormField>
            )}

            {selectedKind === "observation" && (
              availableObsConfigs.length === 0 ? (
                <p className="fc-field__hint">No observation types available.</p>
              ) : (
                <ChipGroup
                  legend="Observation type"
                  value={selectedObsType ?? ""}
                  options={availableObsConfigs.map(cfg => ({ value: cfg.observation_type, label: cfg.observation_type }))}
                  onChange={type => setSelectedObsType(type)}
                />
              )
            )}

            {itemReady && (
              <div className="fc-form fc-form--top-rule">
                <FormField label="Custom label" optional hint="Leave blank to use the default label.">
                  <Input value={createLabel} onChange={e => setCreateLabel(e.target.value)} placeholder={createPreviewLabel} />
                </FormField>

                {selectedKind === "medication" && (
                  <FormField label="Default dose" optional hint={selectedMedCatalog ? `In ${selectedMedCatalog.dosage_unit}.` : undefined}>
                    <FieldRow>
                      <Input value={createDefaultValue} onChange={e => setCreateDefaultValue(e.target.value)} placeholder="e.g. 2" />
                    </FieldRow>
                  </FormField>
                )}

                {selectedKind === "observation" && selectedObsType === HYDRATION_OBSERVATION_TYPE && (
                  <FormField label="Amount, mL" optional>
                    <Input value={createDefaultValue} onChange={e => setCreateDefaultValue(e.target.value)} inputMode="numeric" placeholder="e.g. 375" />
                  </FormField>
                )}

                {createPreviewLabel && (
                  <Banner kind="info" lead="Preview">⭐ {createPreviewLabel}</Banner>
                )}

                {createError && <Banner kind="error">{createError}</Banner>}

                <div className="fc-form-actions">
                  <Button variant="secondary" onClick={resetCreate}>Cancel</Button>
                  <Button onClick={() => void handleCreate()} pending={createSaving}>Save favourite</Button>
                </div>
              </div>
            )}
          </Panel>
        )}
      </PageContainer>

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
