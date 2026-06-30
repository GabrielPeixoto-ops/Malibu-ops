'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { calculateJobRevenue, calculateClientRevenue } from '@/lib/billing'
import type { Employee, JobSource, JobStatus, Subcontractor, SubcontractorConfig } from '@/types/database'

type Tab = 'employees' | 'subcontractors' | 'contracts' | 'clients'

interface FormalInvoice {
  id: string
  invoice_number: string
  type: 'subcontractor' | 'b2b_client' | 'tmaat'
  entity_id: string
  entity_name: string
  period_from: string
  period_to: string
  status: 'draft' | 'sent' | 'paid'
  total_amount: number
  notes: string | null
  xero_invoice_id: string | null
  xero_invoice_url: string | null
  created_at: string
}

interface InvoiceJob {
  id: string
  job_number: string
  date: string
  status: JobStatus
  source: JobSource
  cof: number | null
  cof_final: number | null
  additional_hours: number | null
  additional_rate: number | null
  rate_card_key: string | null
  formula_vars: Record<string, number> | null
  extra_men_hours: number
  extra_man_employee_id: string | null
  break_minutes: number
  discount: number
  override_revenue: number | null
  client_billing_config: Record<string, unknown> | null
  google_review: boolean
  google_review_employee_ids: string[]
  subcontractor: Subcontractor | null
  customer: { id: string; name: string; billing_type: string | null; billing_config: Record<string, unknown> | null } | null
  contract: { id: string; name: string; billing_type: string; billing_config: Record<string, unknown> } | null
  contract_client: { name: string } | null
  job_crew: Array<{ employee_id: string; hours: number; cof_share: boolean; cof_hours: number; start_time: string | null; end_time: string | null }>
  job_commissions: Array<{ employee_id: string | null; rate_per_hour: number; hours: number; commission_type: { name: string } | null }>
}

const fmtAUD = (n: number) =>
  n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 })

const fmtHours = (n: number) => (n % 1 === 0 ? `${n}h` : `${n.toFixed(2)}h`)

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 })
}

function calcRevenue(job: InvoiceJob): number | null {
  if (job.source === 'subcontract') {
    return job.subcontractor ? calculateJobRevenue(job, job.subcontractor) : null
  }
  const entity = job.source === 'private' ? job.customer : job.contract
  if (!entity?.billing_type || !entity?.billing_config) return null
  return calculateClientRevenue(
    { ...job, client_billing_config: job.client_billing_config as SubcontractorConfig | null },
    entity.billing_type,
    entity.billing_config as unknown as SubcontractorConfig
  )
}

function entityLabel(job: InvoiceJob): string {
  if (job.source === 'private') return job.customer?.name ?? '—'
  if (job.source === 'contract') {
    const base = job.contract?.name ?? '—'
    return job.contract_client?.name ? `${base} → ${job.contract_client.name}` : base
  }
  return job.subcontractor?.name ?? '—'
}

function today(): string { return new Date().toISOString().split('T')[0] }
function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

const STATUS_STYLE: Partial<Record<JobStatus, string>> = {
  reviewed: 'bg-cyan-500/10 text-cyan-300',
  invoiced: 'bg-purple-500/10 text-purple-300',
  paid:     'bg-teal-500/10 text-teal-300',
}

const MIN_CALL = 2

const filterInput = 'px-3 py-1.5 text-sm border border-wire rounded-lg bg-panel text-parchment focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring'

