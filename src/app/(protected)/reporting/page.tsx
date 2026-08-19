'use client'

export const dynamic = 'force-dynamic'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { ChevronLeft, ChevronRight, Flag, Truck, Fuel, DollarSign, CheckCircle2, Clock3 } from 'lucide-react'
import type { ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { calculateJobRevenue, calculateClientRevenue } from '@/lib/billing'
import type { JobSource, JobStatus, Subcontractor, SubcontractorConfig, Fleet, FleetFuelLog } from '@/types/database'

// ── Date helpers (same conventions as Invoices/Dashboard) ──────────────────
function today(): string { return new Date().toISOString().split('T')[0] }
function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
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

const fmtAUD = (n: number) =>
  n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 })
function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 })
}

const filterInput = 'px-3 py-1.5 text-sm border border-wire rounded-lg bg-panel text-parchment focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring'

const STATUS_STYLE: Partial<Record<JobStatus, string>> = {
  scheduled:   'bg-blue-500/10 text-blue-300',
  confirmed:   'bg-indigo-500/10 text-indigo-300',
  in_progress: 'bg-amber-500/10 text-amber-300',
  completed:   'bg-green-500/10 text-green-300',
  reviewed:    'bg-cyan-500/10 text-cyan-300',
  invoiced:    'bg-purple-500/10 text-purple-300',
  paid:        'bg-teal-500/10 text-teal-300',
}

// ─── Types ───────────────────────────────────────────────────────────────
// Non-crew subset of Invoices' InvoiceJob — everything calcRevenue needs,
// plus the Needs Attention flag and job-level payment fields. Deliberately a
// self-contained copy (this codebase's convention — see weekly-recap/page.tsx)
// rather than importing from invoices/page.tsx, so this page can't be broken
// by future changes over there.
interface ReportJob {
  id: string
  job_number: string
  date: string
  status: JobStatus
  source: JobSource
  flagged: boolean | null
  flag_note: string | null
  cof: number | null
  cof_final: number | null
  additional_hours: number | null
  additional_rate: number | null
  rate_card_key: string | null
  formula_vars: Record<string, number> | null
  extra_men_hours: number
  break_minutes: number
  manual_hours_override: number | null
  manual_hours_client_billed: boolean
  discount: number
  heavy_item_charge: number | null
  client_cof_manual_charge: number | null
  override_revenue: number | null
  malibu_revenue: number | null
  client_billing_config: Record<string, unknown> | null
  subcontractor_rate_id: string | null
  contract_rate_id: string | null
  subcontractor: Subcontractor | null
  customer: { name: string } | null
  contract: { name: string; billing_type: string; billing_config: Record<string, unknown> } | null
  contract_client: { name: string } | null
  job_materials: Array<{ quantity: number; cost_price: number; sale_price: number }>
  job_expenses: Array<{ amount: number; is_client_expense: boolean }>
  job_extra_men: Array<{ client_charge_amount: number }>
  payment_methods: string[]
  payment_cash_amount: number
  payment_transfer_amount: number
  payment_card_amount: number
  payment_collected_by: string | null
  payment_date: string | null
  paid_at: string | null
  subcontractor_rate_ph: number | null
  contract_rate_ph: number | null
}

interface FormalInvoice {
  id: string
  invoice_number: string
  type: 'subcontractor' | 'b2b_client' | 'tmaat'
  entity_name: string
  period_from: string
  period_to: string
  status: 'draft' | 'sent' | 'paid'
  total_amount: number
}

interface InvoiceReviewRow {
  id: string
  subject_type: 'employee' | 'casual'
  subject_name: string
  period_from: string
  period_to: string
  status: 'reviewed' | 'pending_approval' | 'approved' | 'paid'
}

// Mirrors Invoices' calcRevenue exactly (src/app/(protected)/invoices/page.tsx)
// — same source-by-source precedence rules, so this page's totals always
// agree with Invoices/Dashboard for the same period.
function calcRevenue(job: ReportJob): number | null {
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
      if (entity?.billing_type && entity?.billing_config) {
        base = calculateClientRevenue(
          { ...job, client_billing_config: job.client_billing_config as SubcontractorConfig | null },
          entity.billing_type,
          entity.billing_config as unknown as SubcontractorConfig,
          job.contract_rate_ph
        )
      }
    }
  }

  const effectiveBase = base ?? 0
  const clientExpenses = (job.job_expenses ?? []).filter((e) => e.is_client_expense).reduce((s, e) => s + e.amount, 0)
  const materialsRevenue = (job.job_materials ?? []).reduce((s, m) => s + Number(m.quantity) * Number(m.sale_price), 0)
  const extraMenRevenue = (job.job_extra_men ?? []).reduce((s, em) => s + (Number(em.client_charge_amount) || 0), 0)
  const total = effectiveBase + materialsRevenue + (Number(job.heavy_item_charge) || 0) + (Number(job.client_cof_manual_charge) || 0) + extraMenRevenue - (Number(job.discount) || 0) + clientExpenses
  return total > 0 ? total : null
}

