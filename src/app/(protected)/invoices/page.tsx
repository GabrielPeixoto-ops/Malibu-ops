'use client'

export const dynamic = 'force-dynamic'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { ExternalLink, ChevronLeft, ChevronRight, Check, CheckCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { calculateJobRevenue, calculateClientRevenue } from '@/lib/billing'
import type { Employee, JobSource, JobStatus, Subcontractor, SubcontractorConfig } from '@/types/database'

type Tab = 'employees' | 'casuals' | 'commissions' | 'subcontractors' | 'contracts' | 'clients'

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

interface InvoiceReview {
  id: string
  subject_type: 'employee' | 'casual'
  subject_id: string
  subject_name: string
  period_from: string
  period_to: string
  status: 'reviewed' | 'approved'
  reviewed_at: string
  approved_at: string | null
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
  heavy_item_charge: number
  override_revenue: number | null
  malibu_revenue: number | null
  client_billing_config: Record<string, unknown> | null
  google_review: boolean
  google_review_employee_ids: string[]
  subcontractor_rate_id: string | null
  contract_rate_id: string | null
  subcontractor_rate_ph: number | null
  contract_rate_ph: number | null
  subcontractor: Subcontractor | null
  customer: { id: string; name: string; billing_type: string | null; billing_config: Record<string, unknown> | null } | null
  contract: { id: string; name: string; billing_type: string; billing_config: Record<string, unknown> } | null
  contract_client: { name: string } | null
  actual_start_time: string | null
  actual_finish_time: string | null
  job_crew: Array<{ employee_id: string; hours: number; cof_share: boolean; cof_hours: number; start_time: string | null; end_time: string | null }>
  job_casual_crew: Array<{ casual_worker_id: string | null; name: string; rate_per_hour: number; hours: number; cof_share: boolean; heavy_item: boolean; start_time: string | null; finish_time: string | null }>
  job_commissions: Array<{ employee_id: string | null; casual_worker_id: string | null; rate_per_hour: number; hours: number; commission_type: { name: string } | null }>
  job_extra_men: Array<{ employee_id: string | null; name: string | null; rate_per_hour: number | null; start_time: string | null; finish_time: string | null; cof_share: boolean; client_charge_amount: number }>
  job_materials: Array<{ quantity: number; cost_price: number; sale_price: number }>
  job_expenses: Array<{ amount: number; is_client_expense: boolean }>
}

const fmtAUD = (n: number) =>
  n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 })

const fmtHours = (n: number) => (n % 1 === 0 ? `${n}h` : `${n.toFixed(2)}h`)

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 })
}

