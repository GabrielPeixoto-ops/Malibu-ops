'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Briefcase, AlertCircle, TrendingUp, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { calculateJobRevenue, calculateClientRevenue } from '@/lib/billing'
import type { JobSource, JobStatus, Subcontractor, SubcontractorConfig } from '@/types/database'
import Button from '@/components/ui/Button'

const STATUS_STYLE: Record<JobStatus, string> = {
  draft:       'bg-gray-100 text-gray-500',
  scheduled:   'bg-amber-100 text-amber-700',
  confirmed:   'bg-blue-100 text-blue-700',
  in_progress: 'bg-green-100 text-green-700',
  completed:   'bg-green-100 text-green-700',
  reviewed:    'bg-sky-100 text-sky-700',
  invoiced:    'bg-purple-100 text-purple-700',
  paid:        'bg-gray-100 text-gray-500',
  cancelled:   'bg-red-100 text-red-600',
}

interface JobRow {
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
  break_minutes: number
  discount: number
  override_revenue: number | null
  malibu_revenue: number | null
  client_billing_config: Record<string, unknown> | null
  subcontractor: Subcontractor | null
  customer: { name: string; billing_type: string | null; billing_config: Record<string, unknown> | null } | null
  contract: { name: string; billing_type: string; billing_config: Record<string, unknown> } | null
  contract_client: { name: string } | null
  job_trucks: Array<{ fleet: { name: string; registration: string | null } | null }>
}

function entityLabel(job: JobRow): string {
  if (job.source === 'private') return job.customer?.name ?? '—'
  if (job.source === 'contract') {
    const base = job.contract?.name ?? '—'
    return job.contract_client?.name ? `${base} → ${job.contract_client.name}` : base
  }
  return job.subcontractor?.name ?? '—'
}

function calcRevenue(job: JobRow): number | null {
  try {
    if (job.source === 'subcontract') {
      if (!job.subcontractor) return null
      const effectiveOverride = job.malibu_revenue ?? job.override_revenue
      return calculateJobRevenue({ ...job, override_revenue: effectiveOverride }, job.subcontractor)
    }
    const entity = job.source === 'private' ? job.customer : job.contract
    if (!entity?.billing_type || !entity?.billing_config) return null
    return calculateClientRevenue(
      { ...job, client_billing_config: job.client_billing_config as SubcontractorConfig | null },
      entity.billing_type,
      entity.billing_config as unknown as SubcontractorConfig
    )
  } catch {
    return null
  }
}

function SourceBadge({ source }: { source: JobSource }) {
  if (source === 'private') return <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gold/15 text-gold leading-none">Private</span>
  if (source === 'contract') return <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-500/15 text-teal-600 leading-none">Contract</span>
  return null
}

function StatCard({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className={`bg-surface rounded-xl border border-wire px-4 py-3.5 flex flex-col gap-1 ${accent ? 'border-l-2 border-l-gold-ring' : ''}`}>
      <div className="flex items-center gap-1.5 text-dim">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-widest">{label}</span>
      </div>
      <div className={`text-xl font-display font-bold tabular-nums ${accent ? 'text-gold' : 'text-parchment'}`}>{value}</div>
      <div className="text-[11px] text-dim">{sub}</div>
    </div>
  )
}

const fmtAUD = (n: number) =>
  n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 })

const SOURCE_OPTIONS: { value: JobSource | 'all'; label: string }[] = [
  { value: 'all', label: 'All Sources' },
  { value: 'subcontract', label: 'Subcontract' },
  { value: 'private', label: 'Private' },
  { value: 'contract', label: 'Contract' },
]

const STATUS_OPTIONS: { value: JobStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'invoiced', label: 'Invoiced' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
]

const filterInput = 'px-3 py-1.5 text-sm border border-wire rounded-lg bg-surface text-parchment placeholder:text-dim focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring'

