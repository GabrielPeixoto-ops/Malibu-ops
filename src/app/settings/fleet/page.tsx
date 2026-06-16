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
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Fleet</h1>
        <Button onClick={openCreate}><Plus className="w-4 h-4" /> Add Truck</Button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {trucks.map((t) => {
            const notesOpen = expandedNotes.has(t.id)
            return (
              <div
                key={t.id}
                className={`bg-white rounded-xl border p-4 flex flex-col gap-3 ${!t.is_active ? 'opacity-60' : 'border-gray-200'}`}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-bold text-gray-900 leading-tight">{t.name}</h2>
                    {t.model && <p className="text-xs text-gray-500 mt-0.5">{t.model}</p>}
                  </div>
                  <button
                    onClick={() => openEdit(t)}
                    className="p-1.5 text-gray-400 hover:text-blue-600 rounded shrink-0"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>

                {/* Badges */}
                <div className="flex flex-wrap gap-1.5">
                  {t.registration && (
                    <span className="px-2 py-0.5 rounded font-mono text-xs font-bold bg-gray-900 text-white tracking-wider">
                      {t.registration}
                    </span>
                  )}
                  {t.size && (
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      t.size === 'large' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {t.size === 'large' ? 'Large' : 'Small'}
                    </span>
                  )}
                  {t.tonnes != null && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                      {t.tonnes}T
                    </span>
                  )}
                  {t.tailgate && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                      {t.tailgate}
                    </span>
                  )}
                </div>

                {/* Specs */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
                  {(t.cargo_capacity_cbm != null || t.actuals_cbm != null) && (
                    <div>
                      <span className="text-gray-400">Capacity</span>
                      <p className="font-medium text-gray-800">
                        {t.cargo_capacity_cbm ?? '—'} CBM
                        {t.actuals_cbm != null && <span className="text-gray-400"> ({t.actuals_cbm} actual)</span>}
                      </p>
                    </div>
                  )}
                  {(t.height_clearance || t.internal_height) && (
                    <div>
                      <span className="text-gray-400">Height</span>
                      <p className="font-medium text-gray-800">
                        {t.height_clearance ?? '—'} clearance
                        {t.internal_height && <span className="text-gray-400"> / {t.internal_height} internal</span>}
                      </p>
                    </div>
                  )}

                </div>

                {/* Selling points */}
                {t.selling_points && (
                  <p className="text-xs font-medium text-indigo-700 bg-indigo-50 rounded px-2 py-1">
                    {t.selling_points}
                  </p>
                )}

                {/* Notes (collapsible) */}
                {t.notes && (
                  <div>
                    <button
                      onClick={() => toggleNotes(t.id)}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
                    >
                      {notesOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      Notes
                    </button>
                    {notesOpen && (
                      <p className="mt-1 text-xs text-gray-600 leading-relaxed">{t.notes}</p>
                    )}
                  </div>
                )}

                {/* Footer */}
                <div className="mt-auto pt-2 border-t border-gray-100 flex justify-end">
                  <button
                    onClick={() => toggleActive(t)}
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                      t.is_active
                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              placeholder="Internal notes…"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setField('is_active', e.target.checked)} className="rounded" />
            Active (shown in job form)
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
