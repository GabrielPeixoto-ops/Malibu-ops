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
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
interface CrewRow { employee_id: string; hours: number; cof_share: boolean; cof_hours: number; heavy_item: boolean; start_time: string | null; end_time: string | null; employee: EmbeddedEmployee | null }
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
  heavy_item_charge: number | null
  override_revenue: number | null
  malibu_revenue: number | null
  scheduled_time: string | null
  client_billing_config: Record<string, unknown> | null
  actual_start_time: string | null
  actual_finish_time: string | null
  subcontractor_rate_id: string | null
  contract_rate_id: string | null
  google_review: boolean
  google_review_employee_ids: string[]
  subcontractor: Subcontractor | null
  customer: { name: string; billing_type: string | null; billing_config: Record<string, unknown> | null } | null
  contract: { name: string; billing_type: string; billing_config: Record<string, unknown>; color_hex: string | null } | null
  contract_client: { name: string } | null
  job_crew: CrewRow[]
  job_materials: MaterialRow[]
  job_expenses: Array<{ amount: number; is_client_expense: boolean }>
  job_casual_crew: Array<{ name: string; rate_per_hour: number; heavy_item: boolean; cof_share: boolean; start_time: string | null; finish_time: string | null; casual_worker_id: string | null }>
  job_commissions: Array<{ employee_id: string | null; casual_worker_id: string | null; rate_per_hour: number; hours: number }>
  job_extra_men: Array<{ employee_id: string | null; name: string | null; rate_per_hour: number | null; start_time: string | null; finish_time: string | null; cof_share: boolean; client_charge_amount: number }>
  job_trucks: Array<{ fleet: { name: string; registration: string | null } | null }>
  subcontractor_rate_ph: number | null
  contract_rate_ph: number | null
}

// ─── Constants ────────────────────────────────────────────────────────────────
const STATUS_CARD: Record<JobStatus, { bg: string; text: string; dot: string }> = {
  draft:       { bg: 'bg-surface border-wire',              text: 'text-warm',        dot: 'bg-dim' },
  scheduled:   { bg: 'bg-blue-950/70 border-blue-800/40',   text: 'text-blue-300',    dot: 'bg-blue-400' },
  confirmed:   { bg: 'bg-indigo-950/70 border-indigo-800/40', text: 'text-indigo-300', dot: 'bg-indigo-400' },
  in_progress: { bg: 'bg-amber-950/70 border-amber-800/40', text: 'text-amber-300',   dot: 'bg-amber-400' },
  completed:   { bg: 'bg-green-950/70 border-green-800/40', text: 'text-green-300',   dot: 'bg-green-400' },
  reviewed:    { bg: 'bg-cyan-950/70 border-cyan-800/40',   text: 'text-cyan-300',    dot: 'bg-cyan-400' },
  invoiced:    { bg: 'bg-purple-950/70 border-purple-800/40', text: 'text-purple-300', dot: 'bg-purple-400' },
  paid:        { bg: 'bg-teal-950/70 border-teal-800/40',   text: 'text-teal-300',    dot: 'bg-teal-400' },
  cancelled:   { bg: 'bg-red-950/70 border-red-900/40',     text: 'text-red-400',     dot: 'bg-red-500' },
}

const fmt = (n: number) =>
  n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 })

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const FALLBACK_COLOR = '#6B6660'

function getEntityColor(job: CalendarJob, privateColor: string | null): string | undefined {
  if (job.source === 'private') return privateColor ?? '#D4AF37'
  if (job.source === 'subcontract') return job.subcontractor?.color_hex ?? FALLBACK_COLOR
  if (job.source === 'contract') return job.contract?.color_hex ?? FALLBACK_COLOR
  return undefined
}

function entityLabel(job: CalendarJob): string {
  if (job.source === 'private') return job.customer?.name ?? '—'
  if (job.source === 'contract') {
    const base = job.contract?.name ?? '—'
    return job.contract_client?.name ? `${base} → ${job.contract_client.name}` : base
  }
  return job.subcontractor?.name ?? '—'
}

function calcJobRevenue(job: CalendarJob): number | null {
  let base: number | null = null

  if (job.source === 'subcontract') {
    if (!job.subcontractor) return null
    if (job.subcontractor.billing_type === 'percent') {
      base = job.malibu_revenue != null && job.malibu_revenue > 0 ? job.malibu_revenue : null
    } else {
      const effectiveOverride = job.malibu_revenue ?? job.override_revenue
      base = calculateJobRevenue({ ...job, override_revenue: effectiveOverride }, job.subcontractor, job.subcontractor_rate_ph)
    }
  } else if (job.source === 'private') {
    base = job.malibu_revenue != null && job.malibu_revenue > 0 ? job.malibu_revenue : null
  } else {
    // Contract: use malibu_revenue when available (saved on completion), fallback to live calc
    if (job.malibu_revenue != null && job.malibu_revenue > 0) {
      base = job.malibu_revenue
    } else {
      const entity = job.contract
      if (!entity?.billing_type || !entity?.billing_config) return null
      base = calculateClientRevenue(
        { ...job, client_billing_config: job.client_billing_config as SubcontractorConfig | null },
        entity.billing_type,
        entity.billing_config as unknown as SubcontractorConfig,
        job.contract_rate_ph
      )
    }
  }

  if (base === null) return null
  const clientExpenses = job.job_expenses.filter(e => e.is_client_expense).reduce((s, e) => s + e.amount, 0)
  const materialsRevenue = job.job_materials.reduce((s, m) => s + Number(m.quantity) * Number(m.sale_price), 0)
  // What we charge the client for each Extra Man — separate from what the
  // extra man is paid, and independent of source (subcontract/private/contract).
  const extraMenRevenue = (job.job_extra_men ?? []).reduce((s, em) => s + (Number(em.client_charge_amount) || 0), 0)
  const total = base + materialsRevenue + (Number(job.heavy_item_charge) || 0) + extraMenRevenue - (Number(job.discount) || 0) + clientExpenses
  return total > 0 ? total : null
}

