'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, ChevronDown, ChevronUp, Fuel } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Fleet, FleetFuelLog } from '@/types/database'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Modal from '@/components/ui/Modal'

function emptyFuelForm(): FuelForm {
  return { date: new Date().toISOString().slice(0, 10), litres: '', cost: '', odometer_km: '', filled_by: '', notes: '' }
}

interface FuelForm {
  date: string
  litres: string
  cost: string
  odometer_km: string
  filled_by: string
  notes: string
}

// Average L/100km across all consecutive fill-ups that have an odometer
// reading, assuming each fill-up tops the tank back up (standard "full to
// full" method) — so the litres put in at fill-up N roughly covers the
// distance driven since fill-up N-1. Needs at least 2 logs with odometer.
function estimateConsumption(logs: FleetFuelLog[]): number | null {
  const withOdo = logs.filter((l) => l.odometer_km != null).sort((a, b) => (a.odometer_km ?? 0) - (b.odometer_km ?? 0))
  if (withOdo.length < 2) return null
  let totalKm = 0
  let totalLitres = 0
  for (let i = 1; i < withOdo.length; i++) {
    const km = (withOdo[i].odometer_km ?? 0) - (withOdo[i - 1].odometer_km ?? 0)
    if (km <= 0) continue
    totalKm += km
    totalLitres += withOdo[i].litres
  }
  if (totalKm <= 0) return null
  return (totalLitres / totalKm) * 100
}

const sizeOptions = [
  { value: 'small', label: 'Small' },
  { value: 'large', label: 'Large' },
]

const tailgateOptions = [
  { value: 'RAMP', label: 'RAMP' },
  { value: 'TGL', label: 'TGL' },
]

function emptyForm(): FleetForm {
  return {
    name: '', model: '', registration: '', size: 'large',
    cargo_capacity_cbm: '', actuals_cbm: '', height_clearance: '',
    internal_height: '', tailgate: 'RAMP',
    selling_points: '', notes: '', tonnes: '', is_active: true,
  }
}

interface FleetForm {
  name: string
  model: string
  registration: string
  size: 'small' | 'large'
  cargo_capacity_cbm: string
  actuals_cbm: string
  height_clearance: string
  internal_height: string
  tailgate: string
  selling_points: string
  notes: string
  tonnes: string
  is_active: boolean
}

function formFromFleet(t: Fleet): FleetForm {
  return {
    name: t.name,
    model: t.model ?? '',
    registration: t.registration ?? '',
    size: t.size ?? 'large',
    cargo_capacity_cbm: t.cargo_capacity_cbm != null ? String(t.cargo_capacity_cbm) : '',
    actuals_cbm: t.actuals_cbm != null ? String(t.actuals_cbm) : '',
    height_clearance: t.height_clearance ?? '',
    internal_height: t.internal_height ?? '',
    tailgate: t.tailgate ?? 'RAMP',
    selling_points: t.selling_points ?? '',
    notes: t.notes ?? '',
    tonnes: t.tonnes != null ? String(t.tonnes) : '',
    is_active: t.is_active,
  }
}

