'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { Plus, Pencil, ChevronDown, ChevronUp } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Fleet } from '@/types/database'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Modal from '@/components/ui/Modal'

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

  async function load() {
    const { data } = await supabase.from('fleet').select('*').order('name')
    setTrucks((data ?? []) as unknown as Fleet[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

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

                <div className="mt-auto pt-2 border-t border-wire flex justify-end">
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
    </div>
  )
}
