'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Pencil } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { calculateJobRevenue, calculateClientRevenue } from '@/lib/billing'
import type { JobSource, JobStatus, Subcontractor, SubcontractorConfig } from '@/types/database'
import Button from '@/components/ui/Button'

const STATUS_STYLE: Record<JobStatus, string> = {
  draft:       'bg-wire/50 text-warm',
  scheduled:   'bg-blue-500/10 text-blue-300',
  confirmed:   'bg-indigo-500/10 text-indigo-300',
  in_progress: 'bg-amber-500/10 text-amber-300',
  completed:   'bg-green-500/10 text-green-300',
  reviewed:    'bg-cyan-500/10 text-cyan-300',
  invoiced:    'bg-purple-500/10 text-purple-300',
  paid:        'bg-teal-500/10 text-teal-300',
  cancelled:   'bg-red-500/10 text-red-400',
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
      return job.subcontractor ? calculateJobRevenue(job, job.subcontractor) : null
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
  if (source === 'contract') return <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-500/15 text-teal-300 leading-none">Contract</span>
  return null
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

const filterInput = 'px-3 py-1.5 text-sm border border-wire rounded-lg bg-panel text-parchment placeholder:text-dim focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring'

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
          extra_men_hours, break_minutes, discount, override_revenue, client_billing_config,
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-display font-bold text-parchment">Jobs</h1>
        <Link href="/jobs/new">
          <Button size="sm">
            <Plus size={16} /> New Job
          </Button>
        </Link>
      </div>

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
                const isViewable = job.status === 'invoiced' || job.status === 'paid'
                return (
                  <tr
                    key={job.id}
                    className={`hover:bg-panel transition-colors ${isViewable ? 'cursor-pointer' : ''}`}
                    onClick={isViewable ? () => router.push(`/jobs/${job.id}/edit`) : undefined}
                  >
                    <td className="px-4 py-3 font-mono font-semibold text-parchment">{job.job_number}</td>
                    <td className="px-4 py-3 text-warm">{job.date}</td>
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