export default function InvoicesPage() {
  const supabase = createClient()
  const router = useRouter()

  const [tab, setTab] = useState<Tab>('employees')
  const [dateFrom, setDateFrom] = useState(monthStart())
  const [dateTo, setDateTo] = useState(today())
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>('all')
  const [empSearch, setEmpSearch] = useState('')
  const [subFilter, setSubFilter] = useState('all')
  const [contractFilter, setContractFilter] = useState('all')
  const [jobs, setJobs] = useState<InvoiceJob[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [formalInvoices, setFormalInvoices] = useState<FormalInvoice[]>([])
  const [sendingInvoice, setSendingInvoice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('employees').select('*').eq('active', true).order('name').then(({ data }) => {
      setEmployees((data ?? []) as Employee[])
    })
    supabase
      .from('invoices')
      .select('id,invoice_number,type,entity_id,entity_name,period_from,period_to,status,total_amount,notes,xero_invoice_id,xero_invoice_url,created_at')
      .in('type', ['subcontractor', 'b2b_client'])
      .order('created_at', { ascending: false })
      .then(({ data }) => setFormalInvoices((data ?? []) as FormalInvoice[]))
  }, [])

  useEffect(() => {
    setLoading(true)
    supabase
      .from('jobs')
      .select(`
        id, job_number, date, status, source,
        cof, cof_final, additional_hours, additional_rate, rate_card_key, formula_vars,
        extra_men_hours, extra_man_employee_id, break_minutes, discount, client_billing_config,
        google_review, google_review_employee_ids,
        subcontractor:subcontractors(*),
        customer:customers(id, name, billing_type, billing_config),
        contract:contracts(id, name, billing_type, billing_config),
        contract_client:contract_clients(name),
        job_crew(employee_id, hours, cof_share, cof_hours, start_time, end_time),
        job_commissions(employee_id, rate_per_hour, hours, commission_type:commission_types(name))
      `)
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .not('status', 'in', '("draft","cancelled")')
      .order('date', { ascending: false })
      .then(({ data }) => {
        setJobs((data ?? []) as unknown as InvoiceJob[])
        setLoading(false)
      })
  }, [dateFrom, dateTo])

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return jobs
    return jobs.filter((j) => j.status === statusFilter)
  }, [jobs, statusFilter])

  const employeeData = useMemo(() => {
    return employees.map((emp) => {
      const entries: Array<{
        job: InvoiceJob
        workedHours: number
        cofHours: number
        paidHours: number
        pay: number
        googleReviewBonus: boolean
        label?: string
      }> = []
      for (const job of filtered) {
        const row = job.job_crew.find((c) => c.employee_id === emp.id)
        if (row) {
          const cofHours = row.cof_share ? (row.cof_hours > 0 ? row.cof_hours : Number(job.cof_final ?? job.cof ?? 0)) : 0
          const reviewBonus = (job.google_review && job.google_review_employee_ids?.includes(emp.id)) ? 0.5 : 0
          const paidHours = Math.max(row.hours, MIN_CALL) + cofHours + reviewBonus
          entries.push({ job, workedHours: row.hours, cofHours, paidHours, pay: paidHours * emp.hourly_rate, googleReviewBonus: reviewBonus > 0 })
        }
        if (job.extra_man_employee_id === emp.id && job.extra_men_hours > 0) {
          entries.push({ job, workedHours: job.extra_men_hours, cofHours: 0, paidHours: job.extra_men_hours, pay: job.extra_men_hours * emp.hourly_rate, googleReviewBonus: false })
        }
        for (const com of (job.job_commissions ?? [])) {
          if (com.employee_id === emp.id && com.hours > 0 && com.rate_per_hour > 0) {
            entries.push({
              job,
              workedHours: com.hours,
              cofHours: 0,
              paidHours: com.hours,
              pay: com.hours * com.rate_per_hour,
              googleReviewBonus: false,
              label: com.commission_type?.name ?? 'Commission',
            })
          }
        }
      }
      const totalPaidHours = entries.reduce((s, e) => s + e.paidHours, 0)
      const totalPay = entries.reduce((s, e) => s + e.pay, 0)
      return { emp, entries, totalPaidHours, totalPay }
    }).filter((d) => d.entries.length > 0)
  }, [employees, filtered])

  const subcontractorData = useMemo(() => {
    const subJobs = filtered.filter((j) => j.source === 'subcontract' && j.subcontractor)
    const byId = new Map<string, { name: string; jobs: Array<{ job: InvoiceJob; revenue: number | null }> }>()
    for (const job of subJobs) {
      const sub = job.subcontractor!
      if (!byId.has(sub.id)) byId.set(sub.id, { name: sub.name, jobs: [] })
      byId.get(sub.id)!.jobs.push({ job, revenue: calcRevenue(job) })
    }
    return [...byId.entries()]
      .map(([id, { name, jobs: sj }]) => ({ id, name, jobs: sj, totalRevenue: sj.reduce((s, { revenue }) => s + (revenue ?? 0), 0) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [filtered])

  const contractData = useMemo(() => {
    const contractJobs = filtered.filter((j) => j.source === 'contract' && j.contract)
    const byId = new Map<string, { name: string; jobs: Array<{ job: InvoiceJob; revenue: number | null }> }>()
    for (const job of contractJobs) {
      const c = job.contract!
      if (!byId.has(c.id)) byId.set(c.id, { name: c.name, jobs: [] })
      byId.get(c.id)!.jobs.push({ job, revenue: calcRevenue(job) })
    }
    return [...byId.entries()]
      .map(([id, { name, jobs: cj }]) => ({ id, name, jobs: cj, totalRevenue: cj.reduce((s, { revenue }) => s + (revenue ?? 0), 0) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [filtered])

  const clientData = useMemo(() => {
    const clientJobs = filtered.filter((j) => j.source !== 'subcontract')
    const byKey = new Map<string, { label: string; jobs: Array<{ job: InvoiceJob; revenue: number | null }> }>()
    for (const job of clientJobs) {
      const key = job.source === 'private'
        ? `private:${job.customer?.id ?? 'unknown'}`
        : `contract:${job.contract?.id ?? 'unknown'}`
      const label = entityLabel(job)
      if (!byKey.has(key)) byKey.set(key, { label, jobs: [] })
      byKey.get(key)!.jobs.push({ job, revenue: calcRevenue(job) })
    }
    return [...byKey.entries()]
      .map(([key, { label, jobs: cj }]) => ({ key, label, jobs: cj, totalRevenue: cj.reduce((s, { revenue }) => s + (revenue ?? 0), 0) }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [filtered])

  async function handleSendToXero(invoiceId: string) {
    setSendingInvoice(invoiceId)
    try {
      const res = await fetch('/api/xero/send-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: invoiceId }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(`Failed to send to Xero: ${data.error ?? res.status}`)
      } else {
        setFormalInvoices((prev) =>
          prev.map((inv) =>
            inv.id === invoiceId
              ? { ...inv, status: 'sent', xero_invoice_id: data.xero_invoice_id, xero_invoice_url: data.xero_invoice_url }
              : inv
          )
        )
        if (data.xero_invoice_url) window.open(data.xero_invoice_url, '_blank', 'noopener')
      }
    } catch (err) {
      alert(`Network error: ${err}`)
    } finally {
      setSendingInvoice(null)
    }
  }

  const formalSubInvoices = formalInvoices.filter((inv) => inv.type === 'subcontractor')
  const formalClientInvoices = formalInvoices.filter((inv) => inv.type === 'b2b_client')

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'employees', label: 'Employees' },
    { id: 'subcontractors', label: 'Subcontractors' },
    { id: 'contracts', label: 'Contracts' },
    { id: 'clients', label: 'Clients' },
  ]

  const ALL_STATUSES: Array<{ value: JobStatus | 'all'; label: string }> = [
    { value: 'all', label: 'All statuses' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'completed', label: 'Completed' },
    { value: 'reviewed', label: 'Reviewed' },
    { value: 'invoiced', label: 'Invoiced' },
    { value: 'paid', label: 'Paid' },
  ]

  const thCell = 'text-left px-4 py-2 text-[10px] font-semibold text-dim uppercase tracking-widest'
  const groupHeader = 'flex items-center justify-between px-4 py-3 bg-panel border-b border-wire'
  const totalBar = 'bg-gold/10 border border-gold-ring rounded-xl px-4 py-3 flex items-center justify-between'

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-display font-bold text-parchment">Invoices</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={filterInput} />
          <span className="text-dim text-sm">–</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={filterInput} />
          {tab !== 'employees' && (
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as JobStatus | 'all')} className={filterInput}>
              {ALL_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          )}
          {tab === 'subcontractors' && subcontractorData.length > 0 && (
            <select value={subFilter} onChange={(e) => setSubFilter(e.target.value)} className={filterInput}>
              <option value="all">All Subcontractors</option>
              {subcontractorData.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {tab === 'contracts' && contractData.length > 0 && (
            <select value={contractFilter} onChange={(e) => setContractFilter(e.target.value)} className={filterInput}>
              <option value="all">All Contracts</option>
              {contractData.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 mb-5 border-b border-wire">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id ? 'border-gold text-gold' : 'border-transparent text-dim hover:text-warm'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-warm text-sm py-12 text-center">Loading…</p>
      ) : (
        <>
          {/* ── Employees ─────────────────────────────────────────────── */}
          {tab === 'employees' && (
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Search employee…"
                value={empSearch}
                onChange={(e) => setEmpSearch(e.target.value)}
                className={`${filterInput} w-52`}
              />
              {employeeData.filter((d) => d.emp.name.toLowerCase().includes(empSearch.toLowerCase())).length === 0 && (
                <div className="bg-surface rounded-xl border border-wire p-12 text-center text-dim">No job data for this period.</div>
              )}
              {employeeData.filter((d) => d.emp.name.toLowerCase().includes(empSearch.toLowerCase())).map(({ emp, entries, totalPaidHours, totalPay }) => (
                <div key={emp.id} className="bg-surface rounded-xl border border-wire overflow-hidden">
                  <div className={groupHeader}>
                    <div>
                      <span className="font-semibold text-parchment">{emp.name}</span>
                      <span className="ml-2 text-xs text-dim font-mono">${emp.hourly_rate}/hr</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-mono font-bold text-gold">{fmtMoney(totalPay)}</div>
                      <div className="text-xs text-dim font-mono">{fmtHours(totalPaidHours)}</div>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-wire">
                        <th className={thCell}>Date</th>
                        <th className={thCell}>Job</th>
                        <th className={`${thCell} hidden sm:table-cell`}>Entity</th>
                        <th className={`${thCell} text-right`}>Paid hrs</th>
                        <th className={`${thCell} text-right`}>Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-wire">
                      {entries.map(({ job, paidHours, pay, googleReviewBonus, label }, i) => (
                        <tr key={`${job.id}-${i}`} className="hover:bg-panel transition-colors cursor-pointer" onClick={() => router.push(`/jobs/${job.id}/edit`)}>
                          <td className="px-4 py-2 text-warm whitespace-nowrap">{job.date}</td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono text-parchment">#{job.job_number}</span>
                              {label && <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-300 font-medium">Commission: {label}</span>}
                              {STATUS_STYLE[job.status] && (
                                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_STYLE[job.status]}`}>{job.status}</span>
                              )}
                              {googleReviewBonus && <span className="text-xs px-1.5 py-0.5 rounded-full bg-gold/15 text-gold font-medium">★ +0.5h</span>}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-dim text-xs hidden sm:table-cell">{entityLabel(job)}</td>
                          <td className="px-4 py-2 text-right font-mono font-medium text-parchment">{fmtHours(paidHours)}</td>
                          <td className="px-4 py-2 text-right font-mono font-semibold text-gold">{fmtMoney(pay)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-wire bg-panel">
                        <td colSpan={3} className="px-4 py-2 text-xs font-semibold text-dim hidden sm:table-cell">Total</td>
                        <td colSpan={3} className="px-4 py-2 sm:hidden text-xs font-semibold text-dim">Total</td>
                        <td className="px-4 py-2 text-right text-xs font-mono font-bold text-parchment">{fmtHours(totalPaidHours)}</td>
                        <td className="px-4 py-2 text-right text-xs font-mono font-bold text-gold">{fmtMoney(totalPay)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))}
              {employeeData.length > 0 && (
                <div className={totalBar}>
                  <span className="text-sm font-display font-semibold text-gold">Total payroll</span>
                  <span className="text-lg font-mono font-bold text-gold">{fmtMoney(employeeData.reduce((s, d) => s + d.totalPay, 0))}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Subcontractors ────────────────────────────────────────── */}
          {tab === 'subcontractors' && (
            <div className="space-y-4">
              {formalSubInvoices.length > 0 && (
                <div className="bg-surface rounded-xl border border-wire overflow-hidden">
                  <div className={groupHeader}>
                    <span className="font-semibold text-parchment">Formal Invoices</span>
                    <span className="text-xs text-dim">{formalSubInvoices.length} invoice{formalSubInvoices.length !== 1 ? 's' : ''}</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-wire">
                        <th className={thCell}>Invoice #</th>
                        <th className={thCell}>Entity</th>
                        <th className={`${thCell} hidden sm:table-cell`}>Period</th>
                        <th className={`${thCell} text-right`}>Total</th>
                        <th className={`${thCell} text-right`}>Status</th>
                        <th className={thCell} />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-wire">
                      {formalSubInvoices.map((inv) => (
                        <tr key={inv.id}>
                          <td className="px-4 py-2 font-mono text-parchment text-xs">{inv.invoice_number}</td>
                          <td className="px-4 py-2 text-warm text-xs">{inv.entity_name}</td>
                          <td className="px-4 py-2 text-dim text-xs hidden sm:table-cell">{inv.period_from} – {inv.period_to}</td>
                          <td className="px-4 py-2 text-right font-mono font-semibold text-gold text-xs">{fmtAUD(inv.total_amount)}</td>
                          <td className="px-4 py-2 text-right">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                              inv.status === 'paid' ? 'bg-teal-500/10 text-teal-300' :
                              inv.status === 'sent' ? 'bg-purple-500/10 text-purple-300' :
                              'bg-wire/50 text-warm'
                            }`}>{inv.status}</span>
                          </td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            {inv.status === 'draft' ? (
                              <button
                                onClick={() => handleSendToXero(inv.id)}
                                disabled={sendingInvoice === inv.id}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-gold/15 text-gold hover:bg-gold/25 transition-colors disabled:opacity-50"
                              >
                                {sendingInvoice === inv.id ? 'Sending…' : 'Send to Xero'}
                              </button>
                            ) : inv.xero_invoice_url ? (
                              <a
                                href={inv.xero_invoice_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-gold hover:text-gold-bright"
                              >
                                View in Xero <ExternalLink size={11} />
                              </a>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {subcontractorData.length === 0 && (
                <div className="bg-surface rounded-xl border border-wire p-12 text-center text-dim">No subcontract jobs for this period.</div>
              )}
              {subcontractorData.filter((s) => subFilter === 'all' || s.id === subFilter).map(({ id, name, jobs: sj, totalRevenue }) => (
                <div key={id} className="bg-surface rounded-xl border border-wire overflow-hidden">
                  <div className={groupHeader}>
                    <span className="font-semibold text-parchment">{name}</span>
                    <div className="text-right">
                      <div className="text-sm font-mono font-bold text-gold">{fmtAUD(totalRevenue)}</div>
                      <div className="text-xs text-dim">{sj.length} job{sj.length !== 1 ? 's' : ''}</div>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-wire">
                        <th className={thCell}>Date</th>
                        <th className={thCell}>Job #</th>
                        <th className={thCell}>Status</th>
                        <th className={`${thCell} text-right`}>Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-wire">
                      {sj.map(({ job, revenue }) => (
                        <tr key={job.id} className="hover:bg-panel transition-colors cursor-pointer" onClick={() => router.push(`/jobs/${job.id}/edit`)}>
                          <td className="px-4 py-2 text-warm whitespace-nowrap">{job.date}</td>
                          <td className="px-4 py-2 font-mono text-parchment">#{job.job_number}</td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[job.status] ?? 'bg-wire/50 text-warm'}`}>
                              {job.status.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-mono font-semibold text-gold">
                            {revenue !== null ? fmtAUD(revenue) : <span className="text-dim">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-wire bg-panel">
                        <td colSpan={3} className="px-4 py-2 text-xs font-semibold text-dim">Total</td>
                        <td className="px-4 py-2 text-right text-xs font-mono font-bold text-gold">{fmtAUD(totalRevenue)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))}
              {subcontractorData.length > 0 && (
                <div className={totalBar}>
                  <span className="text-sm font-display font-semibold text-gold">Total revenue</span>
                  <span className="text-lg font-mono font-bold text-gold">{fmtAUD(subcontractorData.filter((s) => subFilter === 'all' || s.id === subFilter).reduce((s, d) => s + d.totalRevenue, 0))}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Contracts ─────────────────────────────────────────────── */}
          {tab === 'contracts' && (
            <div className="space-y-4">
              {contractData.length === 0 && (
                <div className="bg-surface rounded-xl border border-wire p-12 text-center text-dim">No contract jobs for this period.</div>
              )}
              {contractData.filter((c) => contractFilter === 'all' || c.id === contractFilter).map(({ id, name, jobs: cj, totalRevenue }) => (
                <div key={id} className="bg-surface rounded-xl border border-wire overflow-hidden">
                  <div className={groupHeader}>
                    <span className="font-semibold text-parchment">{name}</span>
                    <div className="text-right">
                      <div className="text-sm font-mono font-bold text-gold">{fmtAUD(totalRevenue)}</div>
                      <div className="text-xs text-dim">{cj.length} job{cj.length !== 1 ? 's' : ''}</div>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-wire">
                        <th className={thCell}>Date</th>
                        <th className={thCell}>Job #</th>
                        <th className={`${thCell} hidden sm:table-cell`}>Client</th>
                        <th className={thCell}>Status</th>
                        <th className={`${thCell} text-right`}>Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-wire">
                      {cj.map(({ job, revenue }) => (
                        <tr key={job.id} className="hover:bg-panel transition-colors cursor-pointer" onClick={() => router.push(`/jobs/${job.id}/edit`)}>
                          <td className="px-4 py-2 text-warm whitespace-nowrap">{job.date}</td>
                          <td className="px-4 py-2 font-mono text-parchment">#{job.job_number}</td>
                          <td className="px-4 py-2 text-dim text-xs hidden sm:table-cell">{job.contract_client?.name ?? '—'}</td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[job.status] ?? 'bg-wire/50 text-warm'}`}>
                              {job.status.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-mono font-semibold text-gold">
                            {revenue !== null ? fmtAUD(revenue) : <span className="text-dim">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-wire bg-panel">
                        <td colSpan={4} className="px-4 py-2 text-xs font-semibold text-dim">Total</td>
                        <td className="px-4 py-2 text-right text-xs font-mono font-bold text-gold">{fmtAUD(totalRevenue)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))}
              {contractData.length > 0 && (
                <div className={totalBar}>
                  <span className="text-sm font-display font-semibold text-gold">Total revenue</span>
                  <span className="text-lg font-mono font-bold text-gold">{fmtAUD(contractData.filter((c) => contractFilter === 'all' || c.id === contractFilter).reduce((s, d) => s + d.totalRevenue, 0))}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Clients ──────────────────────────────────────────────── */}
          {tab === 'clients' && (
            <div className="space-y-4">
              {formalClientInvoices.length > 0 && (
                <div className="bg-surface rounded-xl border border-wire overflow-hidden">
                  <div className={groupHeader}>
                    <span className="font-semibold text-parchment">Formal Invoices (B2B)</span>
                    <span className="text-xs text-dim">{formalClientInvoices.length} invoice{formalClientInvoices.length !== 1 ? 's' : ''}</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-wire">
                        <th className={thCell}>Invoice #</th>
                        <th className={thCell}>Client</th>
                        <th className={`${thCell} hidden sm:table-cell`}>Period</th>
                        <th className={`${thCell} text-right`}>Total</th>
                        <th className={`${thCell} text-right`}>Status</th>
                        <th className={thCell} />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-wire">
                      {formalClientInvoices.map((inv) => (
                        <tr key={inv.id}>
                          <td className="px-4 py-2 font-mono text-parchment text-xs">{inv.invoice_number}</td>
                          <td className="px-4 py-2 text-warm text-xs">{inv.entity_name}</td>
                          <td className="px-4 py-2 text-dim text-xs hidden sm:table-cell">{inv.period_from} – {inv.period_to}</td>
                          <td className="px-4 py-2 text-right font-mono font-semibold text-gold text-xs">{fmtAUD(inv.total_amount)}</td>
                          <td className="px-4 py-2 text-right">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                              inv.status === 'paid' ? 'bg-teal-500/10 text-teal-300' :
                              inv.status === 'sent' ? 'bg-purple-500/10 text-purple-300' :
                              'bg-wire/50 text-warm'
                            }`}>{inv.status}</span>
                          </td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            {inv.status === 'draft' ? (
                              <button
                                onClick={() => handleSendToXero(inv.id)}
                                disabled={sendingInvoice === inv.id}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-gold/15 text-gold hover:bg-gold/25 transition-colors disabled:opacity-50"
                              >
                                {sendingInvoice === inv.id ? 'Sending…' : 'Send to Xero'}
                              </button>
                            ) : inv.xero_invoice_url ? (
                              <a
                                href={inv.xero_invoice_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-gold hover:text-gold-bright"
                              >
                                View in Xero <ExternalLink size={11} />
                              </a>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {clientData.length === 0 && (
                <div className="bg-surface rounded-xl border border-wire p-12 text-center text-dim">No client jobs for this period.</div>
              )}
              {clientData.map(({ key, label, jobs: cj, totalRevenue }) => (
                <div key={key} className="bg-surface rounded-xl border border-wire overflow-hidden">
                  <div className={groupHeader}>
                    <span className="font-semibold text-parchment">{label}</span>
                    <div className="text-right">
                      <div className="text-sm font-mono font-bold text-gold">{fmtAUD(totalRevenue)}</div>
                      <div className="text-xs text-dim">{cj.length} job{cj.length !== 1 ? 's' : ''}</div>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-wire">
                        <th className={thCell}>Date</th>
                        <th className={thCell}>Job #</th>
                        <th className={thCell}>Status</th>
                        <th className={`${thCell} text-right`}>Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-wire">
                      {cj.map(({ job, revenue }) => (
                        <tr key={job.id} className="hover:bg-panel transition-colors cursor-pointer" onClick={() => router.push(`/jobs/${job.id}/edit`)}>
                          <td className="px-4 py-2 text-warm whitespace-nowrap">{job.date}</td>
                          <td className="px-4 py-2 font-mono text-parchment">#{job.job_number}</td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[job.status] ?? 'bg-wire/50 text-warm'}`}>
                              {job.status.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-mono font-semibold text-gold">
                            {revenue !== null ? fmtAUD(revenue) : <span className="text-dim">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-wire bg-panel">
                        <td colSpan={3} className="px-4 py-2 text-xs font-semibold text-dim">Total</td>
                        <td className="px-4 py-2 text-right text-xs font-mono font-bold text-gold">{fmtAUD(totalRevenue)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))}
              {clientData.length > 0 && (
                <div className={totalBar}>
                  <span className="text-sm font-display font-semibold text-gold">Total revenue</span>
                  <span className="text-lg font-mono font-bold text-gold">{fmtAUD(clientData.reduce((s, d) => s + d.totalRevenue, 0))}</span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
