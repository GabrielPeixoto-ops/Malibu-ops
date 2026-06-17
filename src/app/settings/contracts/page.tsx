'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, X, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Contract, ContractClient, ContractRate, BillingType, PercentConfig, RateCardConfig, FormulaConfig } from '@/types/database'
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
    billing_type: 'ratecard' as BillingType,
    percent: '0.57',
    gst: true,
    rateEntries: [['', '']] as [string, string][],
    extra_men_rate: '',
    extra_note: '',
    expression: '',
    defaults: '{}',
    google_review_bonus: false,
    client_company_name: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    start_date: '',
    end_date: '',
    payment_terms: '',
    notes: '',
    is_active: true,
  }
}

function buildBillingConfig(form: ReturnType<typeof emptyForm>) {
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

function formFromContract(c: Contract): ReturnType<typeof emptyForm> {
  const f = emptyForm()
  f.name = c.name
  f.billing_type = c.billing_type as BillingType
  f.google_review_bonus = c.google_review_bonus ?? false
  f.client_company_name = c.client_company_name ?? ''
  f.contact_name = c.contact_name ?? ''
  f.contact_email = c.contact_email ?? ''
  f.contact_phone = c.contact_phone ?? ''
  f.start_date = c.start_date ?? ''
  f.end_date = c.end_date ?? ''
  f.payment_terms = c.payment_terms ?? ''
  f.notes = c.notes ?? ''
  f.is_active = c.is_active ?? true
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
  const map: Record<string, string> = {
    percent: 'bg-purple-100 text-purple-700',
    ratecard: 'bg-blue-100 text-blue-700',
    formula: 'bg-amber-100 text-amber-700',
  }
  return map[type] ?? 'bg-gray-100 text-gray-600'
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-gray-200 pt-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{title}</p>
      {children}
    </div>
  )
}