export default function FleetPage() {
  const supabase = createClient()
  const [trucks, setTrucks] = useState<Fleet[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Fleet | null>(null)
  const [form, setForm] = useState<FleetForm>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set())

  // ── Fuel logging (migration_v52) ──────────────────────────────────────────
  const [fuelLogs, setFuelLogs] = useState<FleetFuelLog[]>([])
  const [fuelModalOpen, setFuelModalOpen] = useState(false)
  const [fuelTruck, setFuelTruck] = useState<Fleet | null>(null)
  const [fuelForm, setFuelForm] = useState<FuelForm>(emptyFuelForm())
  const [fuelSaving, setFuelSaving] = useState(false)
  const [expandedFuel, setExpandedFuel] = useState<Set<string>>(new Set())

  async function load() {
    const { data } = await supabase.from('fleet').select('*').order('name')
    setTrucks((data ?? []) as unknown as Fleet[])
    try {
      const { data: fuel } = await supabase.from('fleet_fuel_logs').select('*').order('date', { ascending: false })
      setFuelLogs((fuel ?? []) as unknown as FleetFuelLog[])
    } catch { /* migration not yet applied */ }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const fuelByTruck = useMemo(() => {
    const map = new Map<string, FleetFuelLog[]>()
    for (const log of fuelLogs) {
      const list = map.get(log.fleet_id) ?? []
      list.push(log)
      map.set(log.fleet_id, list)
    }
    return map
  }, [fuelLogs])

  function openFuelLog(t: Fleet) {
    setFuelTruck(t)
    setFuelForm(emptyFuelForm())
    setFuelModalOpen(true)
  }

  function toggleFuelHistory(id: string) {
    setExpandedFuel((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleSaveFuel() {
    if (!fuelTruck) return
    const litres = parseFloat(fuelForm.litres)
    const cost = parseFloat(fuelForm.cost)
    if (!fuelForm.date || !(litres > 0) || !(cost > 0)) return
    setFuelSaving(true)
    await supabase.from('fleet_fuel_logs').insert({
      fleet_id: fuelTruck.id,
      date: fuelForm.date,
      litres,
      cost,
      odometer_km: parseFloat(fuelForm.odometer_km) || null,
      filled_by: fuelForm.filled_by.trim() || null,
      notes: fuelForm.notes.trim() || null,
    })
    setFuelSaving(false)
    setFuelModalOpen(false)
    load()
  }

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setError('')
    setModalOpen(true)
  }

  function openEdit(t: Fleet) {
    setEditing(t)
    setForm(formFromFleet(t))
    setError('')
    setModalOpen(true)
  }

  function toggleNotes(id: string) {
    setExpandedNotes((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function setField<K extends keyof FleetForm>(k: K, v: FleetForm[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')
    const payload = {
      name: form.name.trim(),
      model: form.model.trim() || null,
      registration: form.registration.trim() || null,
      size: form.size,
      cargo_capacity_cbm: parseInt(form.cargo_capacity_cbm) || null,
      actuals_cbm: parseInt(form.actuals_cbm) || null,
      height_clearance: form.height_clearance.trim() || null,
      internal_height: form.internal_height.trim() || null,
      tailgate: form.tailgate.trim() || null,
      selling_points: form.selling_points.trim() || null,
      notes: form.notes.trim() || null,
      tonnes: parseFloat(form.tonnes) || null,
      is_active: form.is_active,
    }
    if (editing) {
      await supabase.from('fleet').update(payload).eq('id', editing.id)
    } else {
      await supabase.from('fleet').insert(payload)
    }
    setSaving(false)
    setModalOpen(false)
    load()
  }

  async function toggleActive(t: Fleet) {
    await supabase.from('fleet').update({ is_active: !t.is_active }).eq('id', t.id)
    load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-display font-bold text-parchment">Fleet</h1>
        <Button onClick={openCreate}><Plus className="w-4 h-4" /> Add Truck</Button>
      </div>

      {loading ? (
        <p className="text-warm text-sm">Loading…</p>
      ) : trucks.length === 0 ? (
        <div className="bg-surface rounded-xl border border-wire p-12 text-center text-dim">No trucks yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {trucks.map((t) => {
            const notesOpen = expandedNotes.has(t.id)
            return (
              <div
                key={t.id}
                className={`bg-surface rounded-xl border border-wire p-4 flex flex-col gap-3 ${!t.is_active ? 'opacity-50' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-bold text-parchment leading-tight">{t.name}</h2>
                    {t.model && <p className="text-xs text-dim mt-0.5">{t.model}</p>}
                  </div>
                  <button onClick={() => openEdit(t)} className="p-1.5 text-dim hover:text-gold rounded transition-colors shrink-0">
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {t.registration && (
                    <span className="px-2 py-0.5 rounded font-mono text-xs font-bold bg-panel text-parchment tracking-wider border border-wire">
                      {t.registration}
                    </span>
                  )}
                  {t.size && (
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      t.size === 'large' ? 'bg-amber-500/10 text-amber-300' : 'bg-blue-500/10 text-blue-300'
                    }`}>
                      {t.size === 'large' ? 'Large' : 'Small'}
                    </span>
                  )}
                  {t.tonnes != null && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-wire/50 text-warm">{t.tonnes}T</span>
                  )}
                  {t.tailgate && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-wire/50 text-warm">{t.tailgate}</span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-warm">
                  {(t.cargo_capacity_cbm != null || t.actuals_cbm != null) && (
                    <div>
                      <span className="text-dim">Capacity</span>
                      <p className="font-medium text-parchment">
                        {t.cargo_capacity_cbm ?? '—'} CBM
                        {t.actuals_cbm != null && <span className="text-dim"> ({t.actuals_cbm} actual)</span>}
                      </p>
                    </div>
                  )}
                  {(t.height_clearance || t.internal_height) && (
                    <div>
                      <span className="text-dim">Height</span>
                      <p className="font-medium text-parchment">
                        {t.height_clearance ?? '—'} clearance
                        {t.internal_height && <span className="text-dim"> / {t.internal_height} internal</span>}
                      </p>
                    </div>
                  )}
                </div>

                {t.selling_points && (
                  <p className="text-xs font-medium text-gold bg-gold/8 rounded px-2 py-1">
                    {t.selling_points}
                  </p>
                )}

                {t.notes && (
                  <div>
                    <button
                      onClick={() => toggleNotes(t.id)}
                      className="flex items-center gap-1 text-xs text-dim hover:text-warm transition-colors"
                    >
                      {notesOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      Notes
                    </button>
                    {notesOpen && (
                      <p className="mt-1 text-xs text-warm leading-relaxed">{t.notes}</p>
                    )}
                  </div>
                )}

                {/* Fuel (migration_v52) — manual log until we have Quik/QuikTrak API
                    access to pull km driven automatically. */}
                {(() => {
                  const logs = fuelByTruck.get(t.id) ?? []
                  const thirtyDaysAgo = new Date()
                  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
                  const recent = logs.filter((l) => new Date(l.date) >= thirtyDaysAgo)
                  const recentCost = recent.reduce((s, l) => s + l.cost, 0)
                  const recentLitres = recent.reduce((s, l) => s + l.litres, 0)
                  const avgConsumption = estimateConsumption(logs)
                  const fuelOpen = expandedFuel.has(t.id)
                  return (
                    <div className="mt-auto pt-2 border-t border-wire">
                      <div className="flex items-center justify-between mb-1">
                        <button
                          onClick={() => toggleFuelHistory(t.id)}
                          className="flex items-center gap-1 text-xs text-dim hover:text-warm transition-colors"
                        >
                          <Fuel className="w-3 h-3" />
                          Fuel
                          {logs.length > 0 && (fuelOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                        </button>
                        <button
                          onClick={() => openFuelLog(t)}
                          className="text-xs font-medium text-gold hover:text-gold-bright"
                        >
                          + Log
                        </button>
                      </div>
                      {logs.length === 0 ? (
                        <p className="text-xs text-dim">No fill-ups logged yet.</p>
                      ) : (
                        <div className="text-xs text-warm space-y-0.5">
                          <p>
                            Last 30 days: <span className="font-semibold text-parchment">${recentCost.toFixed(2)}</span>
                            {recentLitres > 0 && <span className="text-dim"> ({recentLitres.toFixed(0)}L)</span>}
                          </p>
                          {avgConsumption != null && (
                            <p className="text-dim">Average: <span className="font-semibold text-parchment">{avgConsumption.toFixed(1)} L/100km</span></p>
                          )}
                        </div>
                      )}
                      {fuelOpen && logs.length > 0 && (
                        <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                          {logs.slice(0, 8).map((l) => (
                            <div key={l.id} className="flex items-center justify-between text-xs text-dim">
                              <span>{l.date} {l.filled_by ? `· ${l.filled_by}` : ''}</span>
                              <span className="font-mono">{l.litres.toFixed(0)}L · ${l.cost.toFixed(2)}{l.odometer_km != null ? ` · ${l.odometer_km.toFixed(0)}km` : ''}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })()}

                <div className="pt-2 border-t border-wire flex justify-end">
                  <button
                    onClick={() => toggleActive(t)}
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                      t.is_active
                        ? 'bg-success/10 text-success hover:bg-success/20'
                        : 'bg-wire/50 text-dim hover:bg-wire'
                    }`}
                  >
                    {t.is_active ? 'Active' : 'Inactive'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit ${editing.name}` : 'Add Truck'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Name" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="Truck 1" />
            <Input label="Registration" value={form.registration} onChange={(e) => setField('registration', e.target.value)} placeholder="CM39SK" />
          </div>
          <Input label="Model" value={form.model} onChange={(e) => setField('model', e.target.value)} placeholder="HINO 300 617" />
          <div className="grid grid-cols-3 gap-3">
            <Select label="Size" options={sizeOptions} value={form.size} onChange={(e) => setField('size', e.target.value as 'small' | 'large')} />
            <Input label="Tonnes" type="number" min="0" step="0.5" value={form.tonnes} onChange={(e) => setField('tonnes', e.target.value)} placeholder="6" />
            <Select label="Tailgate" options={tailgateOptions} value={form.tailgate} onChange={(e) => setField('tailgate', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Cargo capacity (CBM)" type="number" min="0" value={form.cargo_capacity_cbm} onChange={(e) => setField('cargo_capacity_cbm', e.target.value)} placeholder="35" />
            <Input label="Actuals (CBM)" type="number" min="0" value={form.actuals_cbm} onChange={(e) => setField('actuals_cbm', e.target.value)} placeholder="33" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Height clearance" value={form.height_clearance} onChange={(e) => setField('height_clearance', e.target.value)} placeholder="3.7M" />
            <Input label="Internal height" value={form.internal_height} onChange={(e) => setField('internal_height', e.target.value)} placeholder="2.6M" />
          </div>
          <Input label="Selling points" value={form.selling_points} onChange={(e) => setField('selling_points', e.target.value)} placeholder="SOLD AS 4.5T, 6T AND 8T" />
          <div>
            <label className="block text-xs font-semibold text-dim uppercase tracking-wide mb-1">Notes</label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              placeholder="Internal notes…"
              className="w-full px-3 py-2 text-sm border border-wire rounded-lg bg-panel text-parchment focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-warm cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setField('is_active', e.target.checked)} className="rounded border-wire bg-panel text-gold focus:ring-gold-ring" />
            Active (shown in job form)
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={fuelModalOpen} onClose={() => setFuelModalOpen(false)} title={fuelTruck ? `Fuel log — ${fuelTruck.name}` : 'Fuel log'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date" type="date" value={fuelForm.date} onChange={(e) => setFuelForm((f) => ({ ...f, date: e.target.value }))} />
            <Input label="Filled by" value={fuelForm.filled_by} onChange={(e) => setFuelForm((f) => ({ ...f, filled_by: e.target.value }))} placeholder="Driver name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Litres" type="number" min="0" step="0.01" value={fuelForm.litres} onChange={(e) => setFuelForm((f) => ({ ...f, litres: e.target.value }))} placeholder="80" />
            <Input label="Cost ($)" type="number" min="0" step="0.01" value={fuelForm.cost} onChange={(e) => setFuelForm((f) => ({ ...f, cost: e.target.value }))} placeholder="150.00" />
          </div>
          <Input
            label="Odometer (km) — optional"
            type="number"
            min="0"
            value={fuelForm.odometer_km}
            onChange={(e) => setFuelForm((f) => ({ ...f, odometer_km: e.target.value }))}
            placeholder="120500"
          />
          <p className="text-xs text-dim -mt-2">
            Filling in the odometer at each fill-up lets us automatically calculate the truck&apos;s average L/100km.
          </p>
          <div>
            <label className="block text-xs font-semibold text-dim uppercase tracking-wide mb-1">Notes</label>
            <textarea
              rows={2}
              value={fuelForm.notes}
              onChange={(e) => setFuelForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Station, remarks…"
              className="w-full px-3 py-2 text-sm border border-wire rounded-lg bg-panel text-parchment focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setFuelModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveFuel} disabled={fuelSaving}>{fuelSaving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
