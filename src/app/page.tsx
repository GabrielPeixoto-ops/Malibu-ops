'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { calculateJobRevenue, calculateClientRevenue, calculatePayroll } from '@/lib/billing'
import type { Employee, JobSource, JobStatus, Subcontractor, SubcontractorConfig } from '@/types/database'

// ─── Date utilities ───────────────────────────────────────────────────────────
function getMonday(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

function addDays(d: Date, n: number): Date {
  const date = new Date(d)
  date.setDate(date.getDate() + n)
  return date
}

function toISO(d: Date): string {
  return d.toISOString().split('T')[0]
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric' })
}

function fmtMonthYear(d: Date): string {
  return d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })
}

function fmtWeekRange(start: Date): string {
  const end = addDays(start, 6)
  const s = start.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  const e = end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${s} – ${e}`
}

function nowHHMM(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function lastOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

function getMonthGrid(ref: Date): Date[] {
  const first = firstOfMonth(ref)
  const dow = first.getDay() === 0 ? 6 : first.getDay() - 1
  const gridStart = addDays(first, -dow)
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface EmbeddedEmployee { id: string; name: string; hourly_rate: number }
interface CrewRow { employee_id: string; hours: number; cof_share: boolean; employee: EmbeddedEmployee | null }
interface MaterialRow { quantity: number; cost_price: number; sale_price: number }

interface CalendarJob {
  id: string
  job_number: string
  date: string
  status: JobStatus
  source: JobSource
  notes: string | null
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
  actual_start_time: string | null
  actual_finish_time: string | null
  subcontractor: Subcontractor | null
  customer: { name: string; billing_type: string | null; billing_config: Record<string, unknown> | null } | null
  contract: { name: string; billing_type: string; billing_config: Record<string, unknown> } | null
  contract_client: { name: string } | null
  job_crew: CrewRow[]
  job_materials: MaterialRow[]
  job_trucks: Array<{ fleet: { name: string; registration: string | null } | null }>
}

// ─── Constants ────────────────────────────────────────────────────────────────
const STATUS_CARD: Record<JobStatus, { bg: string; text: string; dot: string }> = {
  draft:       { bg: 'bg-gray-50 border-gray-200',     text: 'text-gray-600',   dot: 'bg-gray-400' },
  scheduled:   { bg: 'bg-blue-50 border-blue-200',     text: 'text-blue-700',   dot: 'bg-blue-500' },
  confirmed:   { bg: 'bg-indigo-50 border-indigo-200', text: 'text-indigo-700', dot: 'bg-indigo-500' },
  in_progress: { bg: 'bg-amber-50 border-amber-200',   text: 'text-amber-700',  dot: 'bg-amber-500' },
  completed:   { bg: 'bg-green-50 border-green-200',   text: 'text-green-700',  dot: 'bg-green-500' },
  reviewed:    { bg: 'bg-cyan-50 border-cyan-200',     text: 'text-cyan-700',   dot: 'bg-cyan-500' },
  invoiced:    { bg: 'bg-purple-50 border-purple-200', text: 'text-purple-700', dot: 'bg-purple-500' },
  paid:        { bg: 'bg-teal-50 border-teal-200',     text: 'text-teal-700',   dot: 'bg-teal-500' },
  cancelled:   { bg: 'bg-red-50 border-red-200',       text: 'text-red-600',    dot: 'bg-red-400' },
}

const fmt = (n: number) =>
  n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 })

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ─── Helpers ──────────────────────────────────────────────────────────────────
function entityLabel(job: CalendarJob): string {
  if (job.source === 'private') return job.customer?.name ?? '—'
  if (job.source === 'contract') {
    const base = job.contract?.name ?? '—'
    return job.contract_client?.name ? `${base} → ${job.contract_client.name}` : base
  }
  return job.subcontractor?.name ?? '—'
}

function calcJobRevenue(job: CalendarJob): number | null {
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

// ─── Component ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter()
  const supabase = createClient()

  const [view, setView] = useState<'week' | 'month'>('week')
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()))
  const [monthRef, setMonthRef] = useState<Date>(() => firstOfMonth(new Date()))
  const [jobs, setJobs] = useState<CalendarJob[]>([])
  const [loading, setLoading] = useState(true)

  const today = toISO(new Date())

  const [modal, setModal] = useState<{ type: 'start' | 'finish'; jobId: string; time: string } | null>(null)

  function openStart(jobId: string) { setModal({ type: 'start', jobId, time: nowHHMM() }) }
  function openFinish(jobId: string) { setModal({ type: 'finish', jobId, time: nowHHMM() }) }

  async function confirmModal() {
    if (!modal) return
    const { type, jobId, time } = modal
    setModal(null)
    if (type === 'start') {
      await supabase.from('jobs').update({ actual_start_time: time, status: 'in_progress' }).eq('id', jobId)
      setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, actual_start_time: time, status: 'in_progress' as JobStatus } : j))
    } else {
      await supabase.from('jobs').update({ actual_finish_time: time, status: 'completed' }).eq('id', jobId)
      setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, actual_finish_time: time, status: 'completed' as JobStatus } : j))
    }
  }

  // ── Fetch jobs ─────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    async function load() {
      const start = view === 'week' ? toISO(weekStart) : toISO(firstOfMonth(monthRef))
      const end = view === 'week' ? toISO(addDays(weekStart, 6)) : toISO(lastOfMonth(monthRef))

      // Step 1: load jobs — clean query without fleet join
      const { data, error } = await supabase
        .from('jobs')
        .select(`
          id, job_number, date, status, source, notes, cof, cof_final, additional_hours,
          additional_rate, rate_card_key, formula_vars, extra_men_hours, break_minutes, discount,
          actual_start_time, actual_finish_time, client_billing_config,
          subcontractor:subcontractors(*),
          customer:customers(name, billing_type, billing_config),
          contract:contracts(name, billing_type, billing_config),
          contract_client:contract_clients(name),
          job_crew(employee_id, hours, cof_share, employee:employees(id, name, hourly_rate)),
          job_materials(quantity, cost_price, sale_price)
        `)
        .gte('date', start)
        .lte('date', end)
        .order('date')

      if (error) console.error('dashboard jobs query error:', error.message)

      const baseJobs = (data ?? []) as unknown as Omit<CalendarJob, 'job_trucks'>[]

      // Step 2: truck plates — isolated query, skipped silently if tables don't exist
      const truckMap = new Map<string, CalendarJob['job_trucks']>()
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
          // fleet / job_trucks not yet migrated
        }
      }

      setJobs(baseJobs.map((j) => ({ ...j, job_trucks: truckMap.get(j.id) ?? [] })) as CalendarJob[])
      setLoading(false)
    }
    load()
  }, [view, weekStart, monthRef])

  // ── Week summary ───────────────────────────────────────────────────────────
  const weekSummary = useMemo(() => {
    let revenue = 0
    let payroll = 0
    for (const job of jobs) {
      revenue += calcJobRevenue(job) ?? 0
      const crew = job.job_crew.filter((c) => c.employee)
      const emps: Employee[] = crew.map((c) => c.employee!).filter(Boolean) as unknown as Employee[]
      payroll += calculatePayroll(crew, emps, Number(job.cof_final ?? job.cof ?? 0)).total
    }
    return { revenue, payroll, profit: revenue - payroll, count: jobs.length }
  }, [jobs])

  // ── Group jobs by date ─────────────────────────────────────────────────────
  const jobsByDate = useMemo(() => {
    const map = new Map<string, CalendarJob[]>()
    for (const job of jobs) {
      const list = map.get(job.date) ?? []
      list.push(job)
      map.set(job.date, list)
    }
    return map
  }, [jobs])

  // ── Navigation ─────────────────────────────────────────────────────────────
  function prevPeriod() {
    if (view === 'week') setWeekStart((d) => addDays(d, -7))
    else setMonthRef((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  }
  function nextPeriod() {
    if (view === 'week') setWeekStart((d) => addDays(d, 7))
    else setMonthRef((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
  }
  function goToday() {
    setWeekStart(getMonday(new Date()))
    setMonthRef(firstOfMonth(new Date()))
  }

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const monthGrid = useMemo(() => getMonthGrid(monthRef), [monthRef])

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={prevPeriod} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={goToday}
            className="text-sm font-semibold text-gray-700 min-w-[160px] text-center hover:text-blue-600"
          >
            {view === 'week' ? fmtWeekRange(weekStart) : fmtMonthYear(monthRef)}
          </button>
          <button onClick={nextPeriod} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            <button
              onClick={() => setView('week')}
              className={`px-3 py-1.5 ${view === 'week' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              Week
            </button>
            <button
              onClick={() => setView('month')}
              className={`px-3 py-1.5 ${view === 'month' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              Month
            </button>
          </div>
          <Link
            href="/jobs/new"
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus size={15} /> New Job
          </Link>
        </div>
      </div>

      {/* ── Summary cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Jobs" value={String(weekSummary.count)} />
        <SummaryCard label="Revenue" value={fmt(weekSummary.revenue)} color="text-gray-900" />
        <SummaryCard label="Payroll" value={fmt(weekSummary.payroll)} color="text-orange-600" />
        <SummaryCard
          label="Profit"
          value={fmt(weekSummary.profit)}
          color={weekSummary.profit >= 0 ? 'text-green-600' : 'text-red-600'}
        />
      </div>

      {/* ── Calendar ─────────────────────────────────────────────────────── */}
      {loading ? (
        <p className="text-gray-400 text-sm py-8 text-center">Loading…</p>
      ) : view === 'week' ? (
        <WeekView days={weekDays} jobsByDate={jobsByDate} today={today} onJobClick={(id) => router.push(`/jobs/${id}/edit`)} onStart={openStart} onFinish={openFinish} />
      ) : (
        <MonthView
          grid={monthGrid}
          monthRef={monthRef}
          jobsByDate={jobsByDate}
          today={today}
          onJobClick={(id) => router.push(`/jobs/${id}/edit`)}
        />
      )}

      {/* ── Quick-action modal ───────────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-xs">
            <h2 className="text-base font-semibold text-gray-900 mb-4">
              {modal.type === 'start' ? 'What time did the job start?' : 'What time did the job finish?'}
            </h2>
            <input
              type="time"
              value={modal.time}
              onChange={(e) => setModal((m) => m ? { ...m, time: e.target.value } : m)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setModal(null)}
                className="flex-1 px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmModal}
                className={`flex-1 px-4 py-2 text-sm font-semibold rounded-lg text-white ${modal.type === 'start' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-green-600 hover:bg-green-700'}`}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Source badge ─────────────────────────────────────────────────────────────
function SourceBadge({ source }: { source: JobSource }) {
  if (source === 'private') return <span className="inline-flex px-1 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700 leading-none">Private</span>
  if (source === 'contract') return <span className="inline-flex px-1 py-0.5 rounded text-[10px] font-semibold bg-teal-100 text-teal-700 leading-none">Contract</span>
  return null
}

// ─── Week view ────────────────────────────────────────────────────────────────
function WeekView({
  days,
  jobsByDate,
  today,
  onJobClick,
  onStart,
  onFinish,
}: {
  days: Date[]
  jobsByDate: Map<string, CalendarJob[]>
  today: string
  onJobClick: (id: string) => void
  onStart: (id: string) => void
  onFinish: (id: string) => void
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <div className="min-w-[640px]">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-gray-200">
          {days.map((day, i) => {
            const iso = toISO(day)
            const isToday = iso === today
            return (
              <div
                key={iso}
                className={`px-2 py-2 text-center border-r last:border-r-0 border-gray-100 ${isToday ? 'bg-blue-50' : ''}`}
              >
                <div className="text-xs text-gray-400">{WEEK_DAYS[i]}</div>
                <div className={`text-sm font-semibold mt-0.5 ${isToday ? 'text-blue-600' : 'text-gray-700'}`}>
                  {day.getDate()}
                </div>
              </div>
            )
          })}
        </div>

        {/* Job cards */}
        <div className="grid grid-cols-7 min-h-[200px]">
          {days.map((day) => {
            const iso = toISO(day)
            const dayJobs = jobsByDate.get(iso) ?? []
            const isToday = iso === today
            return (
              <div
                key={iso}
                className={`p-1.5 border-r last:border-r-0 border-gray-100 space-y-1 ${isToday ? 'bg-blue-50/40' : ''}`}
              >
                {dayJobs.map((job) => (
                  <JobCard key={job.id} job={job} today={today} onClick={() => onJobClick(job.id)} onStart={onStart} onFinish={onFinish} />
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Month view ───────────────────────────────────────────────────────────────
function MonthView({
  grid,
  monthRef,
  jobsByDate,
  today,
  onJobClick,
}: {
  grid: Date[]
  monthRef: Date
  jobsByDate: Map<string, CalendarJob[]>
  today: string
  onJobClick: (id: string) => void
}) {
  const currentMonth = monthRef.getMonth()

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-gray-200">
        {WEEK_DAYS.map((d) => (
          <div key={d} className="px-2 py-2 text-xs font-medium text-gray-400 text-center">
            {d}
          </div>
        ))}
      </div>

      {/* Weeks */}
      <div className="grid grid-cols-7">
        {grid.map((day) => {
          const iso = toISO(day)
          const dayJobs = jobsByDate.get(iso) ?? []
          const isToday = iso === today
          const isCurrentMonth = day.getMonth() === currentMonth

          return (
            <div
              key={iso}
              className={`
                min-h-[80px] p-1.5 border-r border-b last-of-type:border-r-0 border-gray-100
                ${isToday ? 'bg-blue-50/50' : ''}
                ${!isCurrentMonth ? 'bg-gray-50/50' : ''}
              `}
            >
              <div
                className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1
                  ${isToday ? 'bg-blue-600 text-white' : isCurrentMonth ? 'text-gray-700' : 'text-gray-300'}
                `}
              >
                {day.getDate()}
              </div>

              <div className="space-y-0.5">
                {dayJobs.slice(0, 3).map((job) => {
                  const s = STATUS_CARD[job.status]
                  return (
                    <button
                      key={job.id}
                      onClick={() => onJobClick(job.id)}
                      className={`w-full text-left text-xs px-1.5 py-0.5 rounded border truncate ${s.bg} ${s.text} hover:opacity-80`}
                    >
                      #{job.job_number} {entityLabel(job)}
                    </button>
                  )
                })}
                {dayJobs.length > 3 && (
                  <p className="text-xs text-gray-400 pl-1">+{dayJobs.length - 3} more</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Job card (week view) ─────────────────────────────────────────────────────
function JobCard({
  job,
  today,
  onClick,
  onStart,
  onFinish,
}: {
  job: CalendarJob
  today: string
  onClick: () => void
  onStart: (id: string) => void
  onFinish: (id: string) => void
}) {
  const s = STATUS_CARD[job.status]
  const revenue = calcJobRevenue(job)

  const isOverdue = (job.status === 'scheduled' || job.status === 'confirmed') && job.date <= today
  const isLate = job.status === 'in_progress' && job.date < today
  const alertRing = isOverdue
    ? 'ring-2 ring-red-500 animate-pulse'
    : isLate
    ? 'ring-2 ring-orange-500 animate-pulse'
    : ''

  const canStart = job.status === 'scheduled' || job.status === 'confirmed'
  const canFinish = job.status === 'in_progress'

  return (
    <div className={`w-full rounded-lg border text-xs ${s.bg} ${s.text} ${alertRing}`}>
      {/* Clickable info area */}
      <button
        onClick={onClick}
        className="w-full text-left p-1.5 hover:opacity-80 transition-opacity"
      >
        <div className="font-semibold truncate">#{job.job_number}</div>
        <div className="flex items-center gap-1 flex-wrap mt-0.5">
          <span className="truncate opacity-80">{entityLabel(job)}</span>
          <SourceBadge source={job.source} />
        </div>
        {revenue !== null && <div className="font-medium mt-0.5">{fmt(revenue)}</div>}
        <div className="flex items-center gap-1 mt-0.5">
          <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
          <span className="opacity-70 capitalize">{job.status.replace('_', ' ')}</span>
        </div>
        {(job.job_trucks ?? []).length > 0 && (
          <div className="mt-0.5 font-mono opacity-70">
            {(job.job_trucks ?? []).map((jt) => jt.fleet?.registration ?? jt.fleet?.name).filter(Boolean).join(' + ')}
          </div>
        )}
        {job.actual_start_time && (
          <div className="opacity-60 mt-0.5">▶ {job.actual_start_time}</div>
        )}
      </button>
      {/* Quick-action buttons */}
      {(canStart || canFinish) && (
        <div className="px-1.5 pb-1.5">
          {canStart && (
            <button
              onClick={(e) => { e.stopPropagation(); onStart(job.id) }}
              className="w-full text-center text-xs font-semibold py-1 rounded bg-amber-500 hover:bg-amber-600 text-white"
            >
              Start
            </button>
          )}
          {canFinish && (
            <button
              onClick={(e) => { e.stopPropagation(); onFinish(job.id) }}
              className="w-full text-center text-xs font-semibold py-1 rounded bg-green-600 hover:bg-green-700 text-white"
            >
              Finish
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Summary card ─────────────────────────────────────────────────────────────
function SummaryCard({ label, value, color = 'text-gray-900' }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
    </div>
  )
}

// suppress unused import warning from fmtDay
void fmtDay