// Mirrors Dashboard's calcJobRevenue exactly (src/app/(protected)/page.tsx) — same
// source-by-source precedence rules, otherwise the two pages silently disagree:
// - subcontract + percent billing: ONLY malibu_revenue (a gross-based number the
//   applyBillingConfig 'percent' formula cannot reproduce) — never live-calculate.
// - subcontract (other billing types): malibu_revenue/override_revenue as an
//   override when set, else live calc via calculateJobRevenue with the resolved
//   per-hour rate (subcontractor_rate_ph) for rateList-based subs.
// - private: ONLY malibu_revenue. Customers' billing_type/billing_config are not
//   populated in this codebase (private pricing lives in private_rate_id / the
//   private_rates table instead), so falling back to calculateClientRevenue here
//   would silently return null for every private job.
// - contract: prefer the saved malibu_revenue; only live-calculate as a fallback
//   for jobs saved before completion, passing contract_rate_ph so rate-list-based
//   contracts don't get treated as a $0 flat-rate lookup.
function calcRevenue(job: InvoiceJob): number | null {
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
  const clientExpenses = (job.job_expenses ?? []).filter((e) => e.is_client_expense).reduce((s, e) => s + e.amount, 0)
  const materialsRevenue = (job.job_materials ?? []).reduce((s, m) => s + Number(m.quantity) * Number(m.sale_price), 0)
  // What we charge the client for each Extra Man — pure company revenue,
  // independent of what the extra man is actually paid.
  const extraMenRevenue = (job.job_extra_men ?? []).reduce((s, em) => s + (Number(em.client_charge_amount) || 0), 0)
  const total = base + materialsRevenue + (Number(job.heavy_item_charge) || 0) + extraMenRevenue - (Number(job.discount) || 0) + clientExpenses
  return total > 0 ? total : null
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

// ── Week/Day date navigation (mirrors Dashboard's page.tsx) ─────────────────
type DateMode = 'week' | 'day' | 'range'

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
function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
function fmtWeekRange(start: Date): string {
  const end = addDays(start, 6)
  const s = start.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  const e = end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${s} – ${e}`
}

const STATUS_STYLE: Partial<Record<JobStatus, string>> = {
  reviewed: 'bg-cyan-500/10 text-cyan-300',
  invoiced: 'bg-purple-500/10 text-purple-300',
  paid:     'bg-teal-500/10 text-teal-300',
}

const MIN_CALL = 2
const HEAVY_ITEM_BONUS = 0.5
const REVIEW_BONUS = 0.5

// Always rounds UP to the next 15-minute block — same rule as the job page and
// Dashboard. breakMinutes (job-level only) is subtracted BEFORE rounding, same
// order as JobForm's workedHoursCalc — subtracting it after rounding gives a
// different (wrong) result since the break may cross a 15-min boundary.
function calcHoursFromTimes(start: string, finish: string, breakMinutes = 0): number {
  const [sh, sm] = start.split(':').map(Number)
  const [fh, fm] = finish.split(':').map(Number)
  const mins = (fh * 60 + fm) - (sh * 60 + sm) - breakMinutes
  return Math.max(0, Math.ceil(mins / 15) * 15 / 60)
}

const filterInput = 'px-3 py-1.5 text-sm border border-wire rounded-lg bg-panel text-parchment focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring'

export default function InvoicesPage() {
  return (
    <Suspense fallback={<p className="text-warm text-sm py-12 text-center">Loading…</p>}>
      <InvoicesPageContent />
    </Suspense>
  )
}

function InvoicesPageContent() {
  const supabase = createClient()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Everything the person filters by is seeded from the URL on first render and
  // kept in sync afterwards (see the sync effect below). This means navigating
  // away to edit a job and hitting the browser Back button returns to the exact
  // same period/tab/search instead of resetting to today's defaults — the
  // "toda vez preciso selecionar tudo de novo" complaint this feature exists for.
  const [tab, setTab] = useState<Tab>(() => (searchParams.get('tab') as Tab) || 'employees')
  const [dateMode, setDateMode] = useState<DateMode>(() => (searchParams.get('mode') as DateMode) || 'range')
  const [periodRef, setPeriodRef] = useState<Date>(() => {
    const p = searchParams.get('ref')
    return p ? parseISODate(p) : new Date()
  })
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('from') || monthStart())
  const [dateTo, setDateTo] = useState(() => searchParams.get('to') || today())
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>(() => (searchParams.get('status') as JobStatus | 'all') || 'all')
  const [empSearch, setEmpSearch] = useState(() => searchParams.get('q') || '')
  const [casualSearch, setCasualSearch] = useState(() => searchParams.get('q') || '')
  const [commissionSearch, setCommissionSearch] = useState(() => searchParams.get('q') || '')
  const [subFilter, setSubFilter] = useState(() => searchParams.get('sub') || 'all')
  const [contractFilter, setContractFilter] = useState(() => searchParams.get('contract') || 'all')
  const [jobs, setJobs] = useState<InvoiceJob[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  // Needed to resolve Extra Man entries that point at a casual worker rather
  // than a staff employee — job_extra_men only stores an id, same ambiguity
  // as JobForm's "Select employee…" dropdown.
  const [casualWorkers, setCasualWorkers] = useState<Array<{ id: string; name: string; rate_per_hour: number }>>([])
  const [formalInvoices, setFormalInvoices] = useState<FormalInvoice[]>([])
  const [reviews, setReviews] = useState<InvoiceReview[]>([])
  const [sendingInvoice, setSendingInvoice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('employees').select('*').eq('active', true).order('name').then(({ data }) => {
      setEmployees((data ?? []) as Employee[])
    })
    supabase.from('casual_workers').select('id, name, rate_per_hour').then(({ data }) => {
      setCasualWorkers((data ?? []) as Array<{ id: string; name: string; rate_per_hour: number }>)
    })
    supabase
      .from('invoices')
      .select('id,invoice_number,type,entity_id,entity_name,period_from,period_to,status,total_amount,notes,xero_invoice_id,xero_invoice_url,created_at')
      .in('type', ['subcontractor', 'b2b_client'])
      .order('created_at', { ascending: false })
      .then(({ data }) => setFormalInvoices((data ?? []) as FormalInvoice[]))
  }, [])

  // ── Week/Day nav: dateFrom/dateTo are derived from periodRef whenever the
  // person navigates or switches modes — set directly in these event handlers
  // (not a useEffect) so we're not synchronously setState-ing inside an effect.
  // 'range' mode leaves dateFrom/dateTo directly editable via the date inputs.
  function applyPeriodRef(newRef: Date, mode: DateMode = dateMode) {
    setPeriodRef(newRef)
    if (mode === 'week') {
      const monday = getMonday(newRef)
      setDateFrom(toISODate(monday))
      setDateTo(toISODate(addDays(monday, 6)))
    } else if (mode === 'day') {
      const iso = toISODate(newRef)
      setDateFrom(iso)
      setDateTo(iso)
    }
  }
  function prevPeriod() {
    if (dateMode === 'week') applyPeriodRef(addDays(periodRef, -7))
    else if (dateMode === 'day') applyPeriodRef(addDays(periodRef, -1))
  }
  function nextPeriod() {
    if (dateMode === 'week') applyPeriodRef(addDays(periodRef, 7))
    else if (dateMode === 'day') applyPeriodRef(addDays(periodRef, 1))
  }
  function goToday() { applyPeriodRef(new Date()) }
  function changeDateMode(mode: DateMode) {
    setDateMode(mode)
    if (mode !== 'range') applyPeriodRef(periodRef, mode)
  }

  // ── Keep the URL in sync with every filter so Back-navigation (e.g. after
  // clicking into a job to fix something and coming back) restores exactly
  // where the person left off, instead of resetting to today's defaults.
  useEffect(() => {
    const params = new URLSearchParams()
    params.set('tab', tab)
    params.set('mode', dateMode)
    if (dateMode !== 'range') params.set('ref', toISODate(periodRef))
    params.set('from', dateFrom)
    params.set('to', dateTo)
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (subFilter !== 'all') params.set('sub', subFilter)
    if (contractFilter !== 'all') params.set('contract', contractFilter)
    const q = tab === 'employees' ? empSearch : tab === 'casuals' ? casualSearch : tab === 'commissions' ? commissionSearch : ''
    if (q) params.set('q', q)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, dateMode, periodRef, dateFrom, dateTo, statusFilter, subFilter, contractFilter, empSearch, casualSearch, commissionSearch])

  useEffect(() => {
    setLoading(true)
    supabase
      .from('jobs')
      .select(`
        id, job_number, date, status, source,
        cof, cof_final, additional_hours, additional_rate, rate_card_key, formula_vars,
        extra_men_hours, extra_man_employee_id, break_minutes, discount, heavy_item_charge, override_revenue, malibu_revenue, client_billing_config,
        google_review, google_review_employee_ids, actual_start_time, actual_finish_time,
        subcontractor_rate_id, contract_rate_id,
        subcontractor:subcontractors(*),
        customer:customers(id, name, billing_type, billing_config),
        contract:contracts(id, name, billing_type, billing_config),
        contract_client:contract_clients(name),
        job_crew(employee_id, hours, cof_share, cof_hours, start_time, end_time),
        job_casual_crew(casual_worker_id, name, rate_per_hour, hours, cof_share, heavy_item, start_time, finish_time),
        job_commissions(employee_id, casual_worker_id, rate_per_hour, hours, commission_type:commission_types(name)),
        job_materials(quantity, cost_price, sale_price),
        job_expenses(amount, is_client_expense),
        job_extra_men(employee_id, name, rate_per_hour, start_time, finish_time, cof_share, client_charge_amount)
      `)
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .not('status', 'in', '("draft","cancelled")')
      .order('date', { ascending: false })
      .then(async ({ data }) => {
        const baseJobs = (data ?? []) as unknown as Omit<InvoiceJob, 'subcontractor_rate_ph' | 'contract_rate_ph'>[]

        // Resolve per-hour rates for rate-list-based subcontractors/contracts —
        // mirrors Dashboard's subRatePHMap/contractRatePHMap so both pages agree
        // on revenue for jobs that use subcontractor_rate_id/contract_rate_id
        // instead of the flat rate_card_key mechanism.
        const subRatePHMap = new Map<string, number>()
        const contractRatePHMap = new Map<string, number>()
        const uniqueSubRateIds = [...new Set(baseJobs.map((j) => j.subcontractor_rate_id).filter(Boolean) as string[])]
        const uniqueContractRateIds = [...new Set(baseJobs.map((j) => j.contract_rate_id).filter(Boolean) as string[])]
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
          subcontractor_rate_ph: j.subcontractor_rate_id ? (subRatePHMap.get(j.subcontractor_rate_id) ?? null) : null,
          contract_rate_ph: j.contract_rate_id ? (contractRatePHMap.get(j.contract_rate_id) ?? null) : null,
        })) as InvoiceJob[])
        setLoading(false)
      })
  }, [dateFrom, dateTo])

  // ── Reviewed/Approved checklist, scoped to the EXACT period currently
  // selected — never a loose "this week" label — so switching weeks can never
  // bleed one week's review status into another's.
  useEffect(() => {
    supabase
      .from('invoice_reviews')
      .select('*')
      .eq('period_from', dateFrom)
      .eq('period_to', dateTo)
      .then(({ data }) => setReviews((data ?? []) as InvoiceReview[]))
  }, [dateFrom, dateTo])

  function reviewFor(subjectType: 'employee' | 'casual', subjectId: string): InvoiceReview | undefined {
    return reviews.find((r) => r.subject_type === subjectType && r.subject_id === subjectId)
  }

  // A period is only "closed" once its last day is in the past — reviewing an
  // in-progress week risks marking hours that can still change.
  const periodClosed = dateTo < today()

  async function markReviewed(subjectType: 'employee' | 'casual', subjectId: string, subjectName: string) {
    if (!periodClosed) return
    const { data } = await supabase
      .from('invoice_reviews')
      .upsert(
        { subject_type: subjectType, subject_id: subjectId, subject_name: subjectName, period_from: dateFrom, period_to: dateTo, status: 'reviewed', reviewed_at: new Date().toISOString(), approved_at: null },
        { onConflict: 'subject_type,subject_id,period_from,period_to' }
      )
      .select()
      .single()
    if (data) setReviews((rs) => [...rs.filter((r) => r.id !== (data as InvoiceReview).id), data as InvoiceReview])
  }

  async function markApproved(review: InvoiceReview) {
    const { data } = await supabase
      .from('invoice_reviews')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', review.id)
      .select()
      .single()
    if (data) setReviews((rs) => rs.map((r) => (r.id === review.id ? (data as InvoiceReview) : r)))
  }

  async function undoReview(review: InvoiceReview) {
    await supabase.from('invoice_reviews').delete().eq('id', review.id)
    setReviews((rs) => rs.filter((r) => r.id !== review.id))
  }

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
          // Recompute worked hours live from times (own row times, falling back to
          // job-level actual_start/finish) instead of trusting the stored `hours`
          // column, which can go stale relative to the current rounding rule
          // (e.g. saved under the old nearest-15-min rule before it changed to
          // always-round-up). Mirrors JobForm's resolveCrewHours/baseHrs logic.
          const hasTime = row.start_time?.length === 5 && row.end_time?.length === 5
          const jobLevelHours = (() => {
            if (!job.actual_start_time || !job.actual_finish_time) return null
            const raw = calcHoursFromTimes(job.actual_start_time, job.actual_finish_time, Number(job.break_minutes) || 0)
            return raw > 0 ? raw : null
          })()
          const workedHours = hasTime
            ? calcHoursFromTimes(row.start_time!, row.end_time!)
            : (jobLevelHours ?? row.hours)
          const cofHours = row.cof_share ? (row.cof_hours > 0 ? row.cof_hours : Number(job.cof_final ?? job.cof ?? 0)) : 0
          const reviewBonus = (job.google_review && job.google_review_employee_ids?.includes(emp.id)) ? 0.5 : 0
          const paidHours = Math.max(workedHours, MIN_CALL) + cofHours + reviewBonus
          entries.push({ job, workedHours, cofHours, paidHours, pay: paidHours * emp.hourly_rate, googleReviewBonus: reviewBonus > 0 })
        }
        // Extra Men who resolve to this staff employee — same hours/COF/review
        // treatment as regular crew. Prefer the per-job rate captured at save
        // time (lets a rate be negotiated for a one-off addition) and fall
        // back to the employee's standard hourly_rate.
        for (const em of job.job_extra_men ?? []) {
          if (em.employee_id !== emp.id) continue
          const hasTime = em.start_time?.length === 5 && em.finish_time?.length === 5
          const jobLevelHours = (() => {
            if (!job.actual_start_time || !job.actual_finish_time) return null
            const raw = calcHoursFromTimes(job.actual_start_time, job.actual_finish_time, Number(job.break_minutes) || 0)
            return raw > 0 ? raw : null
          })()
          const workedHours = hasTime ? calcHoursFromTimes(em.start_time!, em.finish_time!) : (jobLevelHours ?? 0)
          if (workedHours <= 0) continue
          const cofHours = em.cof_share ? Number(job.cof_final ?? job.cof ?? 0) : 0
          const reviewBonus = (job.google_review && job.google_review_employee_ids?.includes(emp.id)) ? 0.5 : 0
          const paidHours = Math.max(workedHours, MIN_CALL) + cofHours + reviewBonus
          const rate = em.rate_per_hour || emp.hourly_rate
          entries.push({ job, workedHours, cofHours, paidHours, pay: paidHours * rate, googleReviewBonus: reviewBonus > 0 })
        }
        // Legacy single-extra-man fields, kept only for any historical jobs
        // saved before the job_extra_men table existed.
        if (job.extra_man_employee_id === emp.id && job.extra_men_hours > 0 && !(job.job_extra_men ?? []).some((em) => em.employee_id === emp.id)) {
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

  // Casual crew / packers — grouped by name (trimmed, case-insensitive), since
  // ad-hoc casuals may not have a persistent casual_workers record.
  const casualData = useMemo(() => {
    const reviewSet = new Set<string>()
    const byKey = new Map<string, {
      name: string
      entries: Array<{
        job: InvoiceJob
        workedHours: number
        cofHours: number
        paidHours: number
        pay: number
        heavyItem: boolean
        googleReviewBonus: boolean
        label?: string
      }>
    }>()

    for (const job of filtered) {
      if (job.google_review) for (const id of job.google_review_employee_ids ?? []) reviewSet.add(id)

      const jobLevelHours = (() => {
        if (!job.actual_start_time || !job.actual_finish_time) return null
        const raw = calcHoursFromTimes(job.actual_start_time, job.actual_finish_time, Number(job.break_minutes) || 0)
        return raw > 0 ? raw : null
      })()
      const cofFinalHrs = Number(job.cof_final ?? job.cof) || 0

      for (const row of job.job_casual_crew ?? []) {
        const name = row.name.trim()
        if (!name || row.rate_per_hour <= 0) continue
        const hasTime = row.start_time?.length === 5 && row.finish_time?.length === 5
        let rawHours: number
        if (hasTime) {
          rawHours = calcHoursFromTimes(row.start_time!, row.finish_time!)
        } else if (jobLevelHours !== null) {
          rawHours = jobLevelHours
        } else {
          rawHours = 0
        }
        const workedHours = rawHours > 0 ? Math.max(MIN_CALL, rawHours) : 0
        const cofHours = row.cof_share ? cofFinalHrs : 0
        const hasReviewBonus = row.casual_worker_id ? reviewSet.has(row.casual_worker_id) : false
        const paidHours = workedHours + cofHours + (row.heavy_item ? HEAVY_ITEM_BONUS : 0) + (hasReviewBonus ? REVIEW_BONUS : 0)
        if (paidHours <= 0) continue
        const key = name.toLowerCase()
        if (!byKey.has(key)) byKey.set(key, { name, entries: [] })
        byKey.get(key)!.entries.push({
          job, workedHours, cofHours, paidHours, pay: paidHours * row.rate_per_hour,
          heavyItem: row.heavy_item, googleReviewBonus: hasReviewBonus,
        })
      }

      for (const com of job.job_commissions ?? []) {
        if (!com.casual_worker_id || com.hours <= 0 || com.rate_per_hour <= 0) continue
        const linked = job.job_casual_crew?.find((r) => r.casual_worker_id === com.casual_worker_id)
        const name = (linked?.name ?? '').trim()
        if (!name) continue
        const key = name.toLowerCase()
        if (!byKey.has(key)) byKey.set(key, { name, entries: [] })
        byKey.get(key)!.entries.push({
          job, workedHours: com.hours, cofHours: 0, paidHours: com.hours, pay: com.hours * com.rate_per_hour,
          heavyItem: false, googleReviewBonus: false, label: com.commission_type?.name ?? 'Commission',
        })
      }

      // Extra Men who resolve to a casual worker rather than a staff employee.
      // Prefer the free-text name/rate captured at save time (same convention
      // as job_casual_crew) — fall back to a live casual_workers lookup by id
      // for rows saved before those columns existed. Staff extra men are
      // already handled in employeeData above.
      for (const em of job.job_extra_men ?? []) {
        if (em.employee_id && employees.some((e) => e.id === em.employee_id)) continue
        const cw = em.employee_id ? casualWorkers.find((c) => c.id === em.employee_id) : undefined
        const name = ((em.name && em.name.trim()) || cw?.name || '').trim()
        if (!name) continue
        const rate = em.rate_per_hour || cw?.rate_per_hour || 0
        if (rate <= 0) continue
        const hasTime = em.start_time?.length === 5 && em.finish_time?.length === 5
        const rawHours = hasTime ? calcHoursFromTimes(em.start_time!, em.finish_time!) : (jobLevelHours ?? 0)
        const workedHours = rawHours > 0 ? Math.max(MIN_CALL, rawHours) : 0
        const cofHours = em.cof_share ? cofFinalHrs : 0
        const hasReviewBonus = cw ? reviewSet.has(cw.id) : false
        const paidHours = workedHours + cofHours + (hasReviewBonus ? REVIEW_BONUS : 0)
        if (paidHours <= 0) continue
        const key = name.toLowerCase()
        if (!byKey.has(key)) byKey.set(key, { name, entries: [] })
        byKey.get(key)!.entries.push({
          job, workedHours, cofHours, paidHours, pay: paidHours * rate,
          heavyItem: false, googleReviewBonus: hasReviewBonus,
        })
      }
    }

    return [...byKey.entries()]
      .map(([key, { name, entries }]) => ({
        key, name, entries,
        totalPaidHours: entries.reduce((s, e) => s + e.paidHours, 0),
        totalPay: entries.reduce((s, e) => s + e.pay, 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [filtered, employees, casualWorkers])

  // Commissions — dedicated view pulling every job_commissions row together
  // (staff and casual), regardless of which tab they'd otherwise surface in.
  // Same grouping convention as casualData: keyed per person, one row per job.
  const commissionData = useMemo(() => {
    const byKey = new Map<string, {
      name: string
      entries: Array<{ job: InvoiceJob; label: string; rate: number; hours: number; pay: number }>
    }>()
    for (const job of filtered) {
      for (const com of job.job_commissions ?? []) {
        if (com.hours <= 0 || com.rate_per_hour <= 0) continue
        let key: string | null = null
        let name: string | null = null
        if (com.employee_id) {
          const emp = employees.find((e) => e.id === com.employee_id)
          key = `staff:${com.employee_id}`
          name = emp?.name ?? 'Unknown staff'
        } else if (com.casual_worker_id) {
          const linked = job.job_casual_crew?.find((r) => r.casual_worker_id === com.casual_worker_id)
          const cw = casualWorkers.find((c) => c.id === com.casual_worker_id)
          key = `casual:${com.casual_worker_id}`
          name = (linked?.name?.trim() || cw?.name) ?? 'Unknown casual'
        }
        if (!key || !name) continue
        if (!byKey.has(key)) byKey.set(key, { name, entries: [] })
        byKey.get(key)!.entries.push({
          job,
          label: com.commission_type?.name ?? 'Commission',
          rate: com.rate_per_hour,
          hours: com.hours,
          pay: com.hours * com.rate_per_hour,
        })
      }
    }
    return [...byKey.entries()]
      .map(([key, { name, entries }]) => ({
        key, name, entries,
        totalHours: entries.reduce((s, e) => s + e.hours, 0),
        totalPay: entries.reduce((s, e) => s + e.pay, 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [filtered, employees, casualWorkers])

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
    { id: 'casuals', label: 'Casuals' },
    { id: 'commissions', label: 'Commissions' },
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

  const fmtRangeAU = (from: string, to: string) => {
    const f = parseISODate(from).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit' })
    const t = parseISODate(to).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit' })
    return from === to ? f : `${f}–${t}`
  }

  // Shared reviewed/approved control rendered on each Employee/Casual card.
  // Always tied to the exact dateFrom/dateTo on screen — never a vague "this
  // week" — so switching periods can't accidentally mix up which week was
  // actually checked.
  function renderReviewControl(subjectType: 'employee' | 'casual', subjectId: string, subjectName: string) {
    const review = reviewFor(subjectType, subjectId)
    if (!review) {
      return (
        <button
          type="button"
          disabled={!periodClosed}
          onClick={() => markReviewed(subjectType, subjectId, subjectName)}
          title={!periodClosed ? "Can't review a period that hasn't closed yet" : undefined}
          className="text-xs px-2 py-1 rounded-full border border-wire text-dim hover:text-warm hover:border-gold-ring transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Mark as reviewed
        </button>
      )
    }
    if (review.status === 'reviewed') {
      return (
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-cyan-500/10 text-cyan-300 font-medium">
            <Check size={12} /> Reviewed {fmtRangeAU(review.period_from, review.period_to)}
          </span>
          <button type="button" onClick={() => markApproved(review)} className="text-xs px-2 py-1 rounded-full border border-gold-ring text-gold hover:bg-gold/10 transition-colors">
            Approve
          </button>
          <button type="button" onClick={() => undoReview(review)} title="Undo" className="text-dim hover:text-danger text-xs px-1">
            ✕
          </button>
        </div>
      )
    }
    return (
      <div className="flex items-center gap-1.5">
        <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-gold/15 text-gold font-medium">
          <CheckCheck size={12} /> Approved {fmtRangeAU(review.period_from, review.period_to)}
        </span>
        <button type="button" onClick={() => undoReview(review)} title="Undo (back to unreviewed)" className="text-dim hover:text-danger text-xs px-1">
          ✕
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
        <h1 className="text-2xl font-display font-bold text-parchment">Invoices</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-wire overflow-hidden text-sm">
            {(['week', 'day', 'range'] as const).map((m) => (
              <button
                key={m}
                onClick={() => changeDateMode(m)}
                className={`px-3 py-1.5 capitalize transition-colors ${dateMode === m ? 'bg-gold text-[#0d0d0d] font-semibold' : 'bg-surface text-warm hover:bg-panel hover:text-parchment'}`}
              >
                {m}
              </button>
            ))}
          </div>
          {dateMode === 'range' ? (
            <>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={filterInput} />
              <span className="text-dim text-sm">–</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={filterInput} />
            </>
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={prevPeriod} className="p-1.5 rounded-lg hover:bg-panel text-warm hover:text-parchment transition-colors">
                <ChevronLeft size={16} />
              </button>
              <button onClick={goToday} className="text-sm font-semibold text-parchment min-w-[150px] text-center hover:text-gold transition-colors px-1">
                {dateMode === 'week' ? fmtWeekRange(getMonday(periodRef)) : periodRef.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
              </button>
              <button onClick={nextPeriod} className="p-1.5 rounded-lg hover:bg-panel text-warm hover:text-parchment transition-colors">
                <ChevronRight size={16} />
              </button>
            </div>
          )}
          {tab !== 'employees' && tab !== 'casuals' && (
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
                    <div className="flex items-center gap-3">
                      {renderReviewControl('employee', emp.id, emp.name)}
                      <div className="text-right">
                        <div className="text-sm font-mono font-bold text-gold">{fmtMoney(totalPay)}</div>
                        <div className="text-xs text-dim font-mono">{fmtHours(totalPaidHours)}</div>
                      </div>
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

          {/* ── Casuals ───────────────────────────────────────────────── */}
          {tab === 'casuals' && (
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Search casual…"
                value={casualSearch}
                onChange={(e) => setCasualSearch(e.target.value)}
                className={`${filterInput} w-52`}
              />
              {casualData.filter((d) => d.name.toLowerCase().includes(casualSearch.toLowerCase())).length === 0 && (
                <div className="bg-surface rounded-xl border border-wire p-12 text-center text-dim">No job data for this period.</div>
              )}
              {casualData.filter((d) => d.name.toLowerCase().includes(casualSearch.toLowerCase())).map(({ key, name, entries, totalPaidHours, totalPay }) => (
                <div key={key} className="bg-surface rounded-xl border border-wire overflow-hidden">
                  <div className={groupHeader}>
                    <div>
                      <span className="font-semibold text-parchment">{name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {renderReviewControl('casual', key, name)}
                      <div className="text-right">
                        <div className="text-sm font-mono font-bold text-gold">{fmtMoney(totalPay)}</div>
                        <div className="text-xs text-dim font-mono">{fmtHours(totalPaidHours)}</div>
                      </div>
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
                      {entries.map(({ job, paidHours, pay, heavyItem, googleReviewBonus, label }, i) => (
                        <tr key={`${job.id}-${i}`} className="hover:bg-panel transition-colors cursor-pointer" onClick={() => router.push(`/jobs/${job.id}/edit`)}>
                          <td className="px-4 py-2 text-warm whitespace-nowrap">{job.date}</td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono text-parchment">#{job.job_number}</span>
                              {label && <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-300 font-medium">Commission: {label}</span>}
                              {STATUS_STYLE[job.status] && (
                                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_STYLE[job.status]}`}>{job.status}</span>
                              )}
                              {heavyItem && <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-300 font-medium">Heavy item +0.5h</span>}
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
              {casualData.length > 0 && (
                <div className={totalBar}>
                  <span className="text-sm font-display font-semibold text-gold">Total payroll</span>
                  <span className="text-lg font-mono font-bold text-gold">{fmtMoney(casualData.reduce((s, d) => s + d.totalPay, 0))}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Commissions ───────────────────────────────────────────── */}
          {tab === 'commissions' && (
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Search person…"
                value={commissionSearch}
                onChange={(e) => setCommissionSearch(e.target.value)}
                className={`${filterInput} w-52`}
              />
              {commissionData.filter((d) => d.name.toLowerCase().includes(commissionSearch.toLowerCase())).length === 0 && (
                <div className="bg-surface rounded-xl border border-wire p-12 text-center text-dim">No commissions for this period.</div>
              )}
              {commissionData.filter((d) => d.name.toLowerCase().includes(commissionSearch.toLowerCase())).map(({ key, name, entries, totalHours, totalPay }) => (
                <div key={key} className="bg-surface rounded-xl border border-wire overflow-hidden">
                  <div className={groupHeader}>
                    <div>
                      <span className="font-semibold text-parchment">{name}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-mono font-bold text-gold">{fmtMoney(totalPay)}</div>
                      <div className="text-xs text-dim font-mono">{fmtHours(totalHours)}</div>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-wire">
                        <th className={thCell}>Date</th>
                        <th className={thCell}>Job</th>
                        <th className={`${thCell} hidden sm:table-cell`}>Entity</th>
                        <th className={thCell}>Type</th>
                        <th className={`${thCell} text-right`}>Rate</th>
                        <th className={`${thCell} text-right`}>Hours</th>
                        <th className={`${thCell} text-right`}>Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-wire">
                      {entries.map(({ job, label, rate, hours, pay }, i) => (
                        <tr key={`${job.id}-${i}`} className="hover:bg-panel transition-colors cursor-pointer" onClick={() => router.push(`/jobs/${job.id}/edit`)}>
                          <td className="px-4 py-2 text-warm whitespace-nowrap">{job.date}</td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono text-parchment">#{job.job_number}</span>
                              {STATUS_STYLE[job.status] && (
                                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_STYLE[job.status]}`}>{job.status}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-dim text-xs hidden sm:table-cell">{entityLabel(job)}</td>
                          <td className="px-4 py-2">
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-300 font-medium">{label}</span>
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-dim">{fmtMoney(rate)}/hr</td>
                          <td className="px-4 py-2 text-right font-mono font-medium text-parchment">{fmtHours(hours)}</td>
                          <td className="px-4 py-2 text-right font-mono font-semibold text-gold">{fmtMoney(pay)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-wire bg-panel">
                        <td colSpan={5} className="px-4 py-2 text-xs font-semibold text-dim hidden sm:table-cell">Total</td>
                        <td colSpan={4} className="px-4 py-2 sm:hidden text-xs font-semibold text-dim">Total</td>
                        <td className="px-4 py-2 text-right text-xs font-mono font-bold text-parchment">{fmtHours(totalHours)}</td>
                        <td className="px-4 py-2 text-right text-xs font-mono font-bold text-gold">{fmtMoney(totalPay)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))}
              {commissionData.length > 0 && (
                <div className={totalBar}>
                  <span className="text-sm font-display font-semibold text-gold">Total commissions</span>
                  <span className="text-lg font-mono font-bold text-gold">{fmtMoney(commissionData.reduce((s, d) => s + d.totalPay, 0))}</span>
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
