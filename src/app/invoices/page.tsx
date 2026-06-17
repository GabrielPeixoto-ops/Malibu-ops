'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { calculateJobRevenue, calculateClientRevenue } from '@/lib/billing'
import type { Employee, JobSource, JobStatus, Subcontractor, SubcontractorConfig } from '@/types/database'

// ─── Shared types ─────────────────────────────────────────────────────────────

type Tab = 'employees' | 'subcontractors' | 'contracts' | 'clients'

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
}

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmtAUD = (n: number) =>
  n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 })

const fmtHours = (n: number) => (n % 1 === 0 ? `${n}h` : `${n.toFixed(2)}h`)

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 })
}

// ─── Revenue helpers ──────────────────────────────────────────────────────────

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

// ─── Date helpers ──────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().split('T')[0]
}

function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

// ─── Status style ─────────────────────────────────────────────────────────────

const STATUS_STYLE: Partial<Record<JobStatus, string>> = {
  reviewed: 'bg-cyan-100 text-cyan-700',
  invoiced: 'bg-purple-100 text-purple-700',
  paid: 'bg-teal-100 text-teal-700',
}

const MIN_CALL = 2

// ─── Page ────────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const supabase = createClient()

  const [tab, setTab] = useState<Tab>('employees')
  const [dateFrom, setDateFrom] = useState(monthStart())
  const [dateTo, setDateTo] = useState(today())
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>('all')
  const [empSearch, setEmpSearch] = useState('')
  const [subFilter, setSubFilter] = useState('all')
  const [contractFilter, setContractFilter] = useState('all')
  const [jobs, setJobs] = useState<InvoiceJob[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('employees').select('*').eq('active', true).order('name').then(({ data }) => {
      setEmployees((data ?? []) as Employee[])
    })
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
        job_crew(employee_id, hours, cof_share, cof_hours, start_time, end_time)
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

  // ── Employees tab data ────────────────────────────────────────────────────
  const employeeData = useMemo(() => {
    return employees.map((emp) => {
      const entries: Array<{
        job: InvoiceJob
        workedHours: number
        cofHours: number
        paidHours: number
        pay: number
        googleReviewBonus: boolean
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
      }
      const totalPaidHours = entries.reduce((s, e) => s + e.paidHours, 0)
      const totalPay = entries.reduce((s, e) => s + e.pay, 0)
      return { emp, entries, totalPaidHours, totalPay }
    }).filter((d) => d.entries.length > 0)
  }, [employees, filtered])

  // ── Subcontractors tab data ───────────────────────────────────────────────
  const subcontractorData = useMemo(() => {
    const subJobs = filtered.filter((j) => j.source === 'subcontract' && j.subcontractor)
    const byId = new Map<string, { name: string; jobs: Array<{ job: InvoiceJob; revenue: number | null }> }>()
    for (const job of subJobs) {
      const sub = job.subcontractor!
      if (!byId.has(sub.id)) byId.set(sub.id, { name: sub.name, jobs: [] })
      byId.get(sub.id)!.jobs.push({ job, revenue: calcRevenue(job) })
    }
    return [...byId.entries()]
      .map(([id, { name, jobs: sj }]) => ({
        id,
        name,
        jobs: sj,
        totalRevenue: sj.reduce((s, { revenue }) => s + (revenue ?? 0), 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [filtered])

  // ── Contracts tab data ───────────────────────────────────────────────────
  const contractData = useMemo(() => {
    const contractJobs = filtered.filter((j) => j.source === 'contract' && j.contract)
    const byId = new Map<string, { name: string; jobs: Array<{ job: InvoiceJob; revenue: number | null }> }>()
    for (const job of contractJobs) {
      const c = job.contract!
      if (!byId.has(c.id)) byId.set(c.id, { name: c.name, jobs: [] })
      byId.get(c.id)!.jobs.push({ job, revenue: calcRevenue(job) })
    }
    return [...byId.entries()]
      .map(([id, { name, jobs: cj }]) => ({
        id,
        name,
        jobs: cj,
        totalRevenue: cj.reduce((s, { revenue }) => s + (revenue ?? 0), 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [filtered])

  // ── Clients tab data ──────────────────────────────────────────────────────
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
      .map(([key, { label, jobs: cj }]) => ({
        key,
        label,
        jobs: cj,
        totalRevenue: cj.reduce((s, { revenue }) => s + (revenue ?? 0), 0),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [filtered])

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

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-gray-400 text-sm">–</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {tab !== 'employees' && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as JobStatus | 'all')}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {ALL_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          )}
          {tab === 'subcontractors' && subcontractorData.length > 0 && (
            <select
              value={subFilter}
              onChange={(e) => setSubFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Subcontractors</option>
              {subcontractorData.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {tab === 'contracts' && contractData.length > 0 && (
            <select
              value={contractFilter}
              onChange={(e) => setContractFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Contracts</option>
              {contractData.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm py-12 text-center">Loading…</p>
      ) : (
        <>
          {/* ── Employees tab ─────────────────────────────────────────────── */}
          {tab === 'employees' && (
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Search employee…"
                value={empSearch}
                onChange={(e) => setEmpSearch(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-52"
              />
              {employeeData.filter((d) => d.emp.name.toLowerCase().includes(empSearch.toLowerCase())).length === 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">No job data for this period.</div>
              )}
              {employeeData.filter((d) => d.emp.name.toLowerCase().includes(empSearch.toLowerCase())).map(({ emp, entries, totalPaidHours, totalPay }) => (
                <div key={emp.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <div>
                      <span className="font-semibold text-gray-900">{emp.name}</span>
                      <span className="ml-2 text-xs text-gray-400">${emp.hourly_rate}/hr</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-gray-800">{fmtMoney(totalPay)}</div>
                      <div className="text-xs text-gray-400">{fmtHours(totalPaidHours)}</div>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left px-4 py-2 text-xs font-medium text-gray-400">Date</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-gray-400">Job</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 hidden sm:table-cell">Entity</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-gray-400">Paid hrs</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-gray-400">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {entries.map(({ job, paidHours, pay, googleReviewBonus }, i) => (
                        <tr key={`${job.id}-${i}`} className="hover:bg-gray-50/50">
                          <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{job.date}</td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono text-gray-900">#{job.job_number}</span>
                              {STATUS_STYLE[job.status] && (
                                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_STYLE[job.status]}`}>{job.status}</span>
                              )}
                              {googleReviewBonus && <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">★ +0.5h</span>}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-gray-500 text-xs hidden sm:table-cell">{entityLabel(job)}</td>
                          <td className="px-4 py-2 text-right font-medium text-gray-800">{fmtHours(paidHours)}</td>
                          <td className="px-4 py-2 text-right font-semibold text-gray-900">{fmtMoney(pay)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-200 bg-gray-50">
                        <td colSpan={3} className="px-4 py-2 text-xs font-semibold text-gray-500 hidden sm:table-cell">Total</td>
                        <td colSpan={3} className="px-4 py-2 sm:hidden text-xs font-semibold text-gray-500">Total</td>
                        <td className="px-4 py-2 text-right text-xs font-bold text-gray-800">{fmtHours(totalPaidHours)}</td>
                        <td className="px-4 py-2 text-right text-xs font-bold text-gray-900">{fmtMoney(totalPay)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))}
              {employeeData.length > 0 && (
                <div className="bg-gray-900 text-white rounded-xl px-4 py-3 flex items-center justify-between">
                  <span className="text-sm font-semibold">Total payroll</span>
                  <span className="text-lg font-bold">{fmtMoney(employeeData.reduce((s, d) => s + d.totalPay, 0))}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Subcontractors tab ────────────────────────────────────────── */}
          {tab === 'subcontractors' && (
            <div className="space-y-4">
              {subcontractorData.length === 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">No subcontract jobs for this period.</div>
              )}
              {subcontractorData.filter((s) => subFilter === 'all' || s.id === subFilter).map(({ id, name, jobs: sj, totalRevenue }) => (
                <div key={id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <span className="font-semibold text-gray-900">{name}</span>
                    <div className="text-right">
                      <div className="text-sm font-bold text-gray-800">{fmtAUD(totalRevenue)}</div>
                      <div className="text-xs text-gray-400">{sj.length} job{sj.length !== 1 ? 's' : ''}</div>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left px-4 py-2 text-xs font-medium text-gray-400">Date</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-gray-400">Job #</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-gray-400">Status</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-gray-400">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {sj.map(({ job, revenue }) => (
                        <tr key={job.id} className="hover:bg-gray-50/50">
                          <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{job.date}</td>
                          <td className="px-4 py-2 font-mono text-gray-900">#{job.job_number}</td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[job.status] ?? 'bg-gray-100 text-gray-600'}`}>
                              {job.status.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-medium text-gray-800">
                            {revenue !== null ? fmtAUD(revenue) : <span className="text-gray-300">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-200 bg-gray-50">
                        <td colSpan={3} className="px-4 py-2 text-xs font-semibold text-gray-500">Total</td>
                        <td className="px-4 py-2 text-right text-xs font-bold text-gray-900">{fmtAUD(totalRevenue)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))}
              {subcontractorData.length > 0 && (
                <div className="bg-gray-900 text-white rounded-xl px-4 py-3 flex items-center justify-between">
                  <span className="text-sm font-semibold">Total revenue</span>
                  <span className="text-lg font-bold">{fmtAUD(subcontractorData.filter((s) => subFilter === 'all' || s.id === subFilter).reduce((s, d) => s + d.totalRevenue, 0))}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Contracts tab ────────────────────────────────────────────── */}
          {tab === 'contracts' && (
            <div className="space-y-4">
              {contractData.length === 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">No contract jobs for this period.</div>
              )}
              {contractData.filter((c) => contractFilter === 'all' || c.id === contractFilter).map(({ id, name, jobs: cj, totalRevenue }) => (
                <div key={id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <span className="font-semibold text-gray-900">{name}</span>
                    <div className="text-right">
                      <div className="text-sm font-bold text-gray-800">{fmtAUD(totalRevenue)}</div>
                      <div className="text-xs text-gray-400">{cj.length} job{cj.length !== 1 ? 's' : ''}</div>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left px-4 py-2 text-xs font-medium text-gray-400">Date</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-gray-400">Job #</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 hidden sm:table-cell">Client</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-gray-400">Status</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-gray-400">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {cj.map(({ job, revenue }) => (
                        <tr key={job.id} className="hover:bg-gray-50/50">
                          <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{job.date}</td>
                          <td className="px-4 py-2 font-mono text-gray-900">#{job.job_number}</td>
                          <td className="px-4 py-2 text-gray-500 text-xs hidden sm:table-cell">{job.contract_client?.name ?? '—'}</td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[job.status] ?? 'bg-gray-100 text-gray-600'}`}>
                              {job.status.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-medium text-gray-800">
                            {revenue !== null ? fmtAUD(revenue) : <span className="text-gray-300">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-200 bg-gray-50">
                        <td colSpan={4} className="px-4 py-2 text-xs font-semibold text-gray-500">Total</td>
                        <td className="px-4 py-2 text-right text-xs font-bold text-gray-900">{fmtAUD(totalRevenue)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))}
              {contractData.length > 0 && (
                <div className="bg-gray-900 text-white rounded-xl px-4 py-3 flex items-center justify-between">
                  <span className="text-sm font-semibold">Total revenue</span>
                  <span className="text-lg font-bold">{fmtAUD(contractData.filter((c) => contractFilter === 'all' || c.id === contractFilter).reduce((s, d) => s + d.totalRevenue, 0))}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Clients tab ───────────────────────────────────────────────── */}
          {tab === 'clients' && (
            <div className="space-y-4">
              {clientData.length === 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">No client jobs for this period.</div>
              )}
              {clientData.map(({ key, label, jobs: cj, totalRevenue }) => (
                <div key={key} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <span className="font-semibold text-gray-900">{label}</span>
                    <div className="text-right">
                      <div className="text-sm font-bold text-gray-800">{fmtAUD(totalRevenue)}</div>
                      <div className="text-xs text-gray-400">{cj.length} job{cj.length !== 1 ? 's' : ''}</div>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left px-4 py-2 text-xs font-medium text-gray-400">Date</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-gray-400">Job #</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-gray-400">Status</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-gray-400">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {cj.map(({ job, revenue }) => (
                        <tr key={job.id} className="hover:bg-gray-50/50">
                          <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{job.date}</td>
                          <td className="px-4 py-2 font-mono text-gray-900">#{job.job_number}</td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[job.status] ?? 'bg-gray-100 text-gray-600'}`}>
                              {job.status.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-medium text-gray-800">
                            {revenue !== null ? fmtAUD(revenue) : <span className="text-gray-300">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-200 bg-gray-50">
                        <td colSpan={3} className="px-4 py-2 text-xs font-semibold text-gray-500">Total</td>
                        <td className="px-4 py-2 text-right text-xs font-bold text-gray-900">{fmtAUD(totalRevenue)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))}
              {clientData.length > 0 && (
                <div className="bg-gray-900 text-white rounded-xl px-4 py-3 flex items-center justify-between">
                  <span className="text-sm font-semibold">Total revenue</span>
                  <span className="text-lg font-bold">{fmtAUD(clientData.reduce((s, d) => s + d.totalRevenue, 0))}</span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
