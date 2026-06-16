'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Subcontractor, BillingType, PercentConfig, RateCardConfig, FormulaConfig } from '@/types/database'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Modal from '@/components/ui/Modal'

const billingOptions = [
  { value: 'percent', label: 'Percent of COF' },
  { value: 'ratecard', label: 'Rate Card' },
  { value: 'formula', label: 'Formula' },
]

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
  const map = { percent: 'bg-purple-100 text-purple-700', ratecard: 'bg-blue-100 text-blue-700', formula: 'bg-amber-100 text-amber-700' }
  return map[type]
}

export default function SubcontractorsPage() {
  const supabase = createClient()
  const [subs, setSubs] = useState<Subcontractor[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Subcontractor | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function fetchSubs() {
    const { data } = await supabase.from('subcontractors').select('*').order('name')
    setSubs((data ?? []) as Subcontractor[])
    setLoading(false)
  }

  useEffect(() => { fetchSubs() }, [])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setError('')
    setModalOpen(true)
  }

  function openEdit(sub: Subcontractor) {
    setEditing(sub)
    setForm(formFromSub(sub))
    setError('')
    setModalOpen(true)
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
    const payload = { name: form.name.trim(), billing_type: form.billing_type, config: buildConfig(form), google_review_bonus: form.google_review_bonus }
    if (editing) {
      await supabase.from('subcontractors').update(payload).eq('id', editing.id)
    } else {
      await supabase.from('subcontractors').insert(payload)
    }
    setSaving(false)
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
        <h1 className="text-2xl font-bold text-gray-900">Subcontractors</h1>
        <Button onClick={openCreate} size="sm">
          <Plus size={16} /> Add Subcontractor
        </Button>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Billing</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Config summary</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {subs.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-400">No subcontractors yet.</td>
                </tr>
              )}
              {subs.map((sub) => (
                <tr key={sub.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{sub.name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${billingBadge(sub.billing_type)}`}>
                      {sub.billing_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs hidden sm:table-cell">
                    {sub.billing_type === 'percent' && `${((sub.config as PercentConfig).percent * 100).toFixed(0)}%`}
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
                      <button onClick={() => openEdit(sub)} className="text-gray-400 hover:text-blue-600" aria-label="Edit">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => handleDelete(sub)} className="text-gray-400 hover:text-red-600" aria-label="Delete">
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

          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
            <input type="checkbox" checked={form.google_review_bonus} onChange={(e) => setField('google_review_bonus', e.target.checked)} className="rounded" />
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
              label="Percent (e.g. 0.57 = 57%)"
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={form.percent}
              onChange={(e) => setField('percent', e.target.value)}
            />
          )}

          {form.billing_type === 'ratecard' && (
            <>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                <input type="checkbox" checked={form.gst} onChange={(e) => setField('gst', e.target.checked)} className="rounded" />
                Include GST (10%)
              </label>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-gray-700">Rates</label>
                  <button
                    type="button"
                    onClick={addRateEntry}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
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
                        className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <input
                        type="number"
                        value={val}
                        onChange={(e) => updateRateEntry(i, 1, e.target.value)}
                        placeholder="0.00"
                        className="w-24 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => removeRateEntry(i)}
                        className="text-gray-300 hover:text-red-500 shrink-0"
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
                <label className="text-sm font-medium text-gray-700">Expression</label>
                <p className="text-xs text-gray-400">
                  Built-ins: gst(1.10), cof, additionalHours, additionalRate, extraMenHours, breakHours
                </p>
                <textarea
                  rows={2}
                  value={form.expression}
                  onChange={(e) => setField('expression', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  placeholder="(firstHour + extraHours*hourlyRate) * 0.75 * gst"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Defaults (JSON)</label>
                <textarea
                  rows={2}
                  value={form.defaults}
                  onChange={(e) => setField('defaults', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  placeholder='{"firstHour": 250, "hourlyRate": 50}'
                />
              </div>
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving} className="flex-1">
              {saving ? 'Saving...' : 'Save'}
            </Button>
            <Button variant="secondary" onClick={() => setModalOpen(false)} className="flex-1">
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