function entityLabel(job: ReportJob): string {
  if (job.source === 'private') return job.customer?.name ?? '—'
  if (job.source === 'contract') {
    const base = job.contract?.name ?? '—'
    return job.contract_client?.name ? `${base} → ${job.contract_client.name}` : base
  }
  return job.subcontractor?.name ?? '—'
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank Transfer',
  card: 'Card',
}

const REVIEW_STATUS_LABEL: Record<InvoiceReviewRow['status'], string> = {
  reviewed: 'Reviewed',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  paid: 'Paid',
}

const REVIEW_STATUS_COLOR: Record<InvoiceReviewRow['status'], string> = {
  reviewed: 'bg-cyan-500/10 text-cyan-300',
  pending_approval: 'bg-amber-500/10 text-amber-300',
  approved: 'bg-indigo-500/10 text-indigo-300',
  paid: 'bg-teal-500/10 text-teal-300',
}

const INVOICE_STATUS_COLOR: Record<FormalInvoice['status'], string> = {
  draft: 'bg-wire/50 text-warm',
  sent: 'bg-amber-500/10 text-amber-300',
  paid: 'bg-teal-500/10 text-teal-300',
}

// ─── Small layout helper ────────────────────────────────────────────────────
function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-surface rounded-xl border border-wire p-4">
      <h2 className="text-xs font-semibold text-dim uppercase tracking-widest mb-3 flex items-center gap-1.5">
        {icon}
        {title}
      </h2>
      {children}
    </div>
  )
}

function SummaryCard({ label, value, valueClass = 'text-parchment' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="bg-surface rounded-xl border border-wire border-l-[3px] border-l-[#C9A227] px-4 py-3.5">
      <div className="text-[10px] font-display font-semibold text-dim uppercase tracking-widest mb-1">{label}</div>
      <div className={`text-lg font-display font-bold font-mono truncate ${valueClass}`}>{value}</div>
    </div>
  )
}

// ─── Component ──────────────────────────────────────────────────────────────
export default function ReportingPage() {
  return (
    <Suspense fallback={<p className="text-warm text-sm py-12 text-center">Loading…</p>}>
      <ReportingPageContent />
    </Suspense>
  )
}