function getWeekStart(): string {
  const d = new Date()
  const dow = d.getDay() === 0 ? -6 : 1 - d.getDay()
  d.setDate(d.getDate() + dow)
  d.setHours(0, 0, 0, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getMonthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function getToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function JobsPage() {
  const supabase = createClient()
  const router = useRouter()
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<JobSource | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('jobs')
        .select(`
          id, job_number, date, status, source,
          cof, cof_final, additional_hours, additional_rate, rate_card_key, formula_vars,
          extra_men_hours, break_minutes, discount, override_revenue, malibu_revenue, client_billing_config,
          subcontractor:subcontractors(*),
          customer:customers(name, billing_type, billing_config),
          contract:contracts(name, billing_type, billing_config),
          contract_client:contract_clients(name)
        `)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500)

      if (error) console.error('jobs query error:', error.message)

      const baseJobs = (data ?? []) as unknown as Omit<JobRow, 'job_trucks'>[]

      const truckMap = new Map<string, JobRow['job_trucks']>()
      if (baseJobs.length > 0) {
        try {
          const { data: trucks } = await supabase
            .from('job_trucks')
            .select('job_id, fleet:fleet(name, registration)')
            .in('job_id', baseJobs.map((j) => j.id))
          for (const row of (trucks ?? []) as unknown as Array<{ job_id: string; fleet: { name: string; registration: string | null } | null }>) {
            const list = truckMap.get(row.job_id) ?? []
            list.push({ fleet: row.fleet })
            truckMap.set(row.job_id, list)
          }
        } catch { /* fleet / job_trucks tables not yet migrated */ }
      }

      setJobs(baseJobs.map((j) => ({ ...j, job_trucks: truckMap.get(j.id) ?? [] })) as JobRow[])
      setLoading(false)
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    return jobs.filter((j) => {
      if (sourceFilter !== 'all' && j.source !== sourceFilter) return false
      if (statusFilter !== 'all' && j.status !== statusFilter) return false
      if (dateFrom && j.date < dateFrom) return false
      if (dateTo && j.date > dateTo) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const label = entityLabel(j).toLowerCase()
        return j.job_number.includes(q) || label.includes(q)
      }
      return true
    })
  }, [jobs, search, sourceFilter, statusFilter, dateFrom, dateTo])

  const stats = useMemo(() => {
    const weekStart = getWeekStart()
    const monthStart = getMonthStart()
    const today = getToday()
    const thisWeek = jobs.filter(
      (j) => j.date >= weekStart && j.date <= today && j.status !== 'cancelled'
    ).length
    const pendingReview = jobs.filter((j) => j.status === 'completed').length
    const completedMonth = jobs.filter(
      (j) => j.date >= monthStart && ['completed', 'reviewed', 'invoiced', 'paid'].includes(j.status)
    ).length
    const revenueMonth = jobs
      .filter((j) => j.date >= monthStart && j.status !== 'cancelled' && j.status !== 'draft')
      .reduce((sum, j) => sum + (calcRevenue(j) ?? 0), 0)
    return { thisWeek, pendingReview, completedMonth, revenueMonth }
  }, [jobs])

  return (
    <div>
      {/* Mobile header (hidden on desktop — topbar handles it) */}
      <div className="flex items-center justify-between mb-5 lg:hidden">
        <h1 className="text-2xl font-display font-bold text-parchment">Jobs</h1>
        <Link href="/jobs/new">
          <Button size="sm"><Plus size={16} /> New Job</Button>
        </Link>
      </div>

      {/* Stats cards */}
      {!loading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <StatCard
            icon={<Briefcase size={16} className="text-[#52504c]" />}
            label="This week"
            value={String(stats.thisWeek)}
            sub="jobs"
          />
          <StatCard
            icon={<AlertCircle size={16} className="text-amber-600" />}
            label="Pending review"
            value={String(stats.pendingReview)}
            sub="completed"
            accent
          />
          <StatCard
            icon={<TrendingUp size={16} className="text-[#52504c]" />}
            label="Revenue (month)"
            value={fmtAUD(stats.revenueMonth)}
            sub="this month"
          />
          <StatCard
            icon={<CheckCircle2 size={16} className="text-[#52504c]" />}
            label="Completed (month)"
            value={String(stats.completedMonth)}
            sub="this month"
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          type="text"
          placeholder="Search job # or entity…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${filterInput} w-48`}
        />
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as JobSource | 'all')} className={filterInput}>
          {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as JobStatus | 'all')} className={filterInput}>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={filterInput} title="Date from" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={filterInput} title="Date to" />
      </div>

      {loading ? (
        <p className="text-warm">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="bg-surface rounded-xl border border-wire p-12 text-center">
          {jobs.length === 0 ? (
            <>
              <p className="text-dim mb-4">No jobs yet.</p>
              <Link href="/jobs/new"><Button><Plus size={16} /> Create your first job</Button></Link>
            </>
          ) : (
            <p className="text-dim">No jobs match your filters.</p>
          )}
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-wire overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-panel border-b border-wire">
              <tr>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-dim uppercase tracking-widest">Job #</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-dim uppercase tracking-widest">Date</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-dim uppercase tracking-widest hidden sm:table-cell">Entity</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-dim uppercase tracking-widest">Status</th>
                <th className="text-right px-4 py-3 text-[10px] font-semibold text-dim uppercase tracking-widest hidden md:table-cell">Revenue</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-wire">
              {filtered.map((job) => {
                const rev = calcRevenue(job)
                return (
                  <tr
                    key={job.id}
                    className="hover:bg-panel transition-colors cursor-pointer"
                    onClick={() => router.push(`/jobs/${job.id}/edit`)}
                  >
                    <td className="px-4 py-3 font-mono font-semibold text-parchment">{job.job_number}</td>
                    <td className="px-4 py-3 text-warm tabular-nums">{job.date}</td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <div className="flex items-center gap-1.5">
                        <span className="text-parchment">{entityLabel(job)}</span>
                        <SourceBadge source={job.source} />
                      </div>
                      {(job.job_trucks ?? []).length > 0 && (
                        <p className="text-xs font-mono text-dim mt-0.5">
                          {(job.job_trucks ?? []).map((jt) => jt.fleet?.registration ?? jt.fleet?.name).filter(Boolean).join(' + ')}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[job.status]}`}>
                        {job.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell">
                      {rev !== null
                        ? <span className="font-mono font-semibold text-gold">{fmtAUD(rev)}</span>
                        : <span className="text-dim">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/jobs/${job.id}/edit`} className="text-dim hover:text-gold transition-colors">
                        <Pencil size={15} />
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