// Costs that reduce Profit but are NOT part of Revenue: materials cost price,
// and company-side expenses (is_client_expense = false). Mirrors calculateJobSummary
// in billing.ts: profit = netRevenue - payrollTotal - materialsCost - companyExpensesTotal
function calcJobDeductions(job: CalendarJob): number {
  const materialsCost = job.job_materials.reduce((s, m) => s + Number(m.quantity) * Number(m.cost_price), 0)
  const companyExpenses = job.job_expenses.filter(e => !e.is_client_expense).reduce((s, e) => s + e.amount, 0)
  return materialsCost + companyExpenses
}

// Always rounds UP to the next 15-minute block. Used for BOTH job-level
// actual_start_time/actual_finish_time AND individual per-person times
// (job_crew / job_casual_crew) — same single rule everywhere, matching
// JobForm's calcCrewHours / _billingWorkedHrs.
// breakMinutes (job-level only) is subtracted BEFORE rounding, same order as
// JobForm's workedHoursCalc — subtracting it after rounding instead gives a
// different (wrong) result, since the break may cross a 15-min boundary.
function calcHoursFromTimes(start: string, finish: string, breakMinutes = 0): number {
  const [sh, sm] = start.split(':').map(Number)
  const [fh, fm] = finish.split(':').map(Number)
  const mins = (fh * 60 + fm) - (sh * 60 + sm) - breakMinutes
  return Math.max(0, Math.ceil(mins / 15) * 15 / 60)
}

function buildStaffPayrollCrew(job: CalendarJob, crew: CrewRow[]): Array<{ employee_id: string; hours: number; cof_share: boolean; cof_hours: number; heavy_item?: boolean }> {
  const cofFinalHrs = Number(job.cof_final ?? job.cof) || 0
  const liveWorkedHrs = (() => {
    if (!job.actual_start_time || !job.actual_finish_time) return null
    const hrs = calcHoursFromTimes(job.actual_start_time, job.actual_finish_time, Number(job.break_minutes) || 0)
    return hrs > 0 ? hrs : null
  })()
  return crew.map(r => {
    const hasIndividualTime = r.start_time?.length === 5 && r.end_time?.length === 5
    let hours: number
    if (hasIndividualTime) {
      // Individual times: recompute live from start/end, same rounding rule
      // as job-level. Don't trust the stored `hours` column — it may have
      // been saved before this rounding rule existed.
      hours = calcHoursFromTimes(r.start_time!, r.end_time!)
    } else if (liveWorkedHrs !== null) {
      // Job-level times: recompute live, same as job page does
      hours = Math.max(2, liveWorkedHrs)
    } else {
      // No actual times: fall back to stored hours
      hours = r.hours
    }
    // Let calculatePayroll add Call Out Fee hours from cof_share/cof_hours,
    // same as JobForm does — never bake COF into `hours` here, or it gets lost
    // for crew with individual times (that branch doesn't touch cofFinalHrs at all).
    return { employee_id: r.employee_id, hours, cof_share: r.cof_share, cof_hours: r.cof_share ? cofFinalHrs : 0, heavy_item: r.heavy_item }
  })
}

function buildCasualPayroll(job: CalendarJob): Array<{ name: string; rate_per_hour: number; hours: number; heavy_item: boolean; casual_worker_id: string | null }> {
  const MIN_CALL = 2
  const cofFinalHrs = Number(job.cof_final ?? job.cof) || 0
  let billingWorkedHrs: number | null = null
  if (job.actual_start_time && job.actual_finish_time) {
    const withBreak = calcHoursFromTimes(job.actual_start_time, job.actual_finish_time, Number(job.break_minutes) || 0)
    if (withBreak > 0) billingWorkedHrs = withBreak
  }
  return job.job_casual_crew
    .filter(r => r.name.trim())
    .map(r => {
      const hasTime = r.start_time?.length === 5 && r.finish_time?.length === 5
      let hours: number
      if (hasTime) {
        const rawHours = calcHoursFromTimes(r.start_time!, r.finish_time!)
        hours = (rawHours > 0 ? Math.max(MIN_CALL, rawHours) : 0) + (r.cof_share ? cofFinalHrs : 0)
      } else if (billingWorkedHrs !== null) {
        hours = Math.max(MIN_CALL, billingWorkedHrs) + (r.cof_share ? cofFinalHrs : 0)
      } else {
        hours = r.cof_share ? cofFinalHrs : 0
      }
      return { name: r.name, rate_per_hour: r.rate_per_hour, hours, heavy_item: r.heavy_item, casual_worker_id: r.casual_worker_id }
    })
}