function ReportingPageContent() {
  const supabase = createClient()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [dateMode, setDateMode] = useState<DateMode>(() => (searchParams.get('mode') as DateMode) || 'range')
  const [periodRef, setPeriodRef] = useState<Date>(() => {
    const p = searchParams.get('ref')
    return p ? parseISODate(p) : new Date()
  })
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('from') || monthStart())
  const [dateTo, setDateTo] = useState(() => searchParams.get('to') || today())

  const [jobs, setJobs] = useState<ReportJob[]>([])
  const [invoices, setInvoices] = useState<FormalInvoice[]>([])
  const [reviews, setReviews] = useState<InvoiceReviewRow[]>([])
  const [fleet, setFleet] = useState<Fleet[]>([])
  const [fuelLogs, setFuelLogs] = useState<FleetFuelLog[]>([])
  const [loading, setLoading] = useState(true)

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

  useEffect(() => {
    const params = new URLSearchParams()
    params.set('mode', dateMode)
    if (dateMode !== 'range') params.set('ref', toISODate(periodRef))
    params.set('from', dateFrom)
    params.set('to', dateTo)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateMode, periodRef, dateFrom, dateTo])

  useEffect(() => {
    setLoading(true)
    async function load() {
      const { data: jobRows } = await supabase
        .from('jobs')
        .select(`
          id, job_number, date, status, source, flagged, flag_note,
          cof, cof_final, additional_hours, additional_rate, rate_card_key, formula_vars,
          extra_men_hours, break_minutes, manual_hours_override, manual_hours_client_billed, discount,
          heavy_item_charge, client_cof_manual_charge, override_revenue, malibu_revenue, client_billing_config,
          subcontractor_rate_id, contract_rate_id,
          payment_methods, payment_cash_amount, payment_transfer_amount, payment_card_amount, payment_collected_by, payment_date, paid_at,
          subcontractor:subcontractors(*),
          customer:customers(name),
          contract:contracts(name, billing_type, billing_config),
          contract_client:contract_clients(name),
          job_materials(quantity, cost_price, sale_price),
          job_expenses(amount, is_client_expense),
          job_extra_men(client_charge_amount)
        `)
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .not('status', 'in', '("draft","cancelled")')
        .order('date', { ascending: false })

      const baseJobs = (jobRows ?? []) as unknown as Omit<ReportJob, 'subcontractor_rate_ph' | 'contract_rate_ph'>[]

      const subRatePHMap = new Map<string, number>()
      const contractRatePHMap = new Map<string, number>()
      const uniqueSubRateIds = [...new Set(baseJobs.map((j) => j.subcontractor_rate_id).filter(Boolean) as string[])]
      const uniqueContractRateIds = [...new Set(baseJobs.map((j) => j.contract_rate_id).filter(Boolean) as string[])]
      if (uniqueSubRateIds.length > 0) {
        const { data } = await supabase.from('subcontractor_rates').select('id, rate_per_hour').in('id', uniqueSubRateIds)
        for (const r of (data ?? []) as Array<{ id: string; rate_per_hour: number }>) subRatePHMap.set(r.id, r.rate_per_hour)
      }
      if (uniqueContractRateIds.length > 0) {
        const { data } = await supabase.from('contract_rates').select('id, rate_per_hour').in('id', uniqueContractRateIds)
        for (const r of (data ?? []) as Array<{ id: string; rate_per_hour: number }>) contractRatePHMap.set(r.id, r.rate_per_hour)
      }

      setJobs(baseJobs.map((j) => ({
        ...j,
        subcontractor_rate_ph: j.subcontractor_rate_id ? (subRatePHMap.get(j.subcontractor_rate_id) ?? null) : null,
        contract_rate_ph: j.contract_rate_id ? (contractRatePHMap.get(j.contract_rate_id) ?? null) : null,
      })) as ReportJob[])

      // Formal invoices (B2B / subcontractor) whose billing period overlaps
      // the selected window.
      const { data: invRows } = await supabase
        .from('invoices')
        .select('id, invoice_number, type, entity_name, period_from, period_to, status, total_amount')
        .in('type', ['subcontractor', 'b2b_client'])
        .lte('period_from', dateTo)
        .gte('period_to', dateFrom)
        .order('period_from', { ascending: false })
      setInvoices((invRows ?? []) as FormalInvoice[])

      // Payroll reviews (employee/casual) whose period overlaps the window.
      const { data: revRows } = await supabase
        .from('invoice_reviews')
        .select('id, subject_type, subject_name, period_from, period_to, status')
        .lte('period_from', dateTo)
        .gte('period_to', dateFrom)
        .order('period_from', { ascending: false })
      setReviews((revRows ?? []) as InvoiceReviewRow[])

      const { data: fleetRows } = await supabase.from('fleet').select('*').eq('is_active', true).order('name')
      setFleet((fleetRows ?? []) as Fleet[])

      const { data: fuelRows } = await supabase.from('fleet_fuel_logs').select('*').gte('date', dateFrom).lte('date', dateTo)
      setFuelLogs((fuelRows ?? []) as FleetFuelLog[])

      setLoading(false)
    }
    load()
  }, [dateFrom, dateTo]) // eslint-disable-line react-hooks/exhaustive-deps

  const revenueTotal = useMemo(() => jobs.reduce((s, j) => s + (calcRevenue(j) ?? 0), 0), [jobs])
  const jobsPaid = useMemo(() => jobs.filter((j) => j.status === 'paid'), [jobs])
  const jobsPending = useMemo(() => jobs.filter((j) => j.status !== 'paid'), [jobs])
  const paidRevenue = useMemo(() => jobsPaid.reduce((s, j) => s + (calcRevenue(j) ?? 0), 0), [jobsPaid])
  const pendingRevenue = useMemo(() => jobsPending.reduce((s, j) => s + (calcRevenue(j) ?? 0), 0), [jobsPending])

  const revenueBySource = useMemo(() => {
    const g = { private: 0, subcontract: 0, contract: 0 }
    for (const j of jobs) g[j.source] += calcRevenue(j) ?? 0
    return g
  }, [jobs])

  const paymentMethodTotals = useMemo(() => {
    const totals: Record<string, number> = { cash: 0, bank_transfer: 0, card: 0 }
    for (const j of jobsPaid) {
      totals.cash += Number(j.payment_cash_amount) || 0
      totals.bank_transfer += Number(j.payment_transfer_amount) || 0
      totals.card += Number(j.payment_card_amount) || 0
    }
    return totals
  }, [jobsPaid])

  const flaggedJobs = useMemo(() => jobs.filter((j) => j.flagged), [jobs])

  const invoicesByStatus = useMemo(() => {
    const g: Record<FormalInvoice['status'], FormalInvoice[]> = { draft: [], sent: [], paid: [] }
    for (const inv of invoices) g[inv.status].push(inv)
    return g
  }, [invoices])

  const reviewsByStatus = useMemo(() => {
    const g: Record<InvoiceReviewRow['status'], InvoiceReviewRow[]> = { reviewed: [], pending_approval: [], approved: [], paid: [] }
    for (const r of reviews) g[r.status].push(r)
    return g
  }, [reviews])

  const truckCosts = useMemo(() => {
    const map = new Map<string, { litres: number; cost: number }>()
    for (const log of fuelLogs) {
      const cur = map.get(log.fleet_id) ?? { litres: 0, cost: 0 }
      cur.litres += Number(log.litres) || 0
      cur.cost += Number(log.cost) || 0
      map.set(log.fleet_id, cur)
    }
    return fleet
      .map((f) => ({ fleet: f, litres: map.get(f.id)?.litres ?? 0, cost: map.get(f.id)?.cost ?? 0 }))
      .sort((a, b) => b.cost - a.cost)
  }, [fleet, fuelLogs])

  const totalFuelCost = useMemo(() => fuelLogs.reduce((s, l) => s + (Number(l.cost) || 0), 0), [fuelLogs])
  const totalFuelLitres = useMemo(() => fuelLogs.reduce((s, l) => s + (Number(l.litres) || 0), 0), [fuelLogs])
  const avgDieselPrice = totalFuelLitres > 0 ? totalFuelCost / totalFuelLitres : null

  return (
    <div className="max-w-4xl pb-16 space-y-4">
      {/* Header + date nav */}
      <div className="flex items-center justify-between mb-1 flex-wrap gap-3">
        <h1 className="text-2xl font-display font-bold text-parchment">Reporting</h1>
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
        </div>
      </div>

      {loading ? (
        <p className="text-warm text-sm py-12 text-center">Loading…</p>
      ) : (
        <>
          {/* ── KPI row ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCard label="Jobs" value={String(jobs.length)} />
            <SummaryCard label="Revenue" value={fmtAUD(revenueTotal)} />
            <SummaryCard label="Paid" value={fmtAUD(paidRevenue)} valueClass="text-success" />
            <SummaryCard label="Pending" value={fmtAUD(pendingRevenue)} valueClass="text-amber-300" />
          </div>

          {/* ── Revenue by source ───────────────────────────────────────── */}
          <Section title="Revenue by Source" icon={<DollarSign size={13} />}>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-dim text-xs uppercase tracking-wide mb-0.5">Private</div>
                <div className="font-mono font-semibold text-parchment">{fmtAUD(revenueBySource.private)}</div>
              </div>
              <div>
                <div className="text-dim text-xs uppercase tracking-wide mb-0.5">Subcontract</div>
                <div className="font-mono font-semibold text-parchment">{fmtAUD(revenueBySource.subcontract)}</div>
              </div>
              <div>
                <div className="text-dim text-xs uppercase tracking-wide mb-0.5">Contract</div>
                <div className="font-mono font-semibold text-parchment">{fmtAUD(revenueBySource.contract)}</div>
              </div>
            </div>
          </Section>

          {/* ── Payment status ──────────────────────────────────────────── */}
          <Section title="Job Payment Status" icon={<CheckCircle2 size={13} />}>
            <div className="grid grid-cols-2 gap-3 text-sm mb-3">
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-teal-500/10">
                <span className="text-teal-300 font-medium">Paid</span>
                <span className="font-mono text-teal-300">{jobsPaid.length} jobs · {fmtAUD(paidRevenue)}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-amber-500/10">
                <span className="text-amber-300 font-medium">Pending</span>
                <span className="font-mono text-amber-300">{jobsPending.length} jobs · {fmtAUD(pendingRevenue)}</span>
              </div>
            </div>
            {(paymentMethodTotals.cash > 0 || paymentMethodTotals.bank_transfer > 0 || paymentMethodTotals.card > 0) && (
              <div>
                <div className="text-dim text-xs uppercase tracking-wide mb-1.5">Payment Methods (Paid Jobs)</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(paymentMethodTotals).filter(([, v]) => v > 0).map(([k, v]) => (
                    <span key={k} className="text-xs px-2.5 py-1 rounded-full bg-panel border border-wire text-warm">
                      {PAYMENT_METHOD_LABEL[k] ?? k}: <span className="font-mono text-parchment">{fmtMoney(v)}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* ── Formal invoices status ──────────────────────────────────── */}
          <Section title="Formal Invoices (B2B / Subcontractor)" icon={<Clock3 size={13} />}>
            {invoices.length === 0 ? (
              <p className="text-dim text-sm">No invoices for this period.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {(['draft', 'sent', 'paid'] as const).map((s) => (
                  <div key={s} className={`rounded-lg px-3 py-2 ${INVOICE_STATUS_COLOR[s]}`}>
                    <div className="text-xs font-medium uppercase tracking-wide mb-0.5">{s}</div>
                    <div className="font-mono text-sm">
                      {invoicesByStatus[s].length} · {fmtAUD(invoicesByStatus[s].reduce((sum, i) => sum + Number(i.total_amount || 0), 0))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ── Payroll review status ───────────────────────────────────── */}
          <Section title="Payroll Reviews (Employees / Casuals)" icon={<Clock3 size={13} />}>
            {reviews.length === 0 ? (
              <p className="text-dim text-sm">No reviews for this period.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(['reviewed', 'pending_approval', 'approved', 'paid'] as const).map((s) => (
                  <div key={s} className={`rounded-lg px-3 py-2 ${REVIEW_STATUS_COLOR[s]}`}>
                    <div className="text-xs font-medium uppercase tracking-wide mb-0.5">{REVIEW_STATUS_LABEL[s]}</div>
                    <div className="font-mono text-sm">{reviewsByStatus[s].length}</div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ── Truck costs ──────────────────────────────────────────────── */}
          <Section title="Truck Costs (Diesel)" icon={<Truck size={13} />}>
            <div className="flex items-center justify-between mb-3 text-sm">
              <span className="text-dim">Total spend this period</span>
              <span className="font-mono font-semibold text-parchment">{fmtMoney(totalFuelCost)}</span>
            </div>
            {avgDieselPrice != null && (
              <div className="flex items-center justify-between mb-3 text-sm">
                <span className="text-dim flex items-center gap-1"><Fuel size={13} /> Avg diesel price (baseline)</span>
                <span className="font-mono text-warm">${avgDieselPrice.toFixed(2)}/L</span>
              </div>
            )}
            {truckCosts.every((t) => t.cost === 0) ? (
              <p className="text-dim text-sm">No fuel logs for this period. Log fill-ups on the Fleet page to see spend here.</p>
            ) : (
              <div className="divide-y divide-wire">
                {truckCosts.map(({ fleet: f, litres, cost }) => (
                  <div key={f.id} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-warm">{f.name}{f.registration ? ` (${f.registration})` : ''}</span>
                    <span className="font-mono text-parchment">
                      {litres > 0 ? `${litres.toFixed(0)}L · ` : ''}{fmtMoney(cost)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ── Flagged jobs ─────────────────────────────────────────────── */}
          <Section title="Flagged Jobs (Needs Attention)" icon={<Flag size={13} className="text-red-400" />}>
            {flaggedJobs.length === 0 ? (
              <p className="text-dim text-sm">No flagged jobs for this period.</p>
            ) : (
              <div className="space-y-2">
                {flaggedJobs.map((job) => (
                  <button
                    key={job.id}
                    onClick={() => router.push(`/jobs/${job.id}/edit`)}
                    className="w-full text-left flex items-start justify-between gap-3 px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/20 hover:bg-red-500/10 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-mono text-parchment text-sm">#{job.job_number}</span>
                        <span className="text-xs text-dim">{job.date}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_STYLE[job.status] ?? 'bg-wire/50 text-warm'}`}>{job.status}</span>
                      </div>
                      <div className="text-xs text-dim">{entityLabel(job)}</div>
                      {job.flag_note && <p className="text-sm text-red-300 mt-1">{job.flag_note}</p>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  )
}
