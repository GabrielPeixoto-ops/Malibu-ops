'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Subcontractor, SubcontractorRate, BillingType, PercentConfig, RateCardConfig, FormulaConfig } from '@/types/database'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Modal from '@/components/ui/Modal'

const billingOptions = [
  { value: 'percent', label: 'Percent of COF' },
  { value: 'ratecard', label: 'Rate Card' },
  { value: 'formula', label: 'Formula' },
]

const COLOR_SWATCHES = ['#D4AF37', '#EC4899', '#60A5FA', '#4ADE80', '#F97316', '#A855F7', '#F43F5E', '#22D3EE', '#6B6660']

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {COLOR_SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          title={c}
          onClick={() => onChange(c)}
          className={`w-6 h-6 rounded-full shrink-0 transition-all ${value === c ? 'ring-2 ring-offset-1 ring-offset-panel ring-parchment scale-110' : 'hover:scale-110'}`}
          style={{ background: c }}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title="Custom color"
        className="w-7 h-6 rounded cursor-pointer border border-wire bg-transparent p-0"
      />
    </div>
  )
}

function emptyForm() {
  return {
    name: '',
    billing_type: 'percent' as BillingType,
    percent: '0.57',
    gst: true,
    rateEntries: [['', '']] as [string, string][],
    extra_men_rate: '',
    extra_note: '',
    expression: '',
    defaults: '{}',
    google_review_bonus: false,
    color_hex: '#6B6660',
  }
}

function buildConfig(form: ReturnType<typeof emptyForm>) {
  if (form.billing_type === 'percent') {
    return { percent: parseFloat(form.percent) }
  }
  if (form.billing_type === 'ratecard') {
    const rates: Record<string, number> = {}
    for (const [k, v] of form.rateEntries) {
      if (k.trim()) rates[k.trim()] = parseFloat(v) || 0
    }
    const cfg: RateCardConfig = { gst: form.gst, rates }
    if (form.extra_men_rate.trim()) cfg.extra_men_rate = parseFloat(form.extra_men_rate) || 0
    if (form.extra_note.trim()) cfg.extra_note = form.extra_note.trim()
    return cfg
  }
  let defaults: Record<string, number> = {}
  try { defaults = JSON.parse(form.defaults) } catch {}
  return { expression: form.expression, defaults } as FormulaConfig
}

function formFromSub(sub: Subcontractor): ReturnType<typeof emptyForm> {
  const f = emptyForm()
  f.name = sub.name
  f.billing_type = sub.billing_type
  f.google_review_bonus = sub.google_review_bonus ?? false
  f.color_hex = sub.color_hex ?? '#6B6660'
  if (sub.billing_type === 'percent') {
    f.percent = String((sub.config as PercentConfig).percent)
  } else if (sub.billing_type === 'ratecard') {
    const c = sub.config as RateCardConfig
    f.gst = c.gst
    const entries = Object.entries(c.rates).map(([k, v]) => [k, String(v)] as [string, string])
    f.rateEntries = entries.length > 0 ? entries : [['', '']]
    f.extra_men_rate = c.extra_men_rate ? String(c.extra_men_rate) : ''
    f.extra_note = c.extra_note ?? ''
  } else {
    const c = sub.config as FormulaConfig
    f.expression = c.expression
    f.defaults = JSON.stringify(c.defaults, null, 0)
  }
  return f
}

function billingBadge(type: BillingType) {
  const map = {
    percent: 'bg-purple-500/10 text-purple-300',
    ratecard: 'bg-blue-500/10 text-blue-300',
    formula: 'bg-amber-500/10 text-amber-300',
  }
  return map[type]
}

const inlineInput = 'flex-1 px-3 py-1.5 text-sm border border-wire rounded-lg bg-panel text-parchment focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring'
const checkboxCls = 'rounded border-wire bg-panel text-gold focus:ring-gold-ring'