// Extra men are extra crew for the same call-out. Hours come from their own
// start/finish times (falling back to job-level times, same as crew); COF is
// added separately by calculatePayroll based on cof_share, never baked in here
// — same convention as buildStaffPayrollCrew. client_charge_amount is what we
// bill the client for adding this person; it's pure revenue and independent
// of what they're actually paid.
function buildExtraMenPayroll(
  job: CalendarJob,
  employees: Employee[],
  casualWorkers: Array<{ id: string; name: string; rate_per_hour: number }>
): Array<{ employee_id: string; hours: number; hourly_rate?: number; employee_name?: string; cof_share: boolean; client_charge: number }> {
  const liveWorkedHrs = (() => {
    if (!job.actual_start_time || !job.actual_finish_time) return null
    const hrs = calcHoursFromTimes(job.actual_start_time, job.actual_finish_time, Number(job.break_minutes) || 0)
    return hrs > 0 ? hrs : null
  })()
  return (job.job_extra_men ?? [])
    .filter((r) => r.employee_id || (r.name && r.name.trim()))
    .map((r) => {
      const hasTime = r.start_time?.length === 5 && r.finish_time?.length === 5
      let hours: number
      if (hasTime) {
        hours = calcHoursFromTimes(r.start_time!, r.finish_time!)
      } else if (liveWorkedHrs !== null) {
        hours = Math.max(2, liveWorkedHrs)
      } else {
        hours = 0
      }
      // Prefer the per-job name/rate captured at save time (free-text entry,
      // same convention as job_casual_crew) — fall back to a live employee_id
      // lookup for rows saved before those columns existed.
      const staffEmp = employees.find((e) => e.id === r.employee_id)
      const casualWorker = staffEmp ? null : casualWorkers.find((cw) => cw.id === r.employee_id)
      return {
        employee_id: r.employee_id ?? '',
        hours,
        hourly_rate: r.rate_per_hour ?? staffEmp?.hourly_rate ?? casualWorker?.rate_per_hour,
        employee_name: (r.name && r.name.trim()) || staffEmp?.name || casualWorker?.name,
        cof_share: r.cof_share,
        client_charge: Number(r.client_charge_amount) || 0,
      }
    })
}

