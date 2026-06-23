'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Customer, BillingType, PercentConfig, RateCardConfig, FormulaConfig } from '@/types/database'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Modal from '@/components/ui/Modal'

const billingOptions = [
  { value: 'ratecard', label: 'Rate Card' },
  { value: 'percent', label: 'Percent of COF' },
  { value: 'formula', label: 'Formula' },
]

function emptyBillingForm() {
  return {
    billing_type: 'ratecard' as BillingType,
    percent: '0.57',
    gst: true,
    rateEntries: [['', '']] as [string, string][],
    extra_men_rate: '',
    extra_note: '',
    expression: '',
    defaults: '{}',
  }
}

function buildBillingConfig(bf: ReturnType<typeof emptyBillingForm>) {
  if (bf.billing_type === 'percent') return { percent: parseFloat(bf.percent) }
  if (bf.billing_type === 'ratecard') {
    const rates: Record<string, number> = {}
    for (const [k, v] of bf.rateEntries) {
      if (k.trim()) rates[k.trim()] = parseFloat(v) || 0
    }
    const cfg: RateCardConfig = { gst: bf.gst, rates }
    if (bf.extra_men_rate.trim()) cfg.extra_men_rate = parseFloat(bf.extra_men_rate) || 0
    if (bf.extra_note.trim()) cfg.extra_note = bf.extra_note.trim()
    return cfg
  }
  let defaults: Record<string, number> = {}
  try { defaults = JSON.parse(bf.defaults) } catch {}
  return { expression: bf.expression, defaults } as FormulaConfig
}

function billingFormFromCustomer(c: Customer): ReturnType<typeof emptyBillingForm> {
  const f = emptyBillingForm()
  if (!c.billing_type || !c.billing_config) return f
  f.billing_type = c.billing_type as BillingType
  if (c.billing_type === 'percent') {
    f.percent = String((c.billing_config as PercentConfig).percent ?? 0.57)
  } else if (c.billing_type === 'ratecard') {
    const cfg = c.billing_config as RateCardConfig
    f.gst = cfg.gst ?? true
    const entries = Object.entries(cfg.rates ?? {}).map(([k, v]) => [k, String(v)] as [string, string])
    f.rateEntries = entries.length > 0 ? entries : [['', '']]
    f.extra_men_rate = cfg.extra_men_rate ? String(cfg.extra_men_rate) : ''
    f.extra_note = cfg.extra_note ?? ''
  } else {
    const cfg = c.billing_config as FormulaConfig
    f.expression = cfg.expression ?? ''
    f.defaults = JSON.stringify(cfg.defaults ?? {}, null, 0)
  }
  return f
}

function billingBadge(type: string) {
  if (type === 'percent') return 'bg-purple-500/10 text-purple-300'
  if (type === 'formula') return 'bg-amber-500/10 text-amber-300'
  return 'bg-blue-500/10 text-blue-300'
}

const inlineInput = 'flex-1 px-3 py-1.5 text-sm border border-wire rounded-lg bg-panel text-parchment focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring'
const checkboxCls = 'rounded border-wire bg-panel text-gold focus:ring-gold-ring'

