'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { PrivateRate } from '@/types/database'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Modal from '@/components/ui/Modal'

const truckSizeOptions = [
  { value: 'small', label: 'Small' },
  { value: 'large', label: 'Large' },
]

function emptyForm() {
  return {
    name: '',
    trucks: '1',
    truck_size: 'small' as 'small' | 'large',
    men: '2',
    rate_per_hour: '',
    is_active: true,
    sort_order: '0',
  }
}

export default function PrivatePricingPage() {
  const supabase = createClient()
  const [rates, setRates] = useState<PrivateRate[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<PrivateRate | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const { data } = await supabase.from('private_rates').select('*').order('sort_order')
    setRates((data ?? []) as unknown as PrivateRate[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setEditing(null)
    setForm({ ...emptyForm(), sort_order: String(rates.length + 1) })
    setError('')
    setModalOpen(true)
  }

  function openEdit(r: PrivateRate) {
    setEditing(r)
    setForm({
      name: r.name,
      trucks: String(r.trucks),
      truck_size: r.truck_size,
      men: String(r.men),
      rate_per_hour: String(r.rate_per_hour),
      is_active: r.is_active,
      sort_order: String(r.sort_order),
    })
    setError('')
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required'); return }
    const rph = parseFloat(form.rate_per_hour)
    if (!rph || rph <= 0) { setError('Rate per hour must be greater than 0'); return }
    setSaving(true)
    setError('')
    const payload = {
      name: form.name.trim(),
      trucks: parseInt(form.trucks) || 1,
      truck_size: form.truck_size,
      men: parseInt(form.men) || 2,
      rate_per_hour: rph,
      is_active: form.is_active,
      sort_order: parseInt(form.sort_order) || 0,
    }
    if (editing) {
      await supabase.from('private_rates').update(payload).eq('id', editing.id)
    } else {
      await supabase.from('private_rates').insert(payload)
    }
    setSaving(false)
    setModalOpen(false)
    load()
  }

  async function handleDelete(r: PrivateRate) {
    if (!confirm(`Delete "${r.name}"?`)) return
    await supabase.from('private_rates').delete().eq('id', r.id)
    load()
  }

  async function moveOrder(r: PrivateRate, direction: 'up' | 'down') {
    const idx = rates.findIndex((x) => x.id === r.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= rates.length) return
    const other = rates[swapIdx]
    await Promise.all([
      supabase.from('private_rates').update({ sort_order: other.sort_order }).eq('id', r.id),
      supabase.from('private_rates').update({ sort_order: r.sort_order }).eq('id', other.id),
    ])
    load()
  }

  async function toggleActive(r: PrivateRate) {
    await supabase.from('private_rates').update({ is_active: !r.is_active }).eq('id', r.id)
    load()
  }

  function setField<K extends keyof ReturnType<typeof emptyForm>>(k: K, v: ReturnType<typeof emptyForm>[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-display font-bold text-parchment">Private Pricing</h1>
        <Button onClick={openCreate}><Plus className="w-4 h-4" /> Add Rate</Button>
      </div>

      {loading ? (
        <p className="text-warm text-sm">Loading…</p>
      ) : rates.length === 0 ? (
        <div className="bg-surface rounded-xl border border-wire p-12 text-center text-dim">
          No rates yet. Add one to get started.
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-wire overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-panel border-b border-wire">
              <tr>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-dim uppercase tracking-widest w-8"></th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-dim uppercase tracking-widest">Name</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-dim uppercase tracking-widest">Trucks</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-dim uppercase tracking-widest">Size</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-dim uppercase tracking-widest">Men</th>
                <th className="text-right px-4 py-3 text-[10px] font-semibold text-dim uppercase tracking-widest">$/hr</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-dim uppercase tracking-widest">Active</th>
                <th className="px-4 py-3 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-wire">
              {rates.map((r, i) => (
                <tr key={r.id} className={`hover:bg-panel transition-colors ${!r.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-2 py-2">
                    <div className="flex flex-col gap-0.5">
                      <button
                        onClick={() => moveOrder(r, 'up')}
                        disabled={i === 0}
                        className="p-0.5 text-dim hover:text-warm disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => moveOrder(r, 'down')}
                        disabled={i === rates.length - 1}
                        className="p-0.5 text-dim hover:text-warm disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium text-parchment">{r.name}</td>
                  <td className="px-4 py-3 text-warm">{r.trucks}</td>
                  <td className="px-4 py-3 text-warm capitalize">{r.truck_size}</td>
                  <td className="px-4 py-3 text-warm">{r.men}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-gold">${Number(r.rate_per_hour).toFixed(2)}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleActive(r)}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                        r.is_active
                          ? 'bg-success/10 text-success hover:bg-success/20'
                          : 'bg-wire/50 text-dim hover:bg-wire'
                      }`}
                    >
                      {r.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(r)} className="p-1.5 text-dim hover:text-gold rounded transition-colors">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(r)} className="p-1.5 text-dim hover:text-danger rounded transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Rate' : 'Add Rate'}>
        <div className="space-y-4">
          <Input
            label="Name"
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            placeholder="e.g. 1 Large Truck + 3 Men"
          />
          <div className="grid grid-cols-3 gap-3">
            <Input label="Trucks" type="number" min="1" value={form.trucks} onChange={(e) => setField('trucks', e.target.value)} />
            <Select label="Truck Size" options={truckSizeOptions} value={form.truck_size} onChange={(e) => setField('truck_size', e.target.value as 'small' | 'large')} />
            <Input label="Men" type="number" min="1" value={form.men} onChange={(e) => setField('men', e.target.value)} />
          </div>
          <Input
            label="Rate per hour ($/hr)"
            type="number"
            min="0"
            step="0.01"
            value={form.rate_per_hour}
            onChange={(e) => setField('rate_per_hour', e.target.value)}
            placeholder="0.00"
          />
          <Input
            label="Sort order"
            type="number"
            min="0"
            value={form.sort_order}
            onChange={(e) => setField('sort_order', e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm text-warm cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setField('is_active', e.target.checked)}
              className="rounded border-wire bg-panel text-gold focus:ring-gold-ring"
            />
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