export default function SubcontractorsPage() {
  const supabase = createClient()
  const [subs, setSubs] = useState<Subcontractor[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Subcontractor | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [subRates, setSubRates] = useState<SubcontractorRate[]>([])
  const [newRateName, setNewRateName] = useState('')
  const [newRatePH, setNewRatePH] = useState('')
  const [addingRate, setAddingRate] = useState(false)
  const [editingRateId, setEditingRateId] = useState<string | null>(null)
  const [editRateName, setEditRateName] = useState('')
  const [editRatePH, setEditRatePH] = useState('')

  async function fetchSubs() {
    const { data } = await supabase.from('subcontractors').select('*').order('name')
    setSubs((data ?? []) as Subcontractor[])
    setLoading(false)
  }

  useEffect(() => { fetchSubs() }, [])

  function ratesFromSub(sub: Subcontractor): SubcontractorRate[] {
    if (sub.billing_type !== 'ratecard') return []
    const cfg = sub.config as RateCardConfig
    return (cfg.rateList ?? []).map((r, i) => ({
      id: r.id,
      subcontractor_id: sub.id,
      name: r.name,
      rate_per_hour: r.rate_per_hour,
      is_active: true,
      sort_order: i,
    }))
  }

  function applyRateList(newList: Array<{ id: string; name: string; rate_per_hour: number }>) {
    if (!editing) return
    const updatedSub = { ...editing, config: { ...(editing.config as RateCardConfig), rateList: newList } } as Subcontractor
    setEditing(updatedSub)
    setSubRates(ratesFromSub(updatedSub))
  }

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setSubRates([])
    setNewRateName('')
    setNewRatePH('')
    setError('')
    setModalOpen(true)
  }

  function openEdit(sub: Subcontractor) {
    setEditing(sub)
    setForm(formFromSub(sub))
    setSubRates(ratesFromSub(sub))
    setNewRateName('')
    setNewRatePH('')
    setEditingRateId(null)
    setError('')
    setModalOpen(true)
  }

  function handleAddRate() {
    if (!newRateName.trim() || !newRatePH || !editing) return
    const cfg = editing.config as RateCardConfig
    const newRate = { id: crypto.randomUUID(), name: newRateName.trim(), rate_per_hour: parseFloat(newRatePH) || 0 }
    applyRateList([...(cfg.rateList ?? []), newRate])
    setNewRateName('')
    setNewRatePH('')
  }

  function handleDeleteRate(rateId: string) {
    if (!editing) return
    if (!confirm('Delete this rate?')) return
    const cfg = editing.config as RateCardConfig
    applyRateList((cfg.rateList ?? []).filter((r) => r.id !== rateId))
  }

  function handleUpdateRate(rateId: string) {
    if (!editRateName.trim() || !editRatePH || !editing) return
    const cfg = editing.config as RateCardConfig
    applyRateList((cfg.rateList ?? []).map((r) =>
      r.id === rateId ? { ...r, name: editRateName.trim(), rate_per_hour: parseFloat(editRatePH) || 0 } : r
    ))
    setEditingRateId(null)
  }

  function setField<K extends keyof ReturnType<typeof emptyForm>>(key: K, val: ReturnType<typeof emptyForm>[K]) {
    setForm((f) => ({ ...f, [key]: val }))
  }

  function updateRateEntry(i: number, col: 0 | 1, val: string) {
    setForm((f) => {
      const next = f.rateEntries.map((e, j) =>
        j === i ? ([col === 0 ? val : e[0], col === 1 ? val : e[1]] as [string, string]) : e
      )
      return { ...f, rateEntries: next }
    })
  }

  function addRateEntry() {
    setField('rateEntries', [...form.rateEntries, ['', '']])
  }

  function removeRateEntry(i: number) {
    setField('rateEntries', form.rateEntries.filter((_, j) => j !== i))
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true)
    const baseConfig = buildConfig(form)
    const config = form.billing_type === 'ratecard'
      ? { ...baseConfig, rateList: subRates.map((r) => ({ id: r.id, name: r.name, rate_per_hour: r.rate_per_hour })) }
      : baseConfig
    const payload = {
      name: form.name.trim(),
      billing_type: form.billing_type,
      config,
      google_review_bonus: form.google_review_bonus,
      color_hex: form.color_hex || '#6B6660',
    }
    let dbError
    if (editing) {
      const { error } = await supabase.from('subcontractors').update(payload).eq('id', editing.id)
      dbError = error
    } else {
      const { error } = await supabase.from('subcontractors').insert(payload)
      dbError = error
    }
    setSaving(false)
    if (dbError) {
      setError(dbError.message)
      return
    }
    setModalOpen(false)
    fetchSubs()
  }

  async function handleDelete(sub: Subcontractor) {
    if (!confirm(`Delete ${sub.name}?`)) return
    await supabase.from('subcontractors').delete().eq('id', sub.id)
    fetchSubs()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-display font-bold text-parchment">Subcontractors</h1>
        <Button onClick={openCreate} size="sm">
          <Plus size={16} /> Add Subcontractor
        </Button>
      </div>

      {loading ? (
        <p className="text-warm">Loading...</p>
      ) : (
        <div className="bg-surface rounded-xl border border-wire overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-panel border-b border-wire">
              <tr>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-dim uppercase tracking-widest">Name</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-dim uppercase tracking-widest">Billing</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-dim uppercase tracking-widest hidden sm:table-cell">Config summary</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-wire">
              {subs.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-dim">No subcontractors yet.</td>
                </tr>
              )}
              {subs.map((sub) => (
                <tr key={sub.id} className="hover:bg-panel transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ background: sub.color_hex ?? '#6B6660' }} />
                      <span className="font-medium text-parchment">{sub.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${billingBadge(sub.billing_type)}`}>
                      {sub.billing_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-dim text-xs hidden sm:table-cell">
                    {sub.billing_type === 'percent' && `${parseFloat(((sub.config as PercentConfig).percent * 100).toFixed(1))}%`}
                    {sub.billing_type === 'ratecard' && (() => {
                      const c = sub.config as RateCardConfig
                      if (!c?.rates) return ''
                      const rateStr = Object.entries(c.rates).map(([k, v]) => `${k}: $${v}`).join(' · ')
                      return c.extra_men_rate ? `${rateStr} · extra: $${c.extra_men_rate}/hr` : rateStr
                    })()}
                    {sub.billing_type === 'formula' && (sub.config as FormulaConfig).expression}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => openEdit(sub)} className="text-dim hover:text-gold transition-colors" aria-label="Edit">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => handleDelete(sub)} className="text-dim hover:text-danger transition-colors" aria-label="Delete">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Subcontractor' : 'New Subcontractor'}>
        <div className="space-y-4">
          <Input label="Name" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="e.g. TMAAT" />

          <div>
            <label className="text-xs font-semibold text-dim uppercase tracking-wide block mb-2">Card Color (Dashboard)</label>
            <div className="flex items-center gap-3">
              <span className="w-6 h-6 rounded-full shrink-0 border border-wire" style={{ background: form.color_hex }} />
              <ColorPicker value={form.color_hex} onChange={(c) => setField('color_hex', c)} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium text-warm cursor-pointer">
            <input type="checkbox" checked={form.google_review_bonus} onChange={(e) => setField('google_review_bonus', e.target.checked)} className={checkboxCls} />
            Google Review Bonus eligible
          </label>

          <Select
            label="Billing Type"
            options={billingOptions}
            value={form.billing_type}
            onChange={(e) => setField('billing_type', e.target.value as BillingType)}
          />

          {form.billing_type === 'percent' && (
            <Input
              label="Percent (e.g. 0.575 = 57.5%)"
              type="number"
              step="0.001"
              min="0"
              max="1"
              value={form.percent}
              onChange={(e) => setField('percent', e.target.value)}
            />
          )}

          {form.billing_type === 'ratecard' && (
            <>
              <label className="flex items-center gap-2 text-sm font-medium text-warm cursor-pointer">
                <input type="checkbox" checked={form.gst} onChange={(e) => setField('gst', e.target.checked)} className={checkboxCls} />
                Include GST (10%)
              </label>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-dim uppercase tracking-wide">Rates</label>
                  <button type="button" onClick={addRateEntry} className="text-xs text-gold hover:text-gold-bright font-medium transition-colors">
                    + Add rate
                  </button>
                </div>
                <div className="space-y-1.5">
                  {form.rateEntries.map(([key, val], i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input
                        type="text"
                        value={key}
                        onChange={(e) => updateRateEntry(i, 0, e.target.value)}
                        placeholder="e.g. 3 Men + Large Truck"
                        className={inlineInput}
                      />
                      <input
                        type="number"
                        value={val}
                        onChange={(e) => updateRateEntry(i, 1, e.target.value)}
                        placeholder="0.00"
                        className="w-24 px-3 py-1.5 text-sm border border-wire rounded-lg bg-panel text-parchment focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
                      />
                      <button
                        type="button"
                        onClick={() => removeRateEntry(i)}
                        className="text-dim hover:text-danger shrink-0 transition-colors"
                        aria-label="Remove rate"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <Input
                label="Extra Men Rate ($/hr, optional)"
                type="number"
                step="0.01"
                min="0"
                value={form.extra_men_rate}
                onChange={(e) => setField('extra_men_rate', e.target.value)}
                placeholder="0.00"
              />
              <Input
                label="Extra note (optional)"
                value={form.extra_note}
                onChange={(e) => setField('extra_note', e.target.value)}
                placeholder="e.g. Large truck: $140 + GST"
              />
            </>
          )}

          {form.billing_type === 'formula' && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-dim uppercase tracking-wide">Expression</label>
                <p className="text-xs text-dim">Built-ins: gst(1.10), cof, additionalHours, additionalRate, extraMenHours, breakHours</p>
                <textarea
                  rows={2}
                  value={form.expression}
                  onChange={(e) => setField('expression', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-wire rounded-lg bg-panel text-parchment focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring font-mono"
                  placeholder="(firstHour + extraHours*hourlyRate) * 0.75 * gst"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-dim uppercase tracking-wide">Defaults (JSON)</label>
                <textarea
                  rows={2}
                  value={form.defaults}
                  onChange={(e) => setField('defaults', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-wire rounded-lg bg-panel text-parchment focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring font-mono"
                  placeholder='{"firstHour": 250, "hourlyRate": 50}'
                />
              </div>
            </>
          )}


          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving} className="flex-1">
              {saving ? 'Saving...' : 'Save'}
            </Button>
            <Button variant="secondary" onClick={() => setModalOpen(false)} className="flex-1">
              Cancel
            </Button>
          </div>

          {editing && form.billing_type === 'ratecard' && (
            <div className="border-t border-wire pt-4 mt-2">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-parchment">Rates</h3>
                <span className="text-xs text-dim">rate × worked hours = revenue</span>
              </div>
              <div className="space-y-1 mb-3">
                {subRates.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 bg-panel rounded-lg">
                    {editingRateId === r.id ? (
                      <>
                        <input
                          type="text"
                          value={editRateName}
                          onChange={(e) => setEditRateName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleUpdateRate(r.id)}
                          className={`${inlineInput} flex-1`}
                          autoFocus
                        />
                        <input
                          type="number"
                          value={editRatePH}
                          onChange={(e) => setEditRatePH(e.target.value)}
                          className="w-20 px-2 py-1 text-sm border border-wire rounded-lg bg-surface text-parchment focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
                        />
                        <Button size="sm" onClick={() => handleUpdateRate(r.id)}>Save</Button>
                        <button onClick={() => setEditingRateId(null)} className="text-dim hover:text-warm transition-colors"><X size={14} /></button>
                      </>
                    ) : (
                      <>
                        <div className="flex-1">
                          <span className="text-sm text-parchment">{r.name}</span>
                          <span className="ml-2 text-xs font-mono text-dim">${r.rate_per_hour}/hr</span>
                        </div>
                        <button
                          onClick={() => { setEditingRateId(r.id); setEditRateName(r.name); setEditRatePH(String(r.rate_per_hour)) }}
                          className="text-dim hover:text-gold transition-colors"
                          aria-label="Edit rate"
                        >
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => handleDeleteRate(r.id)} className="text-dim hover:text-danger transition-colors" aria-label="Delete rate">
                          <X size={14} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {subRates.length === 0 && <p className="text-xs text-dim">No rates yet.</p>}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newRateName}
                  onChange={(e) => setNewRateName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddRate()}
                  placeholder="Rate name (e.g. 2 Men + Truck)"
                  className={inlineInput}
                />
                <input
                  type="number"
                  value={newRatePH}
                  onChange={(e) => setNewRatePH(e.target.value)}
                  placeholder="$/hr"
                  className="w-20 px-3 py-1.5 text-sm border border-wire rounded-lg bg-panel text-parchment focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
                />
                <Button size="sm" onClick={handleAddRate} disabled={!newRateName.trim() || !newRatePH || addingRate}>
                  {addingRate ? '…' : 'Add'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