export default function CustomersPage() {
  const supabase = createClient()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [form, setForm] = useState({ name: '', contact_info: '', phone: '', secondary_contact_name: '', secondary_contact_phone: '', default_addresses: '', notes: '', google_review_bonus: false })
  const [billing, setBilling] = useState(emptyBillingForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  async function fetchCustomers() {
    const { data } = await supabase.from('customers').select('*').order('name')
    setCustomers((data ?? []) as Customer[])
    setLoading(false)
  }

  useEffect(() => { fetchCustomers() }, [])

  function openCreate() {
    setEditing(null)
    setForm({ name: '', contact_info: '', phone: '', secondary_contact_name: '', secondary_contact_phone: '', default_addresses: '', notes: '', google_review_bonus: false })
    setBilling(emptyBillingForm())
    setError('')
    setModalOpen(true)
  }

  function openEdit(c: Customer) {
    setEditing(c)
    setForm({
      name: c.name,
      contact_info: c.contact_info ?? '',
      phone: c.phone ?? '',
      secondary_contact_name: c.secondary_contact_name ?? '',
      secondary_contact_phone: c.secondary_contact_phone ?? '',
      default_addresses: (c.default_addresses ?? []).join('\n'),
      notes: c.notes ?? '',
      google_review_bonus: c.google_review_bonus ?? false,
    })
    setBilling(billingFormFromCustomer(c))
    setError('')
    setModalOpen(true)
  }

  function setBillingField<K extends keyof ReturnType<typeof emptyBillingForm>>(key: K, val: ReturnType<typeof emptyBillingForm>[K]) {
    setBilling((f) => ({ ...f, [key]: val }))
  }

  function updateRateEntry(i: number, col: 0 | 1, val: string) {
    setBilling((f) => {
      const next = f.rateEntries.map((e, j) =>
        j === i ? ([col === 0 ? val : e[0], col === 1 ? val : e[1]] as [string, string]) : e
      )
      return { ...f, rateEntries: next }
    })
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true)
    const addresses = form.default_addresses.trim()
      ? form.default_addresses.split('\n').map((a) => a.trim()).filter(Boolean)
      : null
    const payload = {
      name: form.name.trim(),
      contact_info: form.contact_info.trim() || null,
      phone: form.phone.trim() || null,
      secondary_contact_name: form.secondary_contact_name.trim() || null,
      secondary_contact_phone: form.secondary_contact_phone.trim() || null,
      default_addresses: addresses,
      notes: form.notes.trim() || null,
      billing_type: billing.billing_type,
      billing_config: buildBillingConfig(billing),
      google_review_bonus: form.google_review_bonus,
    }
    if (editing) {
      await supabase.from('customers').update(payload).eq('id', editing.id)
    } else {
      await supabase.from('customers').insert(payload)
    }
    setSaving(false)
    setModalOpen(false)
    fetchCustomers()
  }

  async function handleDelete(c: Customer) {
    if (!confirm(`Delete ${c.name}?`)) return
    await supabase.from('customers').delete().eq('id', c.id)
    setCustomers((prev) => prev.filter((x) => x.id !== c.id))
  }

  const filtered = customers.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.contact_info ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-display font-bold text-parchment">Customers</h1>
        <Button onClick={openCreate} size="sm">
          <Plus size={16} /> Add Customer
        </Button>
      </div>

      <div className="mb-4">
        <Input placeholder="Search by name or contact..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <p className="text-warm">Loading...</p>
      ) : (
        <div className="bg-surface rounded-xl border border-wire overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-panel border-b border-wire">
              <tr>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-dim uppercase tracking-widest">Name</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-dim uppercase tracking-widest hidden sm:table-cell">Contact</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-dim uppercase tracking-widest hidden md:table-cell">Billing</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-wire">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-dim">
                    {search ? 'No customers match your search.' : 'No customers yet.'}
                  </td>
                </tr>
              )}
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-panel transition-colors">
                  <td className="px-4 py-3 font-medium text-parchment">{c.name}</td>
                  <td className="px-4 py-3 text-warm hidden sm:table-cell">{c.contact_info ?? '—'}</td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {c.billing_type && (
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${billingBadge(c.billing_type)}`}>
                        {c.billing_type}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => openEdit(c)} className="text-dim hover:text-gold transition-colors" aria-label="Edit"><Pencil size={15} /></button>
                      <button onClick={() => handleDelete(c)} className="text-dim hover:text-danger transition-colors" aria-label="Delete"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Customer' : 'New Customer'}>
        <div className="space-y-4">
          <Input label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. John Smith" />
          <label className="flex items-center gap-2 text-sm font-medium text-warm cursor-pointer">
            <input type="checkbox" checked={form.google_review_bonus} onChange={(e) => setForm((f) => ({ ...f, google_review_bonus: e.target.checked }))} className={checkboxCls} />
            Google Review Bonus eligible
          </label>

          <div className="border-t border-wire pt-3">
            <p className="text-xs font-semibold text-dim uppercase tracking-wide mb-3">Contact</p>
            <Input label="Phone *" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="0412 345 678" />
          </div>

          <div>
            <p className="text-xs font-medium text-dim mb-2">Secondary Contact <span className="font-normal text-dim">(optional)</span></p>
            <div className="grid grid-cols-2 gap-2">
              <Input label="Name" value={form.secondary_contact_name} onChange={(e) => setForm((f) => ({ ...f, secondary_contact_name: e.target.value }))} placeholder="e.g. Jack, husband" />
              <Input label="Phone" value={form.secondary_contact_phone} onChange={(e) => setForm((f) => ({ ...f, secondary_contact_phone: e.target.value }))} placeholder="0412 345 679" />
            </div>
          </div>

          <Input label="Contact info (email / other)" value={form.contact_info} onChange={(e) => setForm((f) => ({ ...f, contact_info: e.target.value }))} placeholder="john@example.com" />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-dim uppercase tracking-wide">Default addresses (one per line)</label>
            <textarea
              rows={2}
              value={form.default_addresses}
              onChange={(e) => setForm((f) => ({ ...f, default_addresses: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-wire rounded-lg bg-panel text-parchment focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
              placeholder="123 Main St, Sydney NSW 2000"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-dim uppercase tracking-wide">Notes</label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-wire rounded-lg bg-panel text-parchment focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
            />
          </div>

          <div className="border-t border-wire pt-4">
            <p className="text-xs font-semibold text-dim uppercase tracking-wide mb-3">Billing</p>

            <Select label="Billing Type" options={billingOptions} value={billing.billing_type} onChange={(e) => setBillingField('billing_type', e.target.value as BillingType)} />

            {billing.billing_type === 'percent' && (
              <div className="mt-3">
                <Input label="Percent (e.g. 0.57 = 57%)" type="number" step="0.01" min="0" max="1" value={billing.percent} onChange={(e) => setBillingField('percent', e.target.value)} />
              </div>
            )}

            {billing.billing_type === 'ratecard' && (
              <div className="mt-3 space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium text-warm cursor-pointer">
                  <input type="checkbox" checked={billing.gst} onChange={(e) => setBillingField('gst', e.target.checked)} className={checkboxCls} />
                  Include GST (10%)
                </label>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-dim uppercase tracking-wide">Rates</label>
                    <button type="button" onClick={() => setBillingField('rateEntries', [...billing.rateEntries, ['', '']])} className="text-xs text-gold hover:text-gold-bright font-medium transition-colors">+ Add rate</button>
                  </div>
                  <div className="space-y-1.5">
                    {billing.rateEntries.map(([key, val], i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <input type="text" value={key} onChange={(e) => updateRateEntry(i, 0, e.target.value)} placeholder="e.g. 3 Men + Truck" className={inlineInput} />
                        <input type="number" value={val} onChange={(e) => updateRateEntry(i, 1, e.target.value)} placeholder="0.00" className="w-24 px-3 py-1.5 text-sm border border-wire rounded-lg bg-panel text-parchment focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring" />
                        <button type="button" onClick={() => setBillingField('rateEntries', billing.rateEntries.filter((_, j) => j !== i))} className="text-dim hover:text-danger shrink-0 transition-colors" aria-label="Remove"><X size={15} /></button>
                      </div>
                    ))}
                  </div>
                </div>
                <Input label="Extra Men Rate ($/hr, optional)" type="number" step="0.01" min="0" value={billing.extra_men_rate} onChange={(e) => setBillingField('extra_men_rate', e.target.value)} placeholder="0.00" />
              </div>
            )}

            {billing.billing_type === 'formula' && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-dim uppercase tracking-wide">Expression</label>
                  <p className="text-xs text-dim">Built-ins: gst(1.10), cof, additionalHours, additionalRate, extraMenHours, breakHours</p>
                  <textarea rows={2} value={billing.expression} onChange={(e) => setBillingField('expression', e.target.value)} className="w-full px-3 py-2 text-sm border border-wire rounded-lg bg-panel text-parchment focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring font-mono" placeholder="(cof + additionalHours) * additionalRate * gst" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-dim uppercase tracking-wide">Defaults (JSON)</label>
                  <textarea rows={2} value={billing.defaults} onChange={(e) => setBillingField('defaults', e.target.value)} className="w-full px-3 py-2 text-sm border border-wire rounded-lg bg-panel text-parchment focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring font-mono" placeholder='{"hourlyRate": 50}' />
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving} className="flex-1">{saving ? 'Saving...' : 'Save'}</Button>
            <Button variant="secondary" onClick={() => setModalOpen(false)} className="flex-1">Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
