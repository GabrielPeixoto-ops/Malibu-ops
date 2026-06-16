'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Pencil } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { calculateJobRevenue, calculateClientRevenue } from '@/lib/billing'
import type { JobSource, JobStatus, Subcontractor, SubcontractorConfig } from '@/types/database'
import Button from '@/components/ui/Button'

const STATUS_STYLE: Record<JobStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  scheduled: 'bg-blue-100 text-blue-700',
  confirmed: 'bg-indigo-100 text-indigo-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  reviewed: 'bg-cyan-100 text-cyan-700',
  invoiced: 'bg-purple-100 text-purple-700',
  paid: 'bg-teal-100 text-teal-700',
  cancelled: 'bg-red-100 text-red-600',
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
  if (source === 'private') return <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700 leading-none">Private</span>
  if (source === 'contract') return <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-100 text-teal-700 leading-none">Contract</span>
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

export default function JobsPage() {
  const supabase = createClient()
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<JobSource | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    async function load() {
      // Step 1: load jobs — no fleet join so this query can never be broken by missing migrations
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

      // Step 2: load truck plates separately — silently skip if table doesn't exist yet
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
        } catch {
          // fleet / job_trucks tables not yet migrated — trucks just won't show
        }
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
        <h1 className="text-2xl font-bold text-gray-900">Jobs</h1>
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
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
        />
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as JobSource | 'all')}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as JobStatus | 'all')}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          title="Date from"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          title="Date to"
        />
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          {jobs.length === 0 ? (
            <>
              <p className="text-gray-400 mb-4">No jobs yet.</p>
              <Link href="/jobs/new"><Button><Plus size={16} /> Create your first job</Button></Link>
            </>
          ) : (
            <p className="text-gray-400">No jobs match your filters.</p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Job #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Entity</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Revenue</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((job) => {
                const rev = calcRevenue(job)
                return (
                  <tr key={job.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono font-medium text-gray-900">{job.job_number}</td>
                    <td className="px-4 py-3 text-gray-700">{job.date}</td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-700">{entityLabel(job)}</span>
                        <SourceBadge source={job.source} />
                      </div>
                      {(job.job_trucks ?? []).length > 0 && (
                        <p className="text-xs font-mono text-gray-400 mt-0.5">
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
                        ? <span className="font-medium text-gray-800">{fmtAUD(rev)}</span>
                        : <span className="text-gray-300">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/jobs/${job.id}/edit`} className="text-gray-400 hover:text-blue-600">
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