function buildCommissionsForPayroll(job: CalendarJob): Array<{ employee_id: string | null; casual_worker_id: string | null; casual_worker_name: string; rate_per_hour: number; hours: number; label: string }> {
  return job.job_commissions
    .filter(r => (r.employee_id || r.casual_worker_id) && r.hours > 0 && r.rate_per_hour > 0)
    .map(r => ({
      employee_id: null,
      casual_worker_id: r.employee_id ?? r.casual_worker_id ?? 'commission',
      casual_worker_name: 'Commission',
      rate_per_hour: r.rate_per_hour,
      hours: r.hours,
      label: 'Commission',
    }))
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter()
  const supabase = createClient()

  const [view, setView] = useState<'week' | 'month' | 'day'>('week')
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()))
  const [monthRef, setMonthRef] = useState<Date>(() => firstOfMonth(new Date()))
  const [dayRef, setDayRef] = useState<Date>(() => new Date())
  const [jobs, setJobs] = useState<CalendarJob[]>([])
  const [loading, setLoading] = useState(true)
  const [privateColor, setPrivateColor] = useState<string | null>(null)
  // Full staff + casual worker lists, needed to resolve Extra Men entries
  // (job_extra_men has no rate_per_hour of its own — it can point at either an
  // employee or a casual_worker, same as JobForm's "Select employee…" dropdown).
  const [allEmployees, setAllEmployees] = useState<Employee[]>([])
  const [allCasualWorkers, setAllCasualWorkers] = useState<Array<{ id: string; name: string; rate_per_hour: number }>>([])

  const today = toISO(new Date())

  const [modal, setModal] = useState<{ type: 'start' | 'finish'; jobId: string; time: string } | null>(null)
  const [draggingJobId, setDraggingJobId] = useState<string | null>(null)
  const [dragOverDate, setDragOverDate] = useState<string | null>(null)

  function openStart(jobId: string) { setModal({ type: 'start', jobId, time: nowHHMM() }) }
  function openFinish(jobId: string) { setModal({ type: 'finish', jobId, time: nowHHMM() }) }

  async function handleJobDrop(newDate: string) {
    if (!draggingJobId) return
    const job = jobs.find((j) => j.id === draggingJobId)
    if (!job || job.date === newDate) { setDraggingJobId(null); setDragOverDate(null); return }
    const jobId = draggingJobId
    setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, date: newDate } : j))
    setDraggingJobId(null)
    setDragOverDate(null)
    await supabase.from('jobs').update({ date: newDate }).eq('id', jobId)
  }

  async function confirmModal() {
    if (!modal) return
    const { type, jobId, time } = modal
    if (!time) return
    setModal(null)
    if (type === 'start') {
      const { error } = await supabase
        .from('jobs')
        .update({ actual_start_time: time, status: 'in_progress' })
        .eq('id', jobId)
      if (error) { alert(`Failed to start job: ${error.message}`); return }
      setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, actual_start_time: time, status: 'in_progress' as JobStatus } : j))
    } else {
      const { error } = await supabase
        .from('jobs')
        .update({ actual_finish_time: time, status: 'completed' })
        .eq('id', jobId)
      if (error) { alert(`Failed to complete job: ${error.message}`); return }
      setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, actual_finish_time: time, status: 'completed' as JobStatus } : j))
    }
  }

  useEffect(() => {
    supabase
      .from('entity_colors')
      .select('color_hex')
      .eq('entity_key', 'private')
      .maybeSingle()
      .then(({ data }) => { if (data?.color_hex) setPrivateColor(data.color_hex) })
    supabase.from('employees').select('*').eq('active', true).then(({ data }) => setAllEmployees((data ?? []) as Employee[]))
    supabase.from('casual_workers').select('id, name, rate_per_hour').then(({ data }) => setAllCasualWorkers((data ?? []) as Array<{ id: string; name: string; rate_per_hour: number }>))
  }, [])

  useEffect(() => {
    setLoading(true)
    void load()
    async function load() {
      const start = view === 'week' ? toISO(weekStart) : view === 'day' ? toISO(dayRef) : toISO(firstOfMonth(monthRef))
      const end = view === 'week' ? toISO(addDays(weekStart, 6)) : view === 'day' ? toISO(dayRef) : toISO(lastOfMonth(monthRef))

      const { data, error } = await supabase
        .from('jobs')
        .select(`
          id, job_number, date, status, source, notes, cof, cof_final, additional_hours,
          additional_rate, rate_card_key, formula_vars, extra_men_hours, break_minutes, discount, heavy_item_charge,
          actual_start_time, actual_finish_time, scheduled_time, override_revenue, malibu_revenue, client_billing_config,
          subcontractor_rate_id, contract_rate_id, google_review, google_review_employee_ids,
          subcontractor:subcontractors(*),
          customer:customers(name, billing_type, billing_config),
          contract:contracts(name, billing_type, billing_config, color_hex),
          contract_client:contract_clients(name),
          job_crew(employee_id, hours, cof_share, cof_hours, heavy_item, start_time, end_time, employee:employees(id, name, hourly_rate)),
          job_materials(quantity, cost_price, sale_price),
          job_expenses(amount, is_client_expense),
          job_casual_crew(name, rate_per_hour, heavy_item, cof_share, start_time, finish_time, casual_worker_id),
          job_commissions(employee_id, casual_worker_id, rate_per_hour, hours),
          job_extra_men(employee_id, name, rate_per_hour, start_time, finish_time, cof_share, client_charge_amount)
        `)
        .gte('date', start)
        .lte('date', end)
        .neq('status', 'cancelled')
        .order('date')

      if (error) console.error('dashboard jobs query error:', error.message)

      const baseJobs = (data ?? []) as unknown as Omit<CalendarJob, 'job_trucks' | 'subcontractor_rate_ph' | 'contract_rate_ph'>[]

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
        } catch { /* fleet / job_trucks not yet migrated */ }
      }

      const subRatePHMap = new Map<string, number>()
      const contractRatePHMap = new Map<string, number>()
      const uniqueSubRateIds = [...new Set(baseJobs.map(j => j.subcontractor_rate_id).filter(Boolean) as string[])]
      const uniqueContractRateIds = [...new Set(baseJobs.map(j => j.contract_rate_id).filter(Boolean) as string[])]
      if (uniqueSubRateIds.length > 0) {
        try {
          const { data: srRows } = await supabase.from('subcontractor_rates').select('id, rate_per_hour').in('id', uniqueSubRateIds)
          for (const r of (srRows ?? []) as Array<{ id: string; rate_per_hour: number }>) subRatePHMap.set(r.id, r.rate_per_hour)
        } catch { /* table not yet migrated */ }
      }
      if (uniqueContractRateIds.length > 0) {
        try {
          const { data: crRows } = await supabase.from('contract_rates').select('id, rate_per_hour').in('id', uniqueContractRateIds)
          for (const r of (crRows ?? []) as Array<{ id: string; rate_per_hour: number }>) contractRatePHMap.set(r.id, r.rate_per_hour)
        } catch { /* table not yet migrated */ }
      }

      setJobs(baseJobs.map((j) => ({
        ...j,
        job_trucks: truckMap.get(j.id) ?? [],
        job_expenses: (j as unknown as { job_expenses?: CalendarJob['job_expenses'] }).job_expenses ?? [],
        job_casual_crew: (j as unknown as { job_casual_crew?: CalendarJob['job_casual_crew'] }).job_casual_crew ?? [],
        job_commissions: (j as unknown as { job_commissions?: CalendarJob['job_commissions'] }).job_commissions ?? [],
        job_extra_men: (j as unknown as { job_extra_men?: CalendarJob['job_extra_men'] }).job_extra_men ?? [],
        subcontractor_rate_ph: j.subcontractor_rate_id ? (subRatePHMap.get(j.subcontractor_rate_id) ?? null) : null,
        contract_rate_ph: j.contract_rate_id ? (contractRatePHMap.get(j.contract_rate_id) ?? null) : null,
      })) as CalendarJob[])
      setLoading(false)
    }
  }, [view, weekStart, monthRef, dayRef])

  const weekSummary = useMemo(() => {
    let revenue = 0
    let payroll = 0
    let deductions = 0
    for (const job of jobs) {
      revenue += calcJobRevenue(job) ?? 0
      const crew = job.job_crew.filter((c) => c.employee)
      const emps: Employee[] = crew.map((c) => c.employee!).filter(Boolean) as unknown as Employee[]
      const reviewIds = job.google_review ? (job.google_review_employee_ids ?? []) : []
      payroll += calculatePayroll(buildStaffPayrollCrew(job, crew), emps, 0, reviewIds, buildExtraMenPayroll(job, allEmployees, allCasualWorkers), buildCasualPayroll(job), buildCommissionsForPayroll(job)).total
      deductions += calcJobDeductions(job)
    }
    const netRevenue = revenue > 0 ? revenue / 1.1 : 0
    return { revenue, payroll, profit: netRevenue - payroll - deductions, count: jobs.length }
  }, [jobs, allEmployees, allCasualWorkers])

  const jobsByDate = useMemo(() => {
    const map = new Map<string, CalendarJob[]>()
    for (const job of jobs) {
      const list = map.get(job.date) ?? []
      list.push(job)
      map.set(job.date, list)
    }
    return map
  }, [jobs])

  function prevPeriod() {
    if (view === 'week') setWeekStart((d) => addDays(d, -7))
    else if (view === 'day') setDayRef((d) => addDays(d, -1))
    else setMonthRef((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  }
  function nextPeriod() {
    if (view === 'week') setWeekStart((d) => addDays(d, 7))
    else if (view === 'day') setDayRef((d) => addDays(d, 1))
    else setMonthRef((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
  }
  function goToday() {
    setWeekStart(getMonday(new Date()))
    setMonthRef(firstOfMonth(new Date()))
    setDayRef(new Date())
  }

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const monthGrid = useMemo(() => getMonthGrid(monthRef), [monthRef])

  return (
    <div className="flex flex-col gap-4">
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button onClick={prevPeriod} className="p-1.5 rounded-lg hover:bg-panel text-warm hover:text-parchment transition-colors">
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={goToday}
            className="text-sm font-semibold text-parchment min-w-[160px] text-center hover:text-gold transition-colors px-2"
          >
            {view === 'week' ? fmtWeekRange(weekStart) : view === 'day' ? dayRef.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : fmtMonthYear(monthRef)}
          </button>
          <button onClick={nextPeriod} className="p-1.5 rounded-lg hover:bg-panel text-warm hover:text-parchment transition-colors">
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-wire overflow-hidden text-sm">
            {(['day', 'week', 'month'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 capitalize transition-colors ${view === v ? 'bg-gold text-[#0d0d0d] font-semibold' : 'bg-surface text-warm hover:bg-panel hover:text-parchment'}`}
              >
                {v}
              </button>
            ))}
          </div>
          <Link
            href="/jobs/new"
            className="flex items-center gap-1.5 bg-gold hover:bg-gold-bright text-void text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus size={15} /> New Job
          </Link>
        </div>
      </div>

      {/* ── Summary cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Jobs" value={String(weekSummary.count)} />
        <SummaryCard label="Revenue" value={fmt(weekSummary.revenue)} />
        <SummaryCard label="Payroll" value={fmt(weekSummary.payroll)} valueClass="text-amber-300" />
        <SummaryCard
          label="Profit"
          value={fmt(weekSummary.profit)}
          valueClass={weekSummary.profit >= 0 ? 'text-success' : 'text-danger'}
        />
      </div>

      {/* ── Calendar ─────────────────────────────────────────────────────── */}
      {loading ? (
        <p className="text-warm text-sm py-8 text-center">Loading…</p>
      ) : view === 'day' ? (
        <DayView jobs={jobsByDate.get(toISO(dayRef)) ?? []} today={today} onJobClick={(id) => router.push(`/jobs/${id}/edit`)} onStart={openStart} onFinish={openFinish} privateColor={privateColor} />
      ) : view === 'week' ? (
        <WeekView
          days={weekDays}
          jobsByDate={jobsByDate}
          today={today}
          onJobClick={(id) => router.push(`/jobs/${id}/edit`)}
          onStart={openStart}
          onFinish={openFinish}
          draggingJobId={draggingJobId}
          dragOverDate={dragOverDate}
          onDragStart={setDraggingJobId}
          onDragEnd={() => { setDraggingJobId(null); setDragOverDate(null) }}
          onDragOver={setDragOverDate}
          onDrop={handleJobDrop}
          privateColor={privateColor}
          allEmployees={allEmployees}
          allCasualWorkers={allCasualWorkers}
        />
      ) : (
        <MonthView
          grid={monthGrid}
          monthRef={monthRef}
          jobsByDate={jobsByDate}
          today={today}
          onJobClick={(id) => router.push(`/jobs/${id}/edit`)}
          draggingJobId={draggingJobId}
          dragOverDate={dragOverDate}
          onDragStart={setDraggingJobId}
          onDragEnd={() => { setDraggingJobId(null); setDragOverDate(null) }}
          onDragOver={setDragOverDate}
          onDrop={handleJobDrop}
          privateColor={privateColor}
        />
      )}

      {/* ── Quick-action modal ───────────────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="bg-white border border-[#e5e4e0] rounded-xl shadow-2xl p-6 w-full max-w-xs">
            <h2 className="text-base font-display font-semibold text-[#18181a] mb-4">
              {modal.type === 'start' ? 'What time did the job start?' : 'What time did the job finish?'}
            </h2>
            <input
              type="time"
              value={modal.time}
              onChange={(e) => setModal((m) => m ? { ...m, time: e.target.value } : m)}
              className="w-full px-3 py-2 border border-[#e5e4e0] rounded-lg text-sm bg-white text-[#18181a] focus:outline-none focus:border-[#C9A227] focus:ring-1 focus:ring-[#C9A227] mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setModal(null)}
                className="flex-1 px-4 py-2 text-sm border border-[#e5e4e0] rounded-lg text-[#52504c] hover:bg-[#f8f7f3] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmModal}
                className={`flex-1 px-4 py-2 text-sm font-semibold rounded-lg text-white transition-colors ${modal.type === 'start' ? 'bg-amber-500 hover:bg-amber-400' : 'bg-green-600 hover:bg-green-500'}`}
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

// Status badge styles (light-theme-safe) used outside calendar job cards
const LIGHT_STATUS_BADGE: Record<JobStatus, string> = {
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

// ─── Source badge ─────────────────────────────────────────────────────────────
function SourceBadge({ source }: { source: JobSource }) {
  if (source === 'private') return <span className="inline-flex px-1 py-0.5 rounded text-[9px] font-semibold bg-gold/15 text-gold leading-none">Private</span>
  if (source === 'contract') return <span className="inline-flex px-1 py-0.5 rounded text-[9px] font-semibold bg-teal-500/15 text-teal-600 leading-none">Contract</span>
  return null
}

// ─── Week view ────────────────────────────────────────────────────────────────
function WeekView({
  days, jobsByDate, today, onJobClick, onStart, onFinish,
  draggingJobId, dragOverDate, onDragStart, onDragEnd, onDragOver, onDrop, privateColor,
  allEmployees, allCasualWorkers,
}: {
  days: Date[]
  jobsByDate: Map<string, CalendarJob[]>
  today: string
  onJobClick: (id: string) => void
  onStart: (id: string) => void
  onFinish: (id: string) => void
  draggingJobId: string | null
  dragOverDate: string | null
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDragOver: (date: string) => void
  onDrop: (date: string) => void
  privateColor: string | null
  allEmployees: Employee[]
  allCasualWorkers: Array<{ id: string; name: string; rate_per_hour: number }>
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-wire bg-surface">
      <div className="min-w-[640px]">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-wire">
          {days.map((day, i) => {
            const iso = toISO(day)
            const isToday = iso === today
            return (
              <div
                key={iso}
                className={`px-2 py-2 text-center border-r last:border-r-0 border-wire ${isToday ? 'bg-gold/5' : ''}`}
              >
                <div className="text-xs text-dim">{WEEK_DAYS[i]}</div>
                <div className={`text-sm font-semibold mt-0.5 w-6 h-6 flex items-center justify-center rounded-full mx-auto ${isToday ? 'bg-gold text-void' : 'text-parchment'}`}>
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
            const isDragOver = dragOverDate === iso
            return (
              <div
                key={iso}
                className={`p-1.5 border-r last:border-r-0 border-wire space-y-1 transition-colors
                  ${isToday ? 'bg-gold/3' : ''}
                  ${isDragOver ? 'bg-gold/10 ring-2 ring-inset ring-gold-ring' : ''}`}
                onDragOver={(e) => { e.preventDefault(); onDragOver(iso) }}
                onDrop={(e) => { e.preventDefault(); onDrop(iso) }}
              >
                {dayJobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    today={today}
                    onClick={() => onJobClick(job.id)}
                    onStart={onStart}
                    onFinish={onFinish}
                    isDragging={draggingJobId === job.id}
                    onDragStart={() => onDragStart(job.id)}
                    onDragEnd={onDragEnd}
                    privateColor={privateColor}
                    allEmployees={allEmployees}
                    allCasualWorkers={allCasualWorkers}
                  />
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
  grid, monthRef, jobsByDate, today, onJobClick,
  draggingJobId, dragOverDate, onDragStart, onDragEnd, onDragOver, onDrop, privateColor,
}: {
  grid: Date[]
  monthRef: Date
  jobsByDate: Map<string, CalendarJob[]>
  today: string
  onJobClick: (id: string) => void
  draggingJobId: string | null
  dragOverDate: string | null
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDragOver: (date: string) => void
  onDrop: (date: string) => void
  privateColor: string | null
}) {
  const currentMonth = monthRef.getMonth()

  return (
    <div className="rounded-xl border border-wire bg-surface overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-wire">
        {WEEK_DAYS.map((d) => (
          <div key={d} className="px-2 py-2 text-xs font-medium text-dim text-center uppercase tracking-wide">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {grid.map((day) => {
          const iso = toISO(day)
          const dayJobs = jobsByDate.get(iso) ?? []
          const isToday = iso === today
          const isCurrentMonth = day.getMonth() === currentMonth
          const isDragOver = dragOverDate === iso

          return (
            <div
              key={iso}
              className={`
                min-h-[80px] p-1.5 border-r border-b last-of-type:border-r-0 border-wire transition-colors
                ${isToday ? 'bg-gold/4' : ''}
                ${!isCurrentMonth ? 'opacity-40' : ''}
                ${isDragOver ? 'bg-gold/10 ring-2 ring-inset ring-gold-ring' : ''}
              `}
              onDragOver={(e) => { e.preventDefault(); onDragOver(iso) }}
              onDrop={(e) => { e.preventDefault(); onDrop(iso) }}
            >
              <div
                className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1
                  ${isToday ? 'bg-gold text-void' : 'text-warm'}
                `}
              >
                {day.getDate()}
              </div>

              <div className="space-y-0.5">
                {dayJobs.slice(0, 3).map((job) => {
                  const s = STATUS_CARD[job.status]
                  const ec = getEntityColor(job, privateColor)
                  return (
                    <button
                      key={job.id}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); onDragStart(job.id) }}
                      onDragEnd={onDragEnd}
                      onClick={() => onJobClick(job.id)}
                      className={`w-full text-left text-xs px-1.5 py-0.5 rounded border truncate ${s.bg} ${s.text} hover:opacity-80 cursor-grab font-mono`}
                      style={{
                        ...(ec ? { borderLeftColor: ec, borderLeftWidth: '2px' } : {}),
                        opacity: draggingJobId === job.id ? 0.4 : 1,
                      }}
                    >
                      #{job.job_number} {entityLabel(job)}
                    </button>
                  )
                })}
                {dayJobs.length > 3 && (
                  <p className="text-xs text-dim pl-1">+{dayJobs.length - 3} more</p>
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
  job, today, onClick, onStart, onFinish, isDragging, onDragStart, onDragEnd, privateColor,
  allEmployees, allCasualWorkers,
}: {
  job: CalendarJob
  today: string
  onClick: () => void
  onStart: (id: string) => void
  onFinish: (id: string) => void
  isDragging?: boolean
  onDragStart?: () => void
  onDragEnd?: () => void
  privateColor: string | null
  allEmployees: Employee[]
  allCasualWorkers: Array<{ id: string; name: string; rate_per_hour: number }>
}) {
  const s = STATUS_CARD[job.status]
  const revenue = calcJobRevenue(job)
  const entityColor = getEntityColor(job, privateColor)
  const jobProfit = (() => {
    if (revenue === null) return null
    const crew = job.job_crew.filter((c) => c.employee)
    if (!crew.length && !(job.job_extra_men ?? []).some((r) => r.employee_id || (r.name && r.name.trim()))) return null
    const emps = crew.map((c) => c.employee!).filter(Boolean) as unknown as Employee[]
    const staffCrew = buildStaffPayrollCrew(job, crew)
    const commissionsInput = buildCommissionsForPayroll(job)
    const reviewIds = job.google_review ? (job.google_review_employee_ids ?? []) : []
    const payroll = calculatePayroll(staffCrew, emps, 0, reviewIds, buildExtraMenPayroll(job, allEmployees, allCasualWorkers), buildCasualPayroll(job), commissionsInput).total
    return revenue / 1.1 - payroll - calcJobDeductions(job)
  })()

  const _now = new Date()
  const _currentTime = `${String(_now.getHours()).padStart(2,'0')}:${String(_now.getMinutes()).padStart(2,'0')}`
  const isOverdue = (job.status === 'scheduled' || job.status === 'confirmed') && (
    job.date < today ||
    (job.date === today && !!job.scheduled_time && job.scheduled_time <= _currentTime)
  )
  const isLate = job.status === 'in_progress' && job.date < today
  const alertRing = isOverdue
    ? 'ring-2 ring-danger animate-pulse'
    : isLate
    ? 'ring-2 ring-amber-500 animate-pulse'
    : ''

  const canStart = job.status === 'scheduled' || job.status === 'confirmed'
  const canFinish = job.status === 'in_progress'

  return (
    <div
      className={`w-full rounded-lg border text-xs ${s.bg} ${s.text} ${alertRing} cursor-grab`}
      style={{
        ...(entityColor ? { borderLeftColor: entityColor, borderLeftWidth: '3px' } : {}),
        opacity: isDragging ? 0.4 : 1,
      }}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.() }}
      onDragEnd={onDragEnd}
    >
      <button
        onClick={onClick}
        className="w-full text-left p-1.5 hover:opacity-80 transition-opacity"
      >
        <div className="font-mono font-semibold truncate">#{job.job_number}</div>
        <div className="flex items-center gap-1 flex-wrap mt-0.5">
          <span className="truncate opacity-80">{entityLabel(job)}</span>
          <SourceBadge source={job.source} />
        </div>
        {revenue !== null && <div className="font-mono font-medium mt-0.5">{fmt(revenue)}</div>}
        {jobProfit !== null && (
          <div className={`font-mono text-[10px] mt-0.5 ${jobProfit >= 0 ? 'text-success' : 'text-danger'}`}>
            Profit: {fmt(jobProfit)}
          </div>
        )}
        <div className="flex items-center gap-1 mt-0.5">
          <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
          <span className="opacity-70 capitalize">{job.status.replace('_', ' ')}</span>
        </div>
        {(job.job_trucks ?? []).length > 0 && (
          <div className="mt-0.5 font-mono opacity-60 text-[10px]">
            {(job.job_trucks ?? []).map((jt) => jt.fleet?.registration ?? jt.fleet?.name).filter(Boolean).join(' + ')}
          </div>
        )}
        {job.actual_start_time && (
          <div className="opacity-60 mt-0.5 font-mono">▶ {job.actual_start_time}</div>
        )}
      </button>
      {(canStart || canFinish) && (
        <div className="px-1.5 pb-1.5">
          {canStart && isOverdue && (
            <button
              onClick={(e) => { e.stopPropagation(); onStart(job.id) }}
              className="w-full text-center text-xs font-semibold py-1 rounded bg-amber-500 hover:bg-amber-400 text-void"
            >
              Start
            </button>
          )}
          {canFinish && (
            <button
              onClick={(e) => { e.stopPropagation(); onFinish(job.id) }}
              className="w-full text-center text-xs font-semibold py-1 rounded bg-green-700 hover:bg-green-600 text-void"
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
function SummaryCard({ label, value, valueClass = 'text-parchment' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="bg-surface rounded-xl border border-wire border-l-[3px] border-l-[#C9A227] px-4 py-3.5">
      <div className="text-[10px] font-display font-semibold text-dim uppercase tracking-widest mb-1">{label}</div>
      <div className={`text-lg font-display font-bold font-mono ${valueClass}`}>{value}</div>
    </div>
  )
}

// ─── Day view ─────────────────────────────────────────────────────────────────
function DayView({
  jobs,
  today,
  onJobClick,
  onStart,
  onFinish,
  privateColor,
}: {
  jobs: CalendarJob[]
  today: string
  onJobClick: (id: string) => void
  onStart: (id: string) => void
  onFinish: (id: string) => void
  privateColor: string | null
}) {
  if (jobs.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-wire p-12 text-center text-dim text-sm">
        No jobs for this day.
      </div>
    )
  }

  return (
    <div className="bg-surface rounded-xl border border-wire overflow-hidden divide-y divide-wire">
      {jobs.map((job) => {
        const s = STATUS_CARD[job.status]
        const ec = getEntityColor(job, privateColor)
        const revenue = calcJobRevenue(job)
        const canStart = job.status === 'scheduled' || job.status === 'confirmed'
        const canFinish = job.status === 'in_progress'
        const time = job.actual_start_time ?? job.scheduled_time
        const _dNow = new Date()
        const _dCurrentTime = `${String(_dNow.getHours()).padStart(2,'0')}:${String(_dNow.getMinutes()).padStart(2,'0')}`
        const isDayOverdue = canStart && (
          job.date < today ||
          (job.date === today && !!job.scheduled_time && job.scheduled_time <= _dCurrentTime)
        )

        return (
          <div key={job.id} className="flex items-stretch gap-0">
            {ec && <div className="w-1 shrink-0 rounded-l-xl" style={{ backgroundColor: ec }} />}
            <div className="flex-1 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-mono font-bold text-parchment">#{job.job_number}</span>
                    <SourceBadge source={job.source} />
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${LIGHT_STATUS_BADGE[job.status]}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                      {job.status.replace('_', ' ')}
                    </span>
                    {time && <span className="text-xs text-dim font-mono">@ {time}</span>}
                  </div>
                  <div className="mt-1 text-sm text-parchment font-medium">{entityLabel(job)}</div>
                  {job.notes && <div className="mt-1 text-xs text-warm line-clamp-1">{job.notes}</div>}
                  {job.job_crew.length > 0 && (
                    <div className="mt-1 text-xs text-warm">
                      Crew: {job.job_crew.map((c) => c.employee?.name ?? '?').join(', ')}
                    </div>
                  )}
                  {(job.job_trucks ?? []).length > 0 && (
                    <div className="mt-0.5 text-xs font-mono text-dim">
                      {(job.job_trucks ?? []).map((jt) => jt.fleet?.registration ?? jt.fleet?.name).filter(Boolean).join(' + ')}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  {revenue !== null && (
                    <span className="text-base font-mono font-bold text-gold">{fmt(revenue)}</span>
                  )}
                  <div className="flex gap-2">
                    {canStart && isDayOverdue && (
                      <button
                        onClick={() => onStart(job.id)}
                        className="px-3 py-1 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 text-void"
                      >
                        Start
                      </button>
                    )}
                    {canFinish && (
                      <button
                        onClick={() => onFinish(job.id)}
                        className="px-3 py-1 text-xs font-semibold rounded-lg bg-green-700 hover:bg-green-600 text-void"
                      >
                        Finish
                      </button>
                    )}
                    <button
                      onClick={() => onJobClick(job.id)}
                      className="px-3 py-1 text-xs font-semibold rounded-lg border border-wire text-warm hover:bg-panel hover:text-parchment transition-colors"
                    >
                      Open
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// suppress unused import warning from fmtDay
void fmtDay