export default function ContractsPage() {
  const supabase = createClient()
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Contract | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [clients, setClients] = useState<ContractClient[]>([])
  const [newClientName, setNewClientName] = useState('')
  const [addingClient, setAddingClient] = useState(false)
  const [contractRates, setContractRates] = useState<ContractRate[]>([])
  const [newRateName, setNewRateName] = useState('')
  const [newRatePH, setNewRatePH] = useState('')
  const [addingRate, setAddingRate] = useState(false)

  async function fetchContracts() {
    const { data } = await supabase.from('contracts').select('*').order('name')
    setContracts((data ?? []) as unknown as Contract[])
    setLoading(false)
  }

  async function fetchClients(contractId: string) {
    const { data } = await supabase.from('contract_clients').select('*').eq('contract_id', contractId).order('name')
    setClients((data ?? []) as ContractClient[])
  }

  async function fetchContractRates(contractId: string) {
    const { data } = await supabase.from('contract_rates').select('*').eq('contract_id', contractId).order('sort_order')
    setContractRates((data ?? []) as ContractRate[])
  }

  useEffect(() => { fetchContracts() }, [])

  function setField<K extends keyof ReturnType<typeof emptyForm>>(key: K, val: ReturnType<typeof emptyForm>[K]) {
    setForm((f) => ({ ...f, [key]: val }))
  }

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setClients([])
    setNewClientName('')
    setContractRates([])
    setNewRateName('')
    setNewRatePH('')
    setError('')
    setModalOpen(true)
  }

  function openEdit(c: Contract) {
    setEditing(c)
    setForm(formFromContract(c))
    setClients([])
    setNewClientName('')
    setContractRates([])
    setNewRateName('')
    setNewRatePH('')
    setError('')
    setModalOpen(true)
    fetchClients(c.id)
    fetchContractRates(c.id)
  }

  async function handleAddContractRate() {
    if (!newRateName.trim() || !newRatePH || !editing) return
    setAddingRate(true)
    await supabase.from('contract_rates').insert({
      contract_id: editing.id,
      name: newRateName.trim(),
      rate_per_hour: parseFloat(newRatePH),
      is_active: true,
      sort_order: contractRates.length,
    })
    setNewRateName('')
    setNewRatePH('')
    setAddingRate(false)
    fetchContractRates(editing.id)
  }

  async function handleDeleteContractRate(rateId: string) {
    if (!editing) return
    await supabase.from('contract_rates').delete().eq('id', rateId)
    fetchContractRates(editing.id)
  }

  function updateRateEntry(i: number, col: 0 | 1, val: string) {
    setForm((f) => {
      const next = f.rateEntries.map((e, j) =>
        j === i ? ([col === 0 ? val : e[0], col === 1 ? val : e[1]] as [string, string]) : e
      )
      return { ...f, rateEntries: next }
    })
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')
    const payload = {
      name: form.name.trim(),
      billing_type: form.billing_type,
      billing_config: buildBillingConfig(form),
      google_review_bonus: form.google_review_bonus,
      client_company_name: form.client_company_name.trim() || null,
      contact_name: form.contact_name.trim() || null,
      contact_email: form.contact_email.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      payment_terms: form.payment_terms.trim() || null,
      notes: form.notes.trim() || null,
      is_active: form.is_active,
    }
    if (editing) {
      await supabase.from('contracts').update(payload).eq('id', editing.id)
    } else {
      await supabase.from('contracts').insert(payload)
    }
    setSaving(false)
    setModalOpen(false)
    fetchContracts()
  }

  async function handleDelete(c: Contract) {
    if (!confirm(`Delete contract "${c.name}"? This will also delete all its clients.`)) return
    await supabase.from('contracts').delete().eq('id', c.id)
    setContracts((prev) => prev.filter((x) => x.id !== c.id))
  }

  async function handleAddClient() {
    if (!newClientName.trim() || !editing) return
    setAddingClient(true)
    await supabase.from('contract_clients').insert({ contract_id: editing.id, name: newClientName.trim() })
    setNewClientName('')
    setAddingClient(false)
    fetchClients(editing.id)
  }

  async function handleDeleteClient(client: ContractClient) {
    if (!editing) return
    await supabase.from('contract_clients').delete().eq('id', client.id)
    fetchClients(editing.id)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Contracts</h1>
        <Button onClick={openCreate} size="sm">
          <Plus size={16} /> Add Contract
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
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Contact</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Billing</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">Start date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {contracts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">No contracts yet.</td>
                </tr>
              )}
              {contracts.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{c.name}</div>
                    {c.client_company_name && <div className="text-xs text-gray-400">{c.client_company_name}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs hidden md:table-cell">
                    {c.contact_name && <div>{c.contact_name}</div>}
                    {c.contact_phone && <div>{c.contact_phone}</div>}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${billingBadge(c.billing_type)}`}>
                      {c.billing_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 hidden lg:table-cell">{c.start_date ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${(c.is_active ?? true) ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {(c.is_active ?? true) ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => openEdit(c)} className="text-gray-400 hover:text-blue-600"><Pencil size={15} /></button>
                      <button onClick={() => handleDelete(c)} className="text-gray-400 hover:text-red-600"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit: ${editing.name}` : 'New Contract'}>
        <div className="space-y-4">
          {/* ── General ─────────────────────────────────────────────────────── */}
          <Input label="Contract name" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="e.g. Two Men And A Truck" />
          <div className="flex gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setField('is_active', e.target.checked)} className="rounded" />
              Active
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
              <input type="checkbox" checked={form.google_review_bonus} onChange={(e) => setField('google_review_bonus', e.target.checked)} className="rounded" />
              Google Review Bonus
            </label>
          </div>

          {/* ── Contact ─────────────────────────────────────────────────────── */}
          <Section title="Contact">
            <div className="space-y-3">
              <Input label="Company name" value={form.client_company_name} onChange={(e) => setField('client_company_name', e.target.value)} placeholder="Acme Pty Ltd" />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Contact name" value={form.contact_name} onChange={(e) => setField('contact_name', e.target.value)} placeholder="John Smith" />
                <Input label="Phone" value={form.contact_phone} onChange={(e) => setField('contact_phone', e.target.value)} placeholder="0412 345 678" />
              </div>
              <Input label="Email" type="email" value={form.contact_email} onChange={(e) => setField('contact_email', e.target.value)} placeholder="john@acme.com" />
            </div>
          </Section>

          {/* ── Dates ───────────────────────────────────────────────────────── */}
          <Section title="Term">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Start date" type="date" value={form.start_date} onChange={(e) => setField('start_date', e.target.value)} />
              <Input label="End date" type="date" value={form.end_date} onChange={(e) => setField('end_date', e.target.value)} />
            </div>
            <div className="mt-3">
              <Input label="Payment terms" value={form.payment_terms} onChange={(e) => setField('payment_terms', e.target.value)} placeholder="e.g. Net 30" />
            </div>
          </Section>

          {/* ── Billing ─────────────────────────────────────────────────────── */}
          <Section title="Billing">
            <Select label="Billing Type" options={billingOptions} value={form.billing_type} onChange={(e) => setField('billing_type', e.target.value as BillingType)} />

            {form.billing_type === 'percent' && (
              <div className="mt-3">
                <Input label="Percent (e.g. 0.57 = 57%)" type="number" step="0.01" min="0" max="1" value={form.percent} onChange={(e) => setField('percent', e.target.value)} />
              </div>
            )}

            {form.billing_type === 'ratecard' && (
              <div className="mt-3 space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={form.gst} onChange={(e) => setField('gst', e.target.checked)} className="rounded" />
                  Include GST (10%)
                </label>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium text-gray-700">Rates</label>
                    <button type="button" onClick={() => setField('rateEntries', [...form.rateEntries, ['', '']])} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ Add rate</button>
                  </div>
                  <div className="space-y-1.5">
                    {form.rateEntries.map(([key, val], i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <input type="text" value={key} onChange={(e) => updateRateEntry(i, 0, e.target.value)} placeholder="e.g. 3 Men + Large Truck" className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        <input type="number" value={val} onChange={(e) => updateRateEntry(i, 1, e.target.value)} placeholder="0.00" className="w-24 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        <button type="button" onClick={() => setField('rateEntries', form.rateEntries.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-500 shrink-0" aria-label="Remove"><X size={15} /></button>
                      </div>
                    ))}
                  </div>
                </div>
                <Input label="Extra Men Rate ($/hr, optional)" type="number" step="0.01" min="0" value={form.extra_men_rate} onChange={(e) => setField('extra_men_rate', e.target.value)} placeholder="0.00" />
                <Input label="Extra note (optional)" value={form.extra_note} onChange={(e) => setField('extra_note', e.target.value)} placeholder="e.g. Large truck: $140 + GST" />
              </div>
            )}

            {form.billing_type === 'formula' && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">Expression</label>
                  <p className="text-xs text-gray-400">Built-ins: gst(1.10), cof, additionalHours, additionalRate, extraMenHours, breakHours</p>
                  <textarea rows={2} value={form.expression} onChange={(e) => setField('expression', e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" placeholder="(cof + additionalHours) * additionalRate * gst" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">Defaults (JSON)</label>
                  <textarea rows={2} value={form.defaults} onChange={(e) => setField('defaults', e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" placeholder='{"hourlyRate": 50}' />
                </div>
              </div>
            )}
          </Section>

          {/* ── Notes ───────────────────────────────────────────────────────── */}
          <Section title="Notes">
            <textarea rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder="Internal notes…" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </Section>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving} className="flex-1">{saving ? 'Saving...' : 'Save'}</Button>
            <Button variant="secondary" onClick={() => setModalOpen(false)} className="flex-1">Cancel</Button>
          </div>

          {/* ── Rates ───────────────────────────────────────────────────────── */}
          {editing && (
            <div className="border-t border-gray-200 pt-4 mt-2">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">Rates</h3>
                <span className="text-xs text-gray-400">rate × COF hours = revenue</span>
              </div>
              <div className="space-y-1 mb-3">
                {contractRates.map((r) => (
                  <div key={r.id} className="flex items-center justify-between px-3 py-1.5 bg-gray-50 rounded-lg">
                    <div>
                      <span className="text-sm text-gray-700">{r.name}</span>
                      <span className="ml-2 text-xs text-gray-400">${r.rate_per_hour}/hr</span>
                    </div>
                    <button onClick={() => handleDeleteContractRate(r.id)} className="text-gray-300 hover:text-red-500"><X size={14} /></button>
                  </div>
                ))}
                {contractRates.length === 0 && <p className="text-xs text-gray-400">No rates yet.</p>}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newRateName}
                  onChange={(e) => setNewRateName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddContractRate()}
                  placeholder="Rate name (e.g. 2 Men + Truck)"
                  className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="number"
                  value={newRatePH}
                  onChange={(e) => setNewRatePH(e.target.value)}
                  placeholder="$/hr"
                  className="w-20 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Button size="sm" onClick={handleAddContractRate} disabled={!newRateName.trim() || !newRatePH || addingRate}>
                  {addingRate ? '…' : 'Add'}
                </Button>
              </div>
            </div>
          )}

          {/* ── Clients ─────────────────────────────────────────────────────── */}
          {editing && (
            <div className="border-t border-gray-200 pt-4 mt-2">
              <div className="flex items-center gap-2 mb-3">
                <Users size={14} className="text-gray-400" />
                <h3 className="text-sm font-semibold text-gray-700">Clients</h3>
              </div>
              {clients.length > 0 && (
                <div className="space-y-1 mb-3">
                  {clients.map((cl) => (
                    <div key={cl.id} className="flex items-center justify-between px-3 py-1.5 bg-gray-50 rounded-lg">
                      <span className="text-sm text-gray-700">{cl.name}</span>
                      <button onClick={() => handleDeleteClient(cl)} className="text-gray-300 hover:text-red-500"><X size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
              {clients.length === 0 && <p className="text-xs text-gray-400 mb-3">No clients yet.</p>}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddClient()}
                  placeholder="Client name…"
                  className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Button size="sm" onClick={handleAddClient} disabled={!newClientName.trim() || addingClient}>
                  {addingClient ? '…' : 'Add'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
