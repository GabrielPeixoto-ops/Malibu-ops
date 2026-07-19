'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, Trash2, ChevronLeft, ImagePlus, CheckCircle, Lock,
  X, Star, Banknote, FileText, XCircle, FilePlus,
} from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { calculateJobSummary, extractFormulaVars, type JobSummary, type PrivateRateInput } from '@/lib/billing'
import type {
  CasualWorker,
  CommissionType,
  Contract,
  ContractClient,
  ContractRate,
  Customer,
  Employee,
  FormulaConfig,
  JobSource,
  JobStatus,
  PercentConfig,
  Fleet,
  MaterialCatalog,
  PrivateRate,
  RateCardConfig,
  Subcontractor,
  SubcontractorConfig,
  SubcontractorRate,
} from '@/types/database'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import AddressInput from '@/components/ui/AddressInput'
import Select from '@/components/ui/Select'
import Modal from '@/components/ui/Modal'

// ─── Local types ──────────────────────────────────────────────────────────────
interface JobComment {
  id: string
  job_id: string
  author_name: string
  body: string
  created_at: string
}

interface CrewRow {
  _id: string
  employee_id: string
  hours: string
  start_time: string
  end_time: string
  cof_share: boolean
  cof_hours: string
  heavy_item: boolean
}

// Always rounds UP to the next 15-minute block — same rule used for the
// job-level actual_start_time/actual_finish_time calc, applied consistently
// to individual per-person times too (crew, casual crew, extra men). Any
// partial block (even 1 minute) counts as a full 15-min block, matching how
// client billing has always worked.
function calcCrewHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const mins = (eh * 60 + em) - (sh * 60 + sm)
  return Math.max(0, Math.ceil(mins / 15) * 15 / 60)
}

function crewHasTime(row: { start_time: string; end_time: string }): boolean {
  return row.start_time.length === 5 && row.end_time.length === 5
}

function resolveCrewHours(row: CrewRow): number {
  return crewHasTime(row) ? calcCrewHours(row.start_time, row.end_time) : parseFloat(row.hours) || 0
}

interface MaterialRow {
  _id: string
  material_name: string
  quantity: string
  cost_price: string
  sale_price: string
}

interface ExtraManRow {
  _id: string
  dbId?: string
  // Free-text name with autofill against Staff/Casual Workers, mirroring the
  // Casual / Packing Crew row — this is a sporadic mid-job addition, not a
  // dropdown pick. Resolved to a staff or casual-worker id at render/save
  // time by matching name (see resolveExtraMan()); if the name doesn't match
  // anyone, the person is offered up to be added as a new casual worker.
  name: string
  rate_per_hour: string
  start_time: string
  finish_time: string
  cof_share: boolean
  // Legacy flat one-off amount charged to the client for this extra man —
  // kept only for rows saved before client_rate_per_hour existed; no longer
  // editable in the UI.
  client_charge: string
  // Hourly rate charged to the client for this extra man — pure company
  // revenue/profit, independent of what the extra man is actually paid (hours
  // worked + COF + review bonus, computed separately for payroll). Total
  // charged = hours × this rate, computed automatically instead of typed.
  client_rate_per_hour: string
}

interface JobTruckRow {
  fleet_id: string
  // Amount charged to the client for this specific truck (e.g. a job that
  // escalates mid-way and needs a second truck sent out) — same optional
  // "client_charge" concept as Extra Man, purely informational/revenue,
  // independent of any truck operating cost.
  client_charge: string
}

// A Private/Contract job's crew or truck count can change mid-day (e.g.
// starts 2 Men & 1 Truck, becomes 3 Men & 1 Truck, then 4 Men & 2 Trucks) —
// the CLIENT rate must change for that segment too, not just the payroll
// side. Each row is one segment of the day billed at its own rate; label/
// rate_per_hour are the resolved values at save time (not just a foreign
// key), same convention as Extra Man's free-text name/rate, so historical
// jobs keep showing what was actually charged even if the rate card changes
// later.
interface RateBlockRow {
  _id: string
  dbId: string | null
  label: string
  rate_per_hour: string
  start_time: string
  finish_time: string
}

interface PhotoLocal {
  _id: string
  dbId?: string
  url: string
  caption: string
  storagePath?: string
  category: string
}

interface CasualCrewRow {
  _id: string
  dbId?: string
  name: string
  rate_per_hour: string
  start_time: string
  finish_time: string
  cof_share: boolean
  heavy_item: boolean
}

interface CommissionRow {
  _id: string
  dbId?: string
  commission_type_id: string
  employee_id: string
  casual_worker_id: string
  rate_per_hour: string
  hours: string
}

interface ExtraAddressRow {
  _id: string
  dbId?: string
  address_type: 'pickup' | 'dropoff'
  address: string
}

interface ExpenseRow {
  _id: string
  dbId: string | null
  description: string
  amount: string
  is_client_expense: boolean
}

// Money an employee or casual worker spends out of pocket on the job (e.g. a
// parking ticket) that must be reimbursed to them — surfaces as an extra pay
// line on that specific person's invoice. Same dual-reference (staff/casual)
// pattern as CommissionRow.
interface EmployeeExpenseRow {
  _id: string
  dbId: string | null
  employee_id: string
  casual_worker_id: string
  description: string
  amount: string
}

interface FormState {
  job_number: string
  date: string
  status: JobStatus
  source: JobSource
  subcontractor_id: string
  customer_id: string
  contract_id: string
  contract_client_id: string
  pickup_address: string
  delivery_address: string
  cof: string
  cof_final: string
  additional_hours: string
  additional_rate: string
  rate_card_key: string
  formula_vars: Record<string, string>
  extra_men_hours: string
  extra_man_employee_id: string
  break_minutes: string
  discount: string
  notes: string
  completion_notes: string
  actual_start_time: string
  actual_finish_time: string
  scheduled_time: string
  scheduled_finish_time: string
  reference_number: string
  // Private billing
  private_rate_id: string
  private_rate_custom: boolean
  private_rate_custom_desc: string
  private_rate_custom_price: string
  google_review: boolean
  google_review_employee_ids: string[]
  // Payment
  payment_date: string
  payment_methods: string[]
  payment_cash_amount: string
  payment_transfer_amount: string
  payment_card_amount: string
  payment_collected_by: string
  // Cancellation
  cancellation_reason: string
  minimum_charge_applied: boolean
  minimum_charge_amount: string
  // Subcontract service details
  subcontractor_service_type: string
  subcontractor_trucks: string
  subcontractor_crew_size: string
  subcontractor_rate_id: string
  contract_rate_id: string
  contract_rate_custom: boolean
  contract_rate_custom_price: string
  contract_client_name: string
  contractor_job_id: string
  gross_job_value: string
  client_cof_override: boolean
  client_cof_hours: string
  deposit: string
  heavy_item_charge: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PHOTO_CATEGORIES = [
  { value: 'inventory', label: 'Inventory' },
  { value: 'completion', label: 'Completion' },
  { value: 'damage', label: 'Damage' },
  { value: 'receipt', label: 'Receipt' },
  { value: 'google_review', label: 'Google Review' },
] as const

const PHOTO_LABELS: Record<string, string> = {
  inventory: 'Inventory',
  completion: 'Completion',
  damage: 'Damage',
  receipt: 'Receipt',
  google_review: 'Google Review',
}

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'card', label: 'Card' },
]

const STATUS_STYLE: Record<JobStatus, string> = {
  draft: 'bg-wire/50 text-dim',
  scheduled: 'bg-blue-500/10 text-blue-300',
  confirmed: 'bg-indigo-500/10 text-indigo-300',
  in_progress: 'bg-amber-500/10 text-amber-300',
  completed: 'bg-success/10 text-success',
  reviewed: 'bg-cyan-500/10 text-cyan-300',
  invoiced: 'bg-purple-500/10 text-purple-300',
  paid: 'bg-teal-500/10 text-teal-300',
  cancelled: 'bg-danger/10 text-danger',
}

const STATUS_LABEL: Record<JobStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  in_progress: 'In Progress',
  completed: 'Completed',
  reviewed: 'Reviewed',
  invoiced: 'Invoiced',
  paid: 'Paid',
  cancelled: 'Cancelled',
}

const fmt = (n: number) =>
  n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 })

function defaultForm(): FormState {
  return {
    job_number: '',
    date: new Date().toISOString().split('T')[0],
    status: 'draft',
    source: 'subcontract',
    subcontractor_id: '',
    customer_id: '',
    contract_id: '',
    contract_client_id: '',
    pickup_address: '',
    delivery_address: '',
    cof: '',
    cof_final: '',
    additional_hours: '',
    additional_rate: '',
    rate_card_key: '',
    formula_vars: {},
    extra_men_hours: '',
    extra_man_employee_id: '',
    break_minutes: '',
    discount: '',
    notes: '',
    completion_notes: '',
    actual_start_time: '',
    actual_finish_time: '',
    scheduled_time: '',
    scheduled_finish_time: '',
    reference_number: '',
    private_rate_id: '',
    private_rate_custom: false,
    private_rate_custom_desc: '',
    private_rate_custom_price: '',
    google_review: false,
    google_review_employee_ids: [],
    payment_date: '',
    payment_methods: [],
    payment_cash_amount: '',
    payment_transfer_amount: '',
    payment_card_amount: '',
    payment_collected_by: '',
    cancellation_reason: '',
    minimum_charge_applied: false,
    minimum_charge_amount: '',
    subcontractor_service_type: '',
    subcontractor_trucks: '',
    subcontractor_crew_size: '',
    subcontractor_rate_id: '',
    contract_rate_id: '',
    contract_rate_custom: false,
    contract_rate_custom_price: '',
    contract_client_name: '',
    contractor_job_id: '',
    gross_job_value: '',
    client_cof_override: false,
    client_cof_hours: '',
    deposit: '',
    heavy_item_charge: '',
  }
}

// ─── Billing override helpers ─────────────────────────────────────────────────
function emptyOverrideBilling() {
  return {
    billing_type: 'ratecard',
    percent: '0',
    gst: true,
    rateEntries: [['', '']] as [string, string][],
    extra_men_rate: '',
    expression: '',
    defaults: '{}',
  }
}

type OverrideBilling = ReturnType<typeof emptyOverrideBilling>

function buildOverrideConfig(ob: OverrideBilling): Record<string, unknown> {
  if (ob.billing_type === 'percent') {
    return { billing_type: 'percent', percent: parseFloat(ob.percent) || 0 }
  }
  if (ob.billing_type === 'ratecard') {
    const rates: Record<string, number> = {}
    for (const [k, v] of ob.rateEntries) {
      if (k.trim()) rates[k.trim()] = parseFloat(v) || 0
    }
    const cfg: Record<string, unknown> = { billing_type: 'ratecard', gst: ob.gst, rates }
    if (ob.extra_men_rate.trim()) cfg.extra_men_rate = parseFloat(ob.extra_men_rate) || 0
    return cfg
  }
  let defaults: Record<string, number> = {}
  try { defaults = JSON.parse(ob.defaults) } catch { /* */ }
  return { billing_type: 'formula', expression: ob.expression, defaults }
}

function overrideBillingFromConfig(config: Record<string, unknown>): OverrideBilling {
  const ob = emptyOverrideBilling()
  ob.billing_type = (config.billing_type as string) ?? 'ratecard'
  if (ob.billing_type === 'percent') {
    ob.percent = String((config as unknown as PercentConfig).percent ?? 0)
  } else if (ob.billing_type === 'ratecard') {
    ob.gst = (config.gst as boolean) ?? true
    const rates = (config.rates as Record<string, number>) ?? {}
    const entries = Object.entries(rates).map(([k, v]) => [k, String(v)] as [string, string])
    ob.rateEntries = entries.length > 0 ? entries : [['', '']]
    ob.extra_men_rate = config.extra_men_rate ? String(config.extra_men_rate) : ''
  } else {
    ob.expression = (config.expression as string) ?? ''
    ob.defaults = JSON.stringify(config.defaults ?? {}, null, 0)
  }
  return ob
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function JobForm({ jobId }: { jobId?: string }) {
  const isEdit = Boolean(jobId)
  const supabase = createClient()
  const router = useRouter()

  const [subs, setSubs] = useState<Subcontractor[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [casualWorkers, setCasualWorkers] = useState<CasualWorker[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [contracts, setContracts] = useState<(Contract & { contract_clients: ContractClient[] })[]>([])
  const [privateRates, setPrivateRates] = useState<PrivateRate[]>([])
  const [subRates, setSubRates] = useState<SubcontractorRate[]>([])
  const [contractRates, setContractRates] = useState<ContractRate[]>([])
  const [fleet, setFleet] = useState<Fleet[]>([])
  const [jobTruckRows, setJobTruckRows] = useState<JobTruckRow[]>([])
  const [rateBlocks, setRateBlocks] = useState<RateBlockRow[]>([])
  const [catalog, setCatalog] = useState<MaterialCatalog[]>([])
  const [showCatalogDrop, setShowCatalogDrop] = useState(false)
  const catalogRef = useRef<HTMLDivElement>(null)
  const [form, setForm] = useState<FormState>(defaultForm())
  const [crew, setCrew] = useState<CrewRow[]>([])
  const [extraMen, setExtraMan] = useState<ExtraManRow[]>([])
  const [casualCrew, setCasualCrew] = useState<CasualCrewRow[]>([])
  const [commissions, setCommissions] = useState<CommissionRow[]>([])
  const [commissionTypes, setCommissionTypes] = useState<CommissionType[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [employeeExpenses, setEmployeeExpenses] = useState<EmployeeExpenseRow[]>([])
  const [extraAddresses, setExtraAddresses] = useState<ExtraAddressRow[]>([])
  const [materials, setMaterials] = useState<MaterialRow[]>([])
  const [photos, setPhotos] = useState<PhotoLocal[]>([])
  const [photoCaption, setPhotoCaption] = useState('')
  const [photoCategory, setPhotoCategory] = useState('inventory')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [comments, setComments] = useState<JobComment[]>([])
  const [commentText, setCommentText] = useState('')
  // Lazy-initialized from localStorage (client-only) instead of an effect —
  // this app uses a single shared login, so there's no per-user auth
  // identity to attribute comments to; remembering the typed name locally
  // means the same person on the same browser doesn't retype it each time.
  const [commentAuthor, setCommentAuthor] = useState(() =>
    typeof window !== 'undefined' ? window.localStorage.getItem('jobCommentAuthor') ?? '' : ''
  )
  const [postingComment, setPostingComment] = useState(false)
  const pendingJobId = useRef(crypto.randomUUID())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [markingReviewed, setMarkingReviewed] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [overrideBilling, setOverrideBilling] = useState<OverrideBilling>(emptyOverrideBilling())
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [isViewMode, setIsViewMode] = useState(isEdit)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [pendingNewCasualWorker, setPendingNewCasualWorker] = useState<{
    rowId: string; name: string; rate: number; thenSave?: boolean
  } | null>(null)
  const declinedCasualWorkerNamesRef = useRef<Set<string>>(new Set())
  const [dbMalibuRevenue, setDbMalibuRevenue] = useState<number | null>(null)

  const [customerSearch, setCustomerSearch] = useState('')
  const [showCustomerDrop, setShowCustomerDrop] = useState(false)
  const customerRef = useRef<HTMLDivElement>(null)

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const [subsRes, empsRes, custsRes, contsRes, ratesRes, fleetRes, catalogRes] = await Promise.all([
        supabase.from('subcontractors').select('*').order('name'),
        supabase.from('employees').select('*').eq('active', true).order('name'),
        supabase.from('customers').select('*').order('name'),
        supabase.from('contracts').select('*, contract_clients(*)').order('name'),
        supabase.from('private_rates').select('*').eq('is_active', true).order('sort_order'),
        supabase.from('fleet').select('*').eq('is_active', true).order('name'),
        supabase.from('material_catalog').select('*').eq('is_active', true).order('sort_order'),
      ])
      const loadedSubs = (subsRes.data ?? []) as Subcontractor[]
      const loadedCustomers = (custsRes.data ?? []) as Customer[]
      const loadedContracts = (contsRes.data ?? []) as (Contract & { contract_clients: ContractClient[] })[]
      const loadedEmployees = (empsRes.data ?? []) as Employee[]
      setSubs(loadedSubs)
      setEmployees(loadedEmployees)
      setCustomers(loadedCustomers)
      setContracts(loadedContracts)
      setPrivateRates((ratesRes.data ?? []) as PrivateRate[])
      setFleet((fleetRes.data ?? []) as unknown as Fleet[])
      setCatalog((catalogRes.data ?? []) as unknown as MaterialCatalog[])
      try {
        const { data: ctData } = await supabase.from('commission_types').select('*').eq('is_active', true).order('sort_order')
        setCommissionTypes((ctData ?? []) as CommissionType[])
      } catch { /* migration not yet applied */ }
      let loadedCasualWorkers: CasualWorker[] = []
      try {
        const { data: cwData } = await supabase.from('casual_workers').select('*').order('name')
        loadedCasualWorkers = (cwData ?? []) as CasualWorker[]
        setCasualWorkers(loadedCasualWorkers)
      } catch { /* migration not yet applied */ }

      try {
        const { data: srData } = await supabase.from('subcontractor_rates').select('*').eq('is_active', true).order('sort_order')
        setSubRates((srData ?? []) as SubcontractorRate[])
      } catch { /* migration not applied yet */ }
      try {
        const { data: crData } = await supabase.from('contract_rates').select('*').eq('is_active', true).order('sort_order')
        setContractRates((crData ?? []) as ContractRate[])
      } catch { /* migration not applied yet */ }

      if (isEdit && jobId) {
        const [jobRes, photosRes, trucksRes, commentsRes] = await Promise.all([
          supabase.from('jobs').select('*, job_crew(*), job_materials(*)').eq('id', jobId).single(),
          supabase.from('job_photos').select('*').eq('job_id', jobId).order('created_at'),
          supabase.from('job_trucks').select('fleet_id, client_charge_amount').eq('job_id', jobId),
          supabase.from('job_comments').select('*').eq('job_id', jobId).order('created_at'),
        ])
        setJobTruckRows((trucksRes.data ?? []).map((r: { fleet_id: string; client_charge_amount?: number }) => ({
          fleet_id: r.fleet_id,
          client_charge: r.client_charge_amount ? r.client_charge_amount.toString() : '',
        })))
        setComments((commentsRes.data ?? []) as JobComment[])

        if (jobRes.data) {
          const j = jobRes.data as {
            job_number: string; date: string; status: JobStatus
            source: JobSource
            subcontractor_id: string; customer_id: string | null
            contract_id: string | null; contract_client_id: string | null
            client_billing_config: Record<string, unknown> | null
            pickup_address: string | null; delivery_address: string | null
            cof: number | null; cof_final: number | null
            additional_hours: number | null; additional_rate: number | null
            rate_card_key: string | null; formula_vars: Record<string, number> | null
            extra_men_hours: number; extra_man_employee_id: string | null; break_minutes: number
            discount: number; notes: string | null; completion_notes: string | null
            actual_start_time: string | null; actual_finish_time: string | null
            scheduled_time: string | null; scheduled_finish_time: string | null; reference_number: string | null
            private_rate_id: string | null; private_rate_custom: boolean
            private_rate_custom_desc: string | null; private_rate_custom_price: number | null
            google_review: boolean; google_review_employee_ids: string[]
            payment_date: string | null; payment_methods: string[]
            payment_cash_amount: number; payment_transfer_amount: number; payment_card_amount: number
            payment_collected_by: string | null
            cancellation_reason: string | null
            minimum_charge_applied: boolean; minimum_charge_amount: number
            subcontractor_service_type: string | null
            subcontractor_trucks: string | null
            subcontractor_crew_size: number | null
            subcontractor_rate_id: string | null
            contract_rate_id: string | null
            contract_rate_custom_price: number | null
            contract_client_name: string | null
            contractor_job_id: string | null
            gross_job_value: number | null
            malibu_revenue: number | null
            client_cof_override: boolean
            client_cof_hours: number | null
            deposit: number | null
            heavy_item_charge: number | null
            job_crew: Array<{ employee_id: string; hours: number; cof_share: boolean; cof_hours: number; heavy_item: boolean; start_time: string | null; end_time: string | null }>
            job_materials: Array<{ material_name: string; quantity: number; cost_price: number; sale_price: number }>
          }

          const src = j.source ?? 'subcontract'
          let fvars: Record<string, string> = {}
          if (j.formula_vars) {
            fvars = Object.fromEntries(Object.entries(j.formula_vars).map(([k, v]) => [k, String(v)]))
          } else if (src === 'subcontract') {
            const sub = loadedSubs.find((s) => s.id === j.subcontractor_id)
            if (sub?.billing_type === 'formula') {
              const { expression, defaults } = sub.config as FormulaConfig
              const keys = extractFormulaVars(expression)
              fvars = Object.fromEntries(keys.map((k) => [k, String(defaults[k] ?? '')]))
            }
          } else if (src === 'contract') {
            const contract = loadedContracts.find((c) => c.id === j.contract_id)
            if (contract?.billing_type === 'formula') {
              const { expression, defaults } = contract.billing_config as FormulaConfig
              const keys = extractFormulaVars(expression)
              fvars = Object.fromEntries(keys.map((k) => [k, String(defaults[k] ?? '')]))
            }
          }

          setForm({
            job_number: j.job_number,
            date: j.date,
            status: j.status,
            source: src,
            subcontractor_id: j.subcontractor_id ?? '',
            customer_id: j.customer_id ?? '',
            contract_id: j.contract_id ?? '',
            contract_client_id: j.contract_client_id ?? '',
            pickup_address: j.pickup_address ?? '',
            delivery_address: j.delivery_address ?? '',
            cof: j.cof?.toString() ?? '',
            cof_final: j.cof_final?.toString() ?? '',
            additional_hours: j.additional_hours?.toString() ?? '',
            additional_rate: j.additional_rate?.toString() ?? '',
            rate_card_key: j.rate_card_key ?? '',
            formula_vars: fvars,
            extra_men_hours: j.extra_men_hours > 0 ? j.extra_men_hours.toString() : '',
            extra_man_employee_id: j.extra_man_employee_id ?? '',
            break_minutes: j.break_minutes > 0 ? j.break_minutes.toString() : '',
            discount: j.discount?.toString() ?? '',
            notes: j.notes ?? '',
            completion_notes: j.completion_notes ?? '',
            actual_start_time: j.actual_start_time ?? '',
            actual_finish_time: j.actual_finish_time ?? '',
            scheduled_time: j.scheduled_time ?? '',
            scheduled_finish_time: j.scheduled_finish_time ?? '',
            reference_number: j.reference_number ?? '',
            private_rate_id: j.private_rate_id ?? '',
            private_rate_custom: j.private_rate_custom ?? false,
            private_rate_custom_desc: j.private_rate_custom_desc ?? '',
            private_rate_custom_price: j.private_rate_custom_price != null ? j.private_rate_custom_price.toString() : '',
            google_review: j.google_review ?? false,
            google_review_employee_ids: j.google_review_employee_ids ?? [],
            payment_date: j.payment_date ?? '',
            payment_methods: j.payment_methods ?? [],
            payment_cash_amount: j.payment_cash_amount > 0 ? j.payment_cash_amount.toString() : '',
            payment_transfer_amount: j.payment_transfer_amount > 0 ? j.payment_transfer_amount.toString() : '',
            payment_card_amount: j.payment_card_amount > 0 ? j.payment_card_amount.toString() : '',
            payment_collected_by: j.payment_collected_by ?? '',
            cancellation_reason: j.cancellation_reason ?? '',
            minimum_charge_applied: j.minimum_charge_applied ?? false,
            minimum_charge_amount: j.minimum_charge_amount > 0 ? j.minimum_charge_amount.toString() : '',
            subcontractor_service_type: j.subcontractor_service_type ?? '',
            subcontractor_trucks: j.subcontractor_trucks ?? '',
            subcontractor_crew_size: j.subcontractor_crew_size != null ? j.subcontractor_crew_size.toString() : '',
            subcontractor_rate_id: j.subcontractor_rate_id ?? '',
            contract_rate_id: j.contract_rate_id ?? '',
            contract_rate_custom: j.contract_rate_id == null && j.contract_rate_custom_price != null,
            contract_rate_custom_price: j.contract_rate_custom_price != null ? j.contract_rate_custom_price.toString() : '',
            contract_client_name: j.contract_client_name
              ?? (j.contract_client_id
                ? loadedContracts.find((c) => c.id === j.contract_id)?.contract_clients?.find((cc) => cc.id === j.contract_client_id)?.name ?? ''
                : ''),
            contractor_job_id: j.contractor_job_id ?? '',
            gross_job_value: j.gross_job_value != null ? j.gross_job_value.toString() : '',
            client_cof_override: j.client_cof_override ?? false,
            client_cof_hours: j.client_cof_hours != null ? j.client_cof_hours.toString() : '',
            deposit: j.deposit != null ? j.deposit.toString() : '',
            heavy_item_charge: j.heavy_item_charge != null ? j.heavy_item_charge.toString() : '',
          })
          setDbMalibuRevenue(j.malibu_revenue)

          if (j.client_billing_config) {
            setOverrideBilling(overrideBillingFromConfig(j.client_billing_config))
            setOverrideOpen(true)
          }

          const cust = loadedCustomers.find((c) => c.id === j.customer_id)
          if (cust) setCustomerSearch(cust.name)

          setCrew(j.job_crew.map((c) => ({
            _id: crypto.randomUUID(),
            employee_id: c.employee_id,
            hours: c.hours.toString(),
            start_time: c.start_time ?? '',
            end_time: c.end_time ?? '',
            cof_share: c.cof_share,
            cof_hours: c.cof_hours > 0 ? c.cof_hours.toString() : '0.5',
            heavy_item: c.heavy_item ?? false,
          })))

          try {
            const { data: emData } = await supabase.from('job_extra_men').select('*').eq('job_id', jobId).order('created_at')
            setExtraMan((emData ?? []).map((r: { id: string; employee_id: string | null; name?: string | null; rate_per_hour?: number | null; start_time: string | null; finish_time: string | null; cof_share?: boolean; client_charge_amount?: number; client_rate_per_hour?: number }) => {
              // Legacy rows (saved before the free-text name/rate columns existed)
              // only have employee_id — resolve a display name/rate from it.
              const staffEmp = r.employee_id ? loadedEmployees.find((e) => e.id === r.employee_id) : undefined
              const casualWorker = !staffEmp && r.employee_id ? loadedCasualWorkers.find((cw) => cw.id === r.employee_id) : undefined
              const resolvedName = r.name ?? staffEmp?.name ?? casualWorker?.name ?? ''
              const resolvedRate = r.rate_per_hour ?? staffEmp?.hourly_rate ?? casualWorker?.rate_per_hour ?? null
              return {
                _id: r.id,
                dbId: r.id,
                name: resolvedName,
                rate_per_hour: resolvedRate !== null && resolvedRate !== undefined ? resolvedRate.toString() : '',
                start_time: r.start_time ?? '',
                finish_time: r.finish_time ?? '',
                cof_share: r.cof_share ?? false,
                client_charge: r.client_charge_amount ? r.client_charge_amount.toString() : '',
                client_rate_per_hour: r.client_rate_per_hour ? r.client_rate_per_hour.toString() : '',
              }
            }))
          } catch { /* migration not yet applied */ }

          try {
            const { data: ccData } = await supabase.from('job_casual_crew').select('*').eq('job_id', jobId).order('created_at')
            setCasualCrew((ccData ?? []).map((r: { id: string; name: string; rate_per_hour: number; start_time: string | null; finish_time: string | null; cof_share: boolean; heavy_item: boolean }) => ({
              _id: r.id,
              dbId: r.id,
              name: r.name,
              rate_per_hour: r.rate_per_hour.toString(),
              start_time: r.start_time ?? '',
              finish_time: r.finish_time ?? '',
              cof_share: r.cof_share ?? false,
              heavy_item: r.heavy_item ?? false,
            })))
          } catch { /* migration not yet applied */ }

          try {
            const { data: comData } = await supabase.from('job_commissions').select('*').eq('job_id', jobId).order('created_at')
            setCommissions((comData ?? []).map((r: { id: string; commission_type_id: string | null; employee_id: string | null; casual_worker_id: string | null; rate_per_hour: number; hours: number }) => ({
              _id: r.id,
              dbId: r.id,
              commission_type_id: r.commission_type_id ?? '',
              employee_id: r.employee_id ?? '',
              casual_worker_id: r.casual_worker_id ?? '',
              rate_per_hour: r.rate_per_hour.toString(),
              hours: r.hours.toString(),
            })))
          } catch { /* migration not yet applied */ }

          try {
            const { data: addrData } = await supabase.from('job_addresses').select('*').eq('job_id', jobId).order('sort_order')
            setExtraAddresses((addrData ?? []).map((r: { id: string; address_type: 'pickup' | 'dropoff'; address: string }) => ({
              _id: r.id,
              dbId: r.id,
              address_type: r.address_type,
              address: r.address,
            })))
          } catch { /* migration not yet applied */ }

          try {
            const { data: expData } = await supabase.from('job_expenses').select('*').eq('job_id', jobId).order('created_at')
            setExpenses((expData ?? []).map((r: { id: string; description: string; amount: number; is_client_expense: boolean }) => ({
              _id: r.id,
              dbId: r.id,
              description: r.description,
              amount: r.amount.toString(),
              is_client_expense: r.is_client_expense,
            })))
          } catch { /* migration not yet applied */ }

          try {
            const { data: empExpData } = await supabase.from('job_employee_expenses').select('*').eq('job_id', jobId).order('created_at')
            setEmployeeExpenses((empExpData ?? []).map((r: { id: string; employee_id: string | null; casual_worker_id: string | null; description: string | null; amount: number }) => ({
              _id: r.id,
              dbId: r.id,
              employee_id: r.employee_id ?? '',
              casual_worker_id: r.casual_worker_id ?? '',
              description: r.description ?? '',
              amount: r.amount ? r.amount.toString() : '',
            })))
          } catch { /* migration not yet applied */ }

          try {
            const { data: rbData } = await supabase.from('job_rate_blocks').select('*').eq('job_id', jobId).order('sort_order')
            setRateBlocks((rbData ?? []).map((r: { id: string; label: string | null; rate_per_hour: number; start_time: string | null; finish_time: string | null }) => ({
              _id: r.id,
              dbId: r.id,
              label: r.label ?? '',
              rate_per_hour: r.rate_per_hour ? r.rate_per_hour.toString() : '',
              start_time: r.start_time ?? '',
              finish_time: r.finish_time ?? '',
            })))
          } catch { /* migration not yet applied */ }

          setMaterials(j.job_materials.map((m) => ({
            _id: crypto.randomUUID(),
            material_name: m.material_name,
            quantity: m.quantity.toString(),
            cost_price: m.cost_price.toString(),
            sale_price: m.sale_price.toString(),
          })))

          // Set appropriate default photo category based on job status
          if (j.status === 'in_progress' || j.status === 'completed' || j.status === 'reviewed') {
            setPhotoCategory('completion')
          }
        }

        const rawPhotos = (photosRes.data ?? []) as Array<{ id: string; url: string; caption: string | null; category: string }>
        setPhotos(rawPhotos.map((p) => ({ _id: p.id, dbId: p.id, url: p.url, caption: p.caption ?? '', category: p.category ?? 'inventory' })))
      } else {
        const { data: lastJob } = await supabase
          .from('jobs')
          .select('job_number')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        const lastNum = (lastJob as { job_number: string } | null)?.job_number
        const nextNum = lastNum && /^\d+$/.test(lastNum) ? String(parseInt(lastNum) + 1) : '100001'
        setForm((f) => ({ ...f, job_number: nextNum }))
      }

      setLoading(false)
    }
    load()
  }, [jobId])

  // ── Comments: live updates via Supabase Realtime so comments posted from
  // another device/tab (e.g. the office) show up immediately here, matching
  // how this was used in Trello ("faz em tempo real nos comentários").
  useEffect(() => {
    if (!isEdit || !jobId) return
    const channel = supabase
      .channel(`job_comments:${jobId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'job_comments', filter: `job_id=eq.${jobId}` },
        (payload) => {
          const row = payload.new as JobComment
          setComments((prev) => (prev.some((c) => c.id === row.id) ? prev : [...prev, row]))
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, jobId])

  async function postComment() {
    const body = commentText.trim()
    const author = commentAuthor.trim()
    if (!body || !author || !jobId) return
    setPostingComment(true)
    try {
      window.localStorage.setItem('jobCommentAuthor', author)
      const { data, error: insertErr } = await supabase
        .from('job_comments')
        .insert({ job_id: jobId, author_name: author, body })
        .select()
        .single()
      if (insertErr) throw insertErr
      const row = data as JobComment
      setComments((prev) => (prev.some((c) => c.id === row.id) ? prev : [...prev, row]))
      setCommentText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post comment')
    } finally {
      setPostingComment(false)
    }
  }

  // ── Close dropdowns on outside click ──────────────────────────────────────
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (customerRef.current && !customerRef.current.contains(e.target as Node)) {
        setShowCustomerDrop(false)
      }
      if (catalogRef.current && !catalogRef.current.contains(e.target as Node)) {
        setShowCatalogDrop(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Derived ────────────────────────────────────────────────────────────────
  const selectedSub = subs.find((s) => s.id === form.subcontractor_id) ?? null

  const malibuRevenue = useMemo<number | null>(() => {
    if (form.source !== 'subcontract' || selectedSub?.billing_type !== 'percent') return null
    const gross = parseFloat(form.gross_job_value)
    if (!isNaN(gross) && gross > 0) {
      return gross * (selectedSub.config as PercentConfig).percent
    }
    return dbMalibuRevenue && dbMalibuRevenue > 0 ? dbMalibuRevenue : null
  }, [form.source, form.gross_job_value, selectedSub, dbMalibuRevenue])

  const isBooking = ['draft', 'scheduled', 'confirmed'].includes(form.status)
  const isInProgress = form.status === 'in_progress'
  const isCompletionMode = form.status === 'completed' || form.status === 'reviewed'
  const isReviewed = isViewMode
  // TODO(prod): re-enable when Xero reconciliation lock is implemented — paid jobs conciled in Xero should lock editing
  const isInvoiced = false
  const isPaid = form.status === 'paid'
  const isCancelled = form.status === 'cancelled'
  const showCOF = isInProgress || isCompletionMode
  const showExtraMen = isInProgress || isCompletionMode

  const selectedEntity = useMemo(() => {
    if (form.source === 'private') {
      const cust = customers.find((c) => c.id === form.customer_id)
      if (!cust || !cust.billing_type || !cust.billing_config) return null
      return { billing_type: cust.billing_type, billing_config: cust.billing_config as SubcontractorConfig }
    }
    if (form.source === 'contract') {
      const contract = contracts.find((c) => c.id === form.contract_id)
      if (!contract) return null
      return { billing_type: contract.billing_type, billing_config: contract.billing_config as SubcontractorConfig }
    }
    return null
  }, [form.source, form.customer_id, form.contract_id, customers, contracts])

  const activeBillingType = form.source === 'subcontract' ? selectedSub?.billing_type : selectedEntity?.billing_type
  const activeConfig = form.source === 'subcontract' ? selectedSub?.config : selectedEntity?.billing_config
  const hasActiveEntity = form.source === 'subcontract' ? !!selectedSub : !!selectedEntity

  const rateCardKeys = useMemo<{ value: string; label: string }[]>(() => {
    if (activeBillingType !== 'ratecard' || !activeConfig) return []
    const { rates } = activeConfig as RateCardConfig
    return Object.keys(rates).map((k) => ({ value: k, label: `${k} — ${fmt(rates[k])}` }))
  }, [activeBillingType, activeConfig])

const filteredCustomers = useMemo(
    () => customers.filter((c) =>
      c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      (c.phone ?? '').includes(customerSearch) ||
      (c.contact_info ?? '').toLowerCase().includes(customerSearch.toLowerCase())
    ),
    [customers, customerSearch]
  )

  const selectedContract = contracts.find((c) => c.id === form.contract_id)
  const availableContractClients = selectedContract?.contract_clients ?? []

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === form.customer_id) ?? null,
    [customers, form.customer_id]
  )

  const entityDisplayName = useMemo(() => {
    if (form.source === 'private') return selectedCustomer?.name ?? (customerSearch || '—')
    if (form.source === 'contract') {
      const base = selectedContract?.name ?? '—'
      const clientName = form.contract_client_name.trim()
        || availableContractClients.find((c) => c.id === form.contract_client_id)?.name
      return clientName ? `${base} → ${clientName}` : base
    }
    return selectedSub?.name ?? '—'
  }, [form.source, selectedCustomer, customerSearch, selectedContract, availableContractClients, form.contract_client_id, form.contract_client_name, selectedSub])

  // ── Real-time summary ──────────────────────────────────────────────────────
  const selectedPrivateRateInput = useMemo<PrivateRateInput | null>(() => {
    if (form.source !== 'private') return null
    // Net worked hours from actual times (15-min rounding, same as _billingWorkedHrs)
    const workedHrs = (() => {
      if (!form.actual_start_time || !form.actual_finish_time) return null
      const [sh, sm] = form.actual_start_time.split(':').map(Number)
      const [eh, em] = form.actual_finish_time.split(':').map(Number)
      const rawMins = (eh * 60 + em) - (sh * 60 + sm) - (parseFloat(form.break_minutes) || 0)
      if (rawMins <= 0) return null
      return Math.ceil(rawMins / 15) * 15 / 60
    })()
    // Client COF: either same as crew (checkbox off) or custom value (checkbox on)
    const effectiveClientCof = form.client_cof_override
      ? (parseFloat(form.client_cof_hours) || 0)
      : (parseFloat(form.cof_final) || 0)
    // Total billed = max(2, worked) + client COF surcharge
    const cofHours = workedHrs !== null
      ? Math.max(2, workedHrs) + effectiveClientCof
      : effectiveClientCof
    if (form.private_rate_custom) {
      const price = parseFloat(form.private_rate_custom_price)
      if (!price) return null
      return { rate_per_hour: price, cofHours }
    }
    const rate = privateRates.find((r) => r.id === form.private_rate_id)
    if (!rate) return null
    return { rate_per_hour: rate.rate_per_hour, cofHours }
  }, [form.source, form.private_rate_custom, form.private_rate_custom_price, form.private_rate_id, form.cof_final, form.cof, form.client_cof_override, form.client_cof_hours, form.actual_start_time, form.actual_finish_time, form.break_minutes, privateRates])

  const summary = useMemo<JobSummary | null>(() => {
    if (form.source === 'subcontract' && !selectedSub) return null
    if (form.source === 'private' && !selectedPrivateRateInput) return null
    if (form.source === 'contract' && !selectedEntity) return null

    const extraMenForBilling = extraMen
      .filter((r) => r.name.trim() && r.start_time.length === 5 && r.finish_time.length === 5)
      .map((r) => {
        const match = resolveExtraMan(r.name)
        return {
          employee_id: match?.id ?? '',
          hours: Math.max(0, calcCrewHours(r.start_time, r.finish_time)),
          hourly_rate: parseFloat(r.rate_per_hour) || match?.rate,
          employee_name: r.name.trim(),
          cof_share: r.cof_share,
          client_charge: parseFloat(r.client_charge) || 0,
          client_rate_per_hour: parseFloat(r.client_rate_per_hour) || 0,
        }
      })
      .filter((r) => r.hours > 0)
    const extraMenTotalHours = extraMenForBilling.reduce((s, r) => s + r.hours, 0)

    const _billingWorkedHrs = (() => {
      if (!form.actual_start_time || !form.actual_finish_time) return null
      const [sh, sm] = form.actual_start_time.split(':').map(Number)
      const [eh, em] = form.actual_finish_time.split(':').map(Number)
      const rawMins = (eh * 60 + em) - (sh * 60 + sm) - (parseFloat(form.break_minutes) || 0)
      if (rawMins <= 0) return null
      return Math.ceil(rawMins / 15) * 15 / 60
    })()
    // Client COF: what gets billed to the client for the Call Out Fee portion
    const effectiveClientCof = form.client_cof_override
      ? (parseFloat(form.client_cof_hours) || 0)
      : (parseFloat(form.cof_final) || 0)

    const selectedSubRatePH = form.source === 'subcontract' && selectedSub?.billing_type === 'ratecard'
      ? ((selectedSub.config as RateCardConfig).rateList?.find((r) => r.id === form.subcontractor_rate_id)?.rate_per_hour ?? null)
      : null
    const selectedContractRatePH = form.source === 'contract'
      ? (form.contract_rate_custom && parseFloat(form.contract_rate_custom_price) > 0
          ? parseFloat(form.contract_rate_custom_price)
          : (contractRates.find((r) => r.id === form.contract_rate_id)?.rate_per_hour ?? null))
      : null

    const jobData = {
      cof: (() => {
        // For ratecard subs and contract+rate jobs: billing.ts formula is ratePerHour × (cofHours - breakHours).
        // cof_final is set to null below so billing uses `cof` as the fallback.
        // We set cof = gross(max(2, workedHrs) + break + clientCof) so cofHours - break = max(2, workedHrs) + clientCof.
        if (form.source === 'subcontract' && selectedSub?.billing_type === 'ratecard' && _billingWorkedHrs !== null) {
          return Math.max(2, _billingWorkedHrs) + (parseFloat(form.break_minutes) || 0) / 60 + effectiveClientCof
        }
        if (form.source === 'contract' && selectedContractRatePH !== null && _billingWorkedHrs !== null) {
          return Math.max(2, _billingWorkedHrs) + (parseFloat(form.break_minutes) || 0) / 60 + effectiveClientCof
        }
        return parseFloat(form.cof) || null
      })(),
      // For ratecard subs and contract+rate jobs: null forces billing.ts to fall back to `cof` (set above),
      // preventing cof_final (crew-only surcharge) from overriding the revenue calculation.
      cof_final: (
          (form.source === 'subcontract' && selectedSub?.billing_type === 'ratecard') ||
          (form.source === 'contract' && selectedContractRatePH !== null && _billingWorkedHrs !== null)
        )
        ? null
        : (form.cof_final.trim() ? parseFloat(form.cof_final) : null),
      additional_hours: parseFloat(form.additional_hours) || null,
      additional_rate: parseFloat(form.additional_rate) || null,
      rate_card_key: form.rate_card_key || null,
      formula_vars: Object.fromEntries(Object.entries(form.formula_vars).map(([k, v]) => [k, parseFloat(v) || 0])),
      extra_men_hours: extraMenTotalHours > 0 ? extraMenTotalHours : (parseFloat(form.extra_men_hours) || 0),
      break_minutes: parseFloat(form.break_minutes) || 0,
      discount: parseFloat(form.discount) || 0,
      deposit: parseFloat(form.deposit) || 0,
      heavy_item_charge: parseFloat(form.heavy_item_charge) || 0,
      source: form.source,
      client_billing_config: overrideOpen ? buildOverrideConfig(overrideBilling) as unknown as SubcontractorConfig : null,
      google_review: form.google_review,
      google_review_employee_ids: form.google_review_employee_ids,
      override_revenue: malibuRevenue ?? null,
    }
    const cofFinalHrs = form.cof_final.trim() ? (parseFloat(form.cof_final) || null) : null
    const crewData = crew.filter((r) => r.employee_id).map((r) => {
      let hours: number
      if (crewHasTime(r)) {
        const raw = Math.max(0, calcCrewHours(r.start_time, r.end_time))
        hours = raw > 0 ? Math.max(2, raw) : 0
      } else if (_billingWorkedHrs !== null) {
        hours = _billingWorkedHrs
      } else {
        hours = parseFloat(r.hours) || 0
      }
      return {
        employee_id: r.employee_id,
        hours,
        cof_share: r.cof_share,
        cof_hours: r.cof_share ? (cofFinalHrs ?? 0) : 0,
        heavy_item: r.heavy_item,
      }
    })
    const matsData = materials.map((m) => ({
      quantity: parseFloat(m.quantity) || 0,
      cost_price: parseFloat(m.cost_price) || 0,
      sale_price: parseFloat(m.sale_price) || 0,
    }))
    const casualCrewForBilling = casualCrew
      .filter((r) => r.name.trim())
      .map((r) => {
        const hasTime = r.start_time.length === 5 && r.finish_time.length === 5
        let hours: number
        if (hasTime) {
          const rawHours = Math.max(0, calcCrewHours(r.start_time, r.finish_time))
          hours = (rawHours > 0 ? Math.max(2, rawHours) : 0) + (r.cof_share ? (cofFinalHrs ?? 0) : 0)
        } else if (_billingWorkedHrs !== null) {
          hours = Math.max(2, _billingWorkedHrs) + (r.cof_share ? (cofFinalHrs ?? 0) : 0)
        } else {
          hours = r.cof_share ? (cofFinalHrs ?? 0) : 0
        }
        const cw = casualWorkers.find((c) => c.name.toLowerCase() === r.name.trim().toLowerCase())
        return { name: r.name, rate_per_hour: parseFloat(r.rate_per_hour) || 0, hours, heavy_item: r.heavy_item, casual_worker_id: cw?.id }
      })
      .filter((r) => r.hours > 0 && r.rate_per_hour > 0)

    const commissionsForBilling = commissions
      .filter((r) => (r.employee_id || r.casual_worker_id) && (parseFloat(r.hours) || 0) > 0 && (parseFloat(r.rate_per_hour) || 0) > 0)
      .map((r) => {
        const type = commissionTypes.find((t) => t.id === r.commission_type_id)
        const casualWorker = r.casual_worker_id ? casualWorkers.find((cw) => cw.id === r.casual_worker_id) : null
        return {
          employee_id: r.employee_id || null,
          casual_worker_id: r.casual_worker_id || null,
          casual_worker_name: casualWorker?.name,
          rate_per_hour: parseFloat(r.rate_per_hour) || 0,
          hours: parseFloat(r.hours) || 0,
          label: type ? `Commission: ${type.name}` : 'Commission',
        }
      })

    const expensesForBilling = expenses.map((e) => ({
      amount: parseFloat(e.amount) || 0,
      is_client_expense: e.is_client_expense,
    }))

    // Rate Changes — a job whose crew/truck size changed mid-day bills each
    // segment at its own rate instead of one flat rate for the whole job.
    // Only used when the user has actually added segments; otherwise billing
    // falls back to the single flat rate exactly as before.
    const rateBlocksForBilling = rateBlocks
      .filter((b) => (parseFloat(b.rate_per_hour) || 0) > 0 && b.start_time.length === 5 && b.finish_time.length === 5)
      .map((b) => ({ rate_per_hour: parseFloat(b.rate_per_hour) || 0, hours: Math.max(0, calcCrewHours(b.start_time, b.finish_time)) }))
    const rateBlocksInput = (form.source === 'private' || form.source === 'contract') && rateBlocksForBilling.length > 0
      ? { blocks: rateBlocksForBilling, cofHours: effectiveClientCof }
      : null

    return calculateJobSummary(
      jobData,
      form.source === 'subcontract' ? selectedSub : null,
      crewData,
      matsData,
      employees,
      form.source !== 'subcontract' && form.source !== 'private' ? selectedEntity : null,
      form.source === 'private' ? selectedPrivateRateInput : null,
      { subcontractorRatePerHour: selectedSubRatePH, contractRatePerHour: selectedContractRatePH },
      extraMenForBilling,
      casualCrewForBilling,
      commissionsForBilling,
      expensesForBilling,
      rateBlocksInput
    )
  }, [form, crew, extraMen, casualCrew, commissions, commissionTypes, materials, expenses, selectedSub, selectedEntity, selectedPrivateRateInput, employees, casualWorkers, overrideOpen, overrideBilling, subRates, contractRates, rateBlocks])

  // ── Worked hours from actual times (rounded to nearest 15 min) ──────────
  const workedHoursCalc = useMemo<number | null>(() => {
    if (!form.actual_start_time || !form.actual_finish_time) return null
    const [sh, sm] = form.actual_start_time.split(':').map(Number)
    const [eh, em] = form.actual_finish_time.split(':').map(Number)
    const totalMins = (eh * 60 + em) - (sh * 60 + sm)
    if (totalMins <= 0) return null
    const breakMins = parseFloat(form.break_minutes) || 0
    const rawMins = totalMins - breakMins
    if (rawMins <= 0) return null
    return Math.ceil(rawMins / 15) * 15 / 60
  }, [form.actual_start_time, form.actual_finish_time, form.break_minutes])

  // ── Field helpers ──────────────────────────────────────────────────────────
  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSourceChange(src: JobSource) {
    setForm((f) => ({
      ...f,
      source: src,
      subcontractor_id: src === 'subcontract' ? f.subcontractor_id : '',
      customer_id: src === 'private' ? f.customer_id : '',
      contract_id: src === 'contract' ? f.contract_id : '',
      contract_client_id: src === 'contract' ? f.contract_client_id : '',
      contract_rate_id: '',
      contract_rate_custom: false,
      contract_rate_custom_price: '',
      contract_client_name: '',
      formula_vars: {},
      rate_card_key: '',
      subcontractor_rate_id: '',
      ...(src !== 'private' ? {
        private_rate_id: '',
        private_rate_custom: false,
        private_rate_custom_desc: '',
        private_rate_custom_price: '',
      } : {}),
    }))
    if (src !== 'private') setCustomerSearch('')
    setOverrideOpen(false)
    setOverrideBilling(emptyOverrideBilling())
  }

  function handleSubChange(subId: string) {
    const sub = subs.find((s) => s.id === subId)
    if (!sub) { setField('subcontractor_id', subId); return }
    let fvars: Record<string, string> = {}
    if (sub.billing_type === 'formula') {
      const { expression, defaults } = sub.config as FormulaConfig
      const keys = extractFormulaVars(expression)
      fvars = Object.fromEntries(keys.map((k) => [k, String(defaults[k] ?? '')]))
    }
    setForm((f) => ({ ...f, subcontractor_id: subId, formula_vars: fvars, rate_card_key: '', subcontractor_rate_id: '', cof: '', additional_hours: '', additional_rate: '' }))
  }

  function handleContractChange(contractId: string) {
    const contract = contracts.find((c) => c.id === contractId)
    let fvars: Record<string, string> = {}
    if (contract?.billing_type === 'formula') {
      const { expression, defaults } = contract.billing_config as FormulaConfig
      const keys = extractFormulaVars(expression)
      fvars = Object.fromEntries(keys.map((k) => [k, String(defaults[k] ?? '')]))
    }
    setForm((f) => ({ ...f, contract_id: contractId, contract_client_id: '', contract_rate_id: '', contract_rate_custom: false, contract_rate_custom_price: '', contract_client_name: '', formula_vars: fvars, rate_card_key: '' }))
  }

  // ── Crew helpers ───────────────────────────────────────────────────────────
  function addCrew() { setCrew((c) => [...c, { _id: crypto.randomUUID(), employee_id: '', hours: '', start_time: '', end_time: '', cof_share: false, cof_hours: '0.5', heavy_item: false }]) }
  function updateCrew(_id: string, field: keyof Omit<CrewRow, '_id'>, value: string | boolean) {
    setCrew((c) => c.map((r) => {
      if (r._id !== _id) return r
      const updated = { ...r, [field]: value }
      if (field === 'cof_share' && value === true && (!r.cof_hours || r.cof_hours === '0')) {
        updated.cof_hours = '0.5'
      }
      return updated
    }))
  }
  function removeCrew(_id: string) { setCrew((c) => c.filter((r) => r._id !== _id)) }

  // ── Extra address helpers (informational-only extra pickup/dropoff stops) ──
  function addExtraAddress(address_type: 'pickup' | 'dropoff') {
    setExtraAddresses((rows) => [...rows, { _id: crypto.randomUUID(), address_type, address: '' }])
  }
  function updateExtraAddress(_id: string, value: string) {
    setExtraAddresses((rows) => rows.map((r) => r._id === _id ? { ...r, address: value } : r))
  }
  function removeExtraAddress(_id: string) {
    setExtraAddresses((rows) => rows.filter((r) => r._id !== _id))
  }

  // ── Extra men helpers ──────────────────────────────────────────────────────
  function addExtraMan() {
    setExtraMan((em) => [...em, { _id: crypto.randomUUID(), name: '', rate_per_hour: '', start_time: '', finish_time: '', cof_share: false, client_charge: '', client_rate_per_hour: '' }])
  }
  function updateExtraMan(_id: string, field: 'name' | 'rate_per_hour' | 'start_time' | 'finish_time' | 'client_charge' | 'client_rate_per_hour', value: string): void
  function updateExtraMan(_id: string, field: 'cof_share', value: boolean): void
  function updateExtraMan(_id: string, field: 'name' | 'rate_per_hour' | 'start_time' | 'finish_time' | 'client_charge' | 'client_rate_per_hour' | 'cof_share', value: string | boolean) {
    setExtraMan((em) => em.map((r) => r._id === _id ? { ...r, [field]: value } : r))
  }
  function removeExtraMan(_id: string) {
    setExtraMan((em) => em.filter((r) => r._id !== _id))
  }
  // Resolves a free-text Extra Man name to a staff or casual-worker id/rate,
  // mirroring how Casual Crew rows are matched. Staff takes precedence.
  function resolveExtraMan(name: string): { id: string; rate: number; isCasual: boolean } | null {
    const trimmed = name.trim()
    if (!trimmed) return null
    const staffEmp = employees.find((e) => e.name.toLowerCase() === trimmed.toLowerCase())
    if (staffEmp) return { id: staffEmp.id, rate: staffEmp.hourly_rate, isCasual: false }
    const cw = casualWorkers.find((c) => c.name.toLowerCase() === trimmed.toLowerCase())
    if (cw) return { id: cw.id, rate: cw.rate_per_hour, isCasual: true }
    return null
  }

  // ── Material helpers ───────────────────────────────────────────────────────
  function addMaterial() {
    setMaterials((m) => [...m, { _id: crypto.randomUUID(), material_name: '', quantity: '1', cost_price: '0', sale_price: '0' }])
  }
  function addMaterialFromCatalog(item: MaterialCatalog | null) {
    setMaterials((m) => [...m, {
      _id: crypto.randomUUID(),
      material_name: item?.name ?? '',
      quantity: '1',
      cost_price: item != null ? String(item.cost_price) : '0',
      sale_price: item != null ? String(item.sale_price) : '0',
    }])
    setShowCatalogDrop(false)
  }
  function updateMaterial(_id: string, field: keyof Omit<MaterialRow, '_id'>, value: string) {
    setMaterials((m) => m.map((r) => (r._id === _id ? { ...r, [field]: value } : r)))
  }
  function removeMaterial(_id: string) { setMaterials((m) => m.filter((r) => r._id !== _id)) }

  // ── Casual crew helpers ────────────────────────────────────────────────────
  function addCasualCrew() {
    setCasualCrew((c) => [...c, { _id: crypto.randomUUID(), name: '', rate_per_hour: '0', start_time: '', finish_time: '', cof_share: false, heavy_item: false }])
  }
  function updateCasualCrew(_id: string, field: keyof Omit<CasualCrewRow, '_id' | 'dbId'>, value: string | boolean) {
    setCasualCrew((c) => c.map((r) => r._id === _id ? { ...r, [field]: value } : r))
  }
  function removeCasualCrew(_id: string) { setCasualCrew((c) => c.filter((r) => r._id !== _id)) }

  // ── Commission helpers ─────────────────────────────────────────────────────
  function addCommission() {
    setCommissions((c) => [...c, { _id: crypto.randomUUID(), commission_type_id: '', employee_id: '', casual_worker_id: '', rate_per_hour: '', hours: '' }])
  }
  function updateCommission(_id: string, field: keyof Omit<CommissionRow, '_id' | 'dbId'>, value: string) {
    setCommissions((c) => c.map((r) => {
      if (r._id !== _id) return r
      const updated = { ...r, [field]: value }
      if (field === 'commission_type_id' && value) {
        const type = commissionTypes.find((t) => t.id === value)
        if (type) updated.rate_per_hour = type.rate_per_hour.toString()
      }
      return updated
    }))
  }
  function removeCommission(_id: string) { setCommissions((c) => c.filter((r) => r._id !== _id)) }

  // ── Expense helpers ────────────────────────────────────────────────────────
  function addExpense() {
    setExpenses((e) => [...e, { _id: crypto.randomUUID(), dbId: null, description: '', amount: '', is_client_expense: true }])
  }
  function updateExpense(_id: string, field: 'description' | 'amount' | 'is_client_expense', value: string | boolean) {
    setExpenses((e) => e.map((r) => r._id === _id ? { ...r, [field]: value } : r))
  }
  function removeExpense(_id: string) { setExpenses((e) => e.filter((r) => r._id !== _id)) }

  // ── Employee reimbursement helpers ──────────────────────────────────────────
  function addEmployeeExpense() {
    setEmployeeExpenses((e) => [...e, { _id: crypto.randomUUID(), dbId: null, employee_id: '', casual_worker_id: '', description: '', amount: '' }])
  }
  function updateEmployeeExpense(_id: string, field: 'employee_id' | 'casual_worker_id' | 'description' | 'amount', value: string) {
    setEmployeeExpenses((e) => e.map((r) => r._id === _id ? { ...r, [field]: value } : r))
  }
  function removeEmployeeExpense(_id: string) { setEmployeeExpenses((e) => e.filter((r) => r._id !== _id)) }

  // ── Photo helpers ──────────────────────────────────────────────────────────
  // Core single-file upload — does not touch the shared uploading/caption
  // state, so it can be called in a loop by uploadPhotos below without each
  // iteration stomping on the others' loading indicator.
  async function uploadOnePhoto(file: File, category: string, caption: string) {
    const ts = Date.now()
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const folder = isEdit && jobId ? jobId : pendingJobId.current
    const path = `jobs/${folder}/${ts}-${safeName}`
    const { error: upErr } = await supabase.storage.from('job-photos').upload(path, file)
    if (upErr) throw upErr
    const { data: urlData } = supabase.storage.from('job-photos').getPublicUrl(path)
    const publicUrl = urlData.publicUrl
    if (isEdit && jobId) {
      const { data, error: insertErr } = await supabase
        .from('job_photos')
        .insert({ job_id: jobId, url: publicUrl, caption: caption || null, category })
        .select()
        .single()
      if (insertErr) throw insertErr
      // Always update state regardless of whether data returned non-null
      const p = data as { id: string; url: string; caption: string | null; category: string } | null
      setPhotos((prev) => [...prev, {
        _id: p?.id ?? crypto.randomUUID(),
        dbId: p?.id,
        url: publicUrl,
        caption,
        storagePath: path,
        category,
      }])
    } else {
      setPhotos((prev) => [...prev, { _id: crypto.randomUUID(), url: publicUrl, caption, storagePath: path, category }])
    }
  }

  async function uploadPhoto(file: File, category = photoCategory) {
    setUploadingPhoto(true)
    setUploadError('')
    try {
      await uploadOnePhoto(file, category, photoCaption.trim())
      setPhotoCaption('')
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploadingPhoto(false)
    }
  }

  // Uploads a batch of files one after another (sequential — Supabase Storage
  // doesn't benefit from parallel uploads here and it keeps error reporting
  // simple). The caption field only applies when a single file is selected;
  // for a multi-file selection, applying one caption to every file wouldn't
  // make sense, so those are saved without a caption.
  async function uploadPhotos(files: FileList | File[], category = photoCategory) {
    const list = Array.from(files)
    if (list.length === 0) return
    setUploadingPhoto(true)
    setUploadError('')
    const caption = list.length === 1 ? photoCaption.trim() : ''
    const failed: string[] = []
    for (const file of list) {
      try {
        await uploadOnePhoto(file, category, caption)
      } catch {
        failed.push(file.name)
      }
    }
    if (failed.length > 0) setUploadError(`Failed to upload: ${failed.join(', ')}`)
    setPhotoCaption('')
    setUploadingPhoto(false)
  }

  async function removePhoto(_id: string) {
    const photo = photos.find((p) => p._id === _id)
    if (photo?.dbId) {
      await supabase.from('job_photos').delete().eq('id', photo.dbId)
    }
    if (photo?.storagePath) {
      await supabase.storage.from('job-photos').remove([photo.storagePath])
    }
    setPhotos((prev) => prev.filter((p) => p._id !== _id))
  }

  // ── Override billing helpers ───────────────────────────────────────────────
  function setOB<K extends keyof OverrideBilling>(key: K, val: OverrideBilling[K]) {
    setOverrideBilling((f) => ({ ...f, [key]: val }))
  }
  function updateOBRateEntry(i: number, col: 0 | 1, val: string) {
    setOverrideBilling((f) => {
      const next = f.rateEntries.map((e, j) =>
        j === i ? ([col === 0 ? val : e[0], col === 1 ? val : e[1]] as [string, string]) : e
      )
      return { ...f, rateEntries: next }
    })
  }

  // ── Core save logic ────────────────────────────────────────────────────────
  async function performSave(statusOverride?: JobStatus) {
    if (!form.job_number.trim()) throw new Error('Job number is required')
    if (!form.date) throw new Error('Date is required')
    if (form.source === 'subcontract' && !form.subcontractor_id) throw new Error('Subcontractor is required')
    if (form.source === 'private' && !form.customer_id && !customerSearch.trim()) throw new Error('Customer is required')
    if (form.source === 'contract' && !form.contract_id) throw new Error('Contract is required')

    // Create customer on the fly for private source
    let resolvedCustomerId = form.customer_id
    if (form.source === 'private' && !resolvedCustomerId && customerSearch.trim()) {
      const { data: newCust, error: custErr } = await supabase
        .from('customers')
        .insert({
          name: customerSearch.trim(),
          contact_info: null,
          phone: null,
          secondary_contact_name: null,
          secondary_contact_phone: null,
          default_addresses: null,
          notes: null,
          billing_type: null,
          billing_config: null,
          google_review_bonus: false,
        })
        .select('id')
        .single()
      if (custErr) throw custErr
      resolvedCustomerId = (newCust as { id: string }).id
      setForm((f) => ({ ...f, customer_id: resolvedCustomerId }))
    }

    const clientBillingConfig = overrideOpen ? buildOverrideConfig(overrideBilling) : null

    const extraMenRows = extraMen.filter((r) => r.name.trim() && r.start_time && r.finish_time)
    // Rows persisted to job_extra_men must NOT require start/finish time —
    // otherwise an extra man added with just a name/rate (times filled in later,
    // or never) is silently dropped from the DB on every save, since the delete+
    // reinsert below only recreates rows from this array. Hours/revenue math
    // still legitimately depends on times (extraMenRows above), but persistence
    // must not.
    const extraMenPersistRows = extraMen.filter((r) => r.name.trim())
    const computedExtraMenHours = extraMenRows.reduce((s, r) => {
      const h = calcCrewHours(r.start_time, r.finish_time)
      return s + (h > 0 ? h : 0)
    }, 0)

    const cofFinalVal = form.cof_final.trim() ? (parseFloat(form.cof_final) || null) : null

    const workedHrsForSave = (() => {
      if (!form.actual_start_time || !form.actual_finish_time) return null
      const [sh, sm] = form.actual_start_time.split(':').map(Number)
      const [eh, em] = form.actual_finish_time.split(':').map(Number)
      const rawMins = (eh * 60 + em) - (sh * 60 + sm) - (parseFloat(form.break_minutes) || 0)
      if (rawMins <= 0) return null
      return Math.ceil(rawMins / 15) * 15 / 60
    })()

    const isPercentSub = form.source === 'subcontract' && selectedSub?.billing_type === 'percent'
    const isRatecardSub = form.source === 'subcontract' && selectedSub?.billing_type === 'ratecard'
    const computedMalibuRevenue = isPercentSub && form.gross_job_value
      ? (parseFloat(form.gross_job_value) || 0) * (selectedSub!.config as PercentConfig).percent
      : null

    // Revenue for private jobs: rate × (max(2, workedHrs) + effectiveClientCof)
    const saveEffectiveClientCof = form.client_cof_override
      ? (parseFloat(form.client_cof_hours) || 0)
      : (parseFloat(form.cof_final) || 0)
    const computedPrivateRevenue = (() => {
      if (form.source !== 'private') return null
      const ratePerHour = form.private_rate_custom
        ? (parseFloat(form.private_rate_custom_price) || null)
        : (privateRates.find((r) => r.id === form.private_rate_id)?.rate_per_hour ?? null)
      if (!ratePerHour) return null
      const totalHours = workedHrsForSave !== null
        ? Math.max(2, workedHrsForSave) + saveEffectiveClientCof
        : saveEffectiveClientCof
      if (!totalHours) return null
      return ratePerHour * totalHours
    })()

    // Revenue for ratecard subs with rateList (rate_per_hour × hours).
    // Flat-rate jobs (rates[key]) are correctly calculated on-the-fly by the dashboard
    // via applyBillingConfig, so only rateList jobs need to be persisted here.
    const computedRatecardRevenue = (() => {
      if (!isRatecardSub || !selectedSub || workedHrsForSave === null) return null
      const ratePerHour = (selectedSub.config as RateCardConfig).rateList?.find(
        (r) => r.id === form.subcontractor_rate_id
      )?.rate_per_hour ?? null
      if (!ratePerHour) return null
      const additionalHrs = parseFloat(form.additional_hours) || 0
      const extraMenRevenue = computedExtraMenHours * (parseFloat(form.additional_rate) || 0)
      return ratePerHour * (Math.max(2, workedHrsForSave) + saveEffectiveClientCof + additionalHrs) + extraMenRevenue
    })()

    // Revenue for contract jobs with a rate selected: rate_per_hour × (max(2, workedHrs) + clientCof)
    const computedContractRevenue = (() => {
      if (form.source !== 'contract' || workedHrsForSave === null) return null
      const ratePerHour = form.contract_rate_custom && parseFloat(form.contract_rate_custom_price) > 0
        ? parseFloat(form.contract_rate_custom_price)
        : (contractRates.find((r) => r.id === form.contract_rate_id)?.rate_per_hour ?? null)
      if (!ratePerHour) return null
      const additionalHrs = parseFloat(form.additional_hours) || 0
      const extraMenRevenue = computedExtraMenHours * (parseFloat(form.additional_rate) || 0)
      return ratePerHour * (Math.max(2, workedHrsForSave) + saveEffectiveClientCof + additionalHrs) + extraMenRevenue
    })()

    // Rate Changes — when the crew/truck size changed mid-day, the job was
    // billed as several segments at different rates instead of one flat rate
    // for the whole job. Takes priority over the single flat-rate calc above.
    const rateBlocksPersistRows = rateBlocks.filter((b) => (parseFloat(b.rate_per_hour) || 0) > 0 && b.start_time.length === 5 && b.finish_time.length === 5)
    const computedRateBlocksRevenue = (form.source === 'private' || form.source === 'contract') && rateBlocksPersistRows.length > 0
      ? rateBlocksPersistRows.reduce((s, b) => s + Math.max(0, calcCrewHours(b.start_time, b.finish_time)) * (parseFloat(b.rate_per_hour) || 0), 0)
        + saveEffectiveClientCof * (parseFloat(rateBlocksPersistRows[rateBlocksPersistRows.length - 1].rate_per_hour) || 0)
      : null

    const payload = {
      job_number: form.job_number.trim(),
      date: form.date,
      status: statusOverride ?? form.status,
      source: form.source,
      subcontractor_id: form.source === 'subcontract' ? (form.subcontractor_id || null) : null,
      customer_id: form.source === 'private' ? (resolvedCustomerId || null) : (form.customer_id || null),
      contract_id: form.source === 'contract' ? (form.contract_id || null) : null,
      contract_client_id: null,
      contract_client_name: form.source === 'contract' ? (form.contract_client_name.trim() || null) : null,
      client_billing_config: clientBillingConfig,
      pickup_address: form.pickup_address.trim() || null,
      delivery_address: form.delivery_address.trim() || null,
      cof: parseFloat(form.cof) || null,
      cof_final: form.cof_final.trim() ? parseFloat(form.cof_final) : null,
      additional_hours: parseFloat(form.additional_hours) || null,
      additional_rate: parseFloat(form.additional_rate) || null,
      rate_card_key: form.rate_card_key || null,
      formula_vars: Object.keys(form.formula_vars).length
        ? Object.fromEntries(Object.entries(form.formula_vars).map(([k, v]) => [k, parseFloat(v) || 0]))
        : null,
      extra_men_hours: computedExtraMenHours > 0 ? computedExtraMenHours : (parseFloat(form.extra_men_hours) || 0),
      extra_man_employee_id: form.extra_man_employee_id || null,
      break_minutes: parseFloat(form.break_minutes) || 0,
      discount: parseFloat(form.discount) || 0,
      deposit: parseFloat(form.deposit) || null,
      heavy_item_charge: parseFloat(form.heavy_item_charge) || null,
      notes: form.notes.trim() || null,
      completion_notes: form.completion_notes.trim() || null,
      actual_start_time: form.actual_start_time || null,
      actual_finish_time: form.actual_finish_time || null,
      scheduled_time: form.scheduled_time || null,
      scheduled_finish_time: form.scheduled_finish_time || null,
      reference_number: form.reference_number.trim() || null,
      private_rate_id: form.source === 'private' && !form.private_rate_custom ? (form.private_rate_id || null) : null,
      private_rate_custom: form.source === 'private' ? form.private_rate_custom : false,
      private_rate_custom_desc: form.source === 'private' && form.private_rate_custom ? (form.private_rate_custom_desc.trim() || null) : null,
      private_rate_custom_price: form.source === 'private' && form.private_rate_custom ? (parseFloat(form.private_rate_custom_price) || null) : null,
      google_review: form.google_review,
      google_review_employee_ids: form.google_review_employee_ids,
      payment_date: form.payment_date || null,
      payment_methods: form.payment_methods,
      payment_cash_amount: parseFloat(form.payment_cash_amount) || 0,
      payment_transfer_amount: parseFloat(form.payment_transfer_amount) || 0,
      payment_card_amount: parseFloat(form.payment_card_amount) || 0,
      payment_collected_by: form.payment_collected_by || null,
      cancellation_reason: form.cancellation_reason || null,
      minimum_charge_applied: form.minimum_charge_applied,
      minimum_charge_amount: parseFloat(form.minimum_charge_amount) || 0,
      subcontractor_service_type: form.source === 'subcontract' ? (form.subcontractor_service_type.trim() || null) : null,
      subcontractor_trucks: form.source === 'subcontract' ? (form.subcontractor_trucks.trim() || null) : null,
      subcontractor_crew_size: form.source === 'subcontract' ? (parseInt(form.subcontractor_crew_size) || null) : null,
      subcontractor_rate_id: form.source === 'subcontract' ? (form.subcontractor_rate_id || null) : null,
      contract_rate_id: form.source === 'contract' && !form.contract_rate_custom ? (form.contract_rate_id || null) : null,
      contract_rate_custom_price: form.source === 'contract' && form.contract_rate_custom ? (parseFloat(form.contract_rate_custom_price) || null) : null,
      contractor_job_id: form.source === 'subcontract' ? (form.contractor_job_id.trim() || null) : null,
      gross_job_value: isPercentSub ? (parseFloat(form.gross_job_value) || null) : null,
      malibu_revenue: computedMalibuRevenue ?? computedRateBlocksRevenue ?? computedPrivateRevenue ?? computedRatecardRevenue ?? computedContractRevenue ?? null,
      client_cof_override: form.client_cof_override,
      client_cof_hours: form.client_cof_override ? (parseFloat(form.client_cof_hours) || null) : null,
    }

    const crewRows = crew.filter((r) => r.employee_id).map((r) => {
      let hours: number
      if (crewHasTime(r)) {
        hours = calcCrewHours(r.start_time, r.end_time)
      } else if (workedHrsForSave !== null) {
        hours = Math.max(2, workedHrsForSave) + (r.cof_share ? (cofFinalVal ?? 0) : 0)
      } else {
        hours = r.cof_share ? (cofFinalVal ?? (parseFloat(r.hours) || 0)) : (parseFloat(r.hours) || 0)
      }
      return {
        employee_id: r.employee_id,
        hours,
        cof_share: r.cof_share,
        cof_hours: 0,
        heavy_item: r.heavy_item,
        role: null,
        start_time: r.start_time || null,
        end_time: r.end_time || null,
      }
    })
    const matRows = materials.filter((m) => m.material_name.trim()).map((m) => ({
      material_name: m.material_name.trim(),
      quantity: parseFloat(m.quantity) || 1,
      cost_price: parseFloat(m.cost_price) || 0,
      sale_price: parseFloat(m.sale_price) || 0,
    }))

    const truckPersistRows = jobTruckRows.filter((r) => r.fleet_id)

    if (isEdit && jobId) {
      const { error: updErr } = await supabase.from('jobs').update(payload).eq('id', jobId)
      if (updErr) throw updErr
      await Promise.all([
        supabase.from('job_crew').delete().eq('job_id', jobId),
        supabase.from('job_materials').delete().eq('job_id', jobId),
        supabase.from('job_trucks').delete().eq('job_id', jobId),
      ])
      if (crewRows.length) await supabase.from('job_crew').insert(crewRows.map((r) => ({ ...r, job_id: jobId })))
      if (matRows.length) await supabase.from('job_materials').insert(matRows.map((m) => ({ ...m, job_id: jobId })))
      if (truckPersistRows.length) await supabase.from('job_trucks').insert(truckPersistRows.map((r) => ({ job_id: jobId, fleet_id: r.fleet_id, client_charge_amount: parseFloat(r.client_charge) || 0 })))
      try {
        await supabase.from('job_extra_men').delete().eq('job_id', jobId)
        if (extraMenPersistRows.length) {
          await supabase.from('job_extra_men').insert(extraMenPersistRows.map((r) => {
            const match = resolveExtraMan(r.name)
            return {
              job_id: jobId,
              employee_id: match?.id ?? null,
              name: r.name.trim(),
              rate_per_hour: parseFloat(r.rate_per_hour) || match?.rate || 0,
              start_time: r.start_time || null,
              finish_time: r.finish_time || null,
              cof_share: r.cof_share,
              client_rate_per_hour: parseFloat(r.client_rate_per_hour) || 0,
              client_charge_amount: (() => {
                const rate = parseFloat(r.client_rate_per_hour) || 0
                if (rate > 0) return rate * Math.max(0, calcCrewHours(r.start_time, r.finish_time))
                return parseFloat(r.client_charge) || 0
              })(),
            }
          }))
        }
      } catch { /* migration not yet applied */ }
      try {
        await supabase.from('job_casual_crew').delete().eq('job_id', jobId)
        const ccRows = casualCrew.filter((r) => r.name.trim())
        if (ccRows.length) {
          await supabase.from('job_casual_crew').insert(ccRows.map((r) => {
            const hasTime = r.start_time.length === 5 && r.finish_time.length === 5
            let hours: number
            if (hasTime) {
              hours = Math.max(0, calcCrewHours(r.start_time, r.finish_time))
            } else if (workedHrsForSave !== null) {
              hours = Math.max(2, workedHrsForSave) + (r.cof_share ? (cofFinalVal ?? 0) : 0)
            } else {
              hours = r.cof_share ? (cofFinalVal ?? 0) : 0
            }
            // Persist the FK to casual_workers whenever the name matches a
            // registered casual — without this, review-bonus lookups downstream
            // (Dashboard/Invoices/Payroll) have no id to match against
            // google_review_employee_ids and silently never apply the bonus.
            const cw = casualWorkers.find((c) => c.name.toLowerCase() === r.name.trim().toLowerCase())
            return {
              job_id: jobId,
              name: r.name.trim(),
              rate_per_hour: parseFloat(r.rate_per_hour) || 0,
              start_time: r.start_time || null,
              finish_time: r.finish_time || null,
              cof_share: r.cof_share,
              heavy_item: r.heavy_item,
              hours,
              casual_worker_id: cw?.id ?? null,
            }
          }))
        }
      } catch { /* migration not yet applied */ }
      try {
        await supabase.from('job_commissions').delete().eq('job_id', jobId)
        const comRows = commissions.filter((r) => r.employee_id || r.casual_worker_id)
        if (comRows.length) {
          await supabase.from('job_commissions').insert(comRows.map((r) => ({
            job_id: jobId,
            commission_type_id: r.commission_type_id || null,
            employee_id: r.employee_id || null,
            casual_worker_id: r.casual_worker_id || null,
            rate_per_hour: parseFloat(r.rate_per_hour) || 0,
            hours: parseFloat(r.hours) || 0,
          })))
        }
      } catch { /* migration not yet applied */ }
      try {
        await supabase.from('job_expenses').delete().eq('job_id', jobId)
        const expRows = expenses.filter((r) => r.description.trim())
        if (expRows.length) {
          await supabase.from('job_expenses').insert(expRows.map((r) => ({
            job_id: jobId,
            description: r.description.trim(),
            amount: parseFloat(r.amount) || 0,
            is_client_expense: r.is_client_expense,
          })))
        }
      } catch { /* migration not yet applied */ }
      try {
        await supabase.from('job_employee_expenses').delete().eq('job_id', jobId)
        // Only require a person to be selected — never gate on the amount/
        // description fields being filled in yet (same lesson as Extra Men:
        // don't silently drop a row from the delete+reinsert just because an
        // optional field is still blank).
        const empExpRows = employeeExpenses.filter((r) => r.employee_id || r.casual_worker_id)
        if (empExpRows.length) {
          await supabase.from('job_employee_expenses').insert(empExpRows.map((r) => ({
            job_id: jobId,
            employee_id: r.employee_id || null,
            casual_worker_id: r.casual_worker_id || null,
            description: r.description.trim() || null,
            amount: parseFloat(r.amount) || 0,
          })))
        }
      } catch { /* migration not yet applied */ }
      try {
        await supabase.from('job_rate_blocks').delete().eq('job_id', jobId)
        if (rateBlocksPersistRows.length) {
          await supabase.from('job_rate_blocks').insert(rateBlocksPersistRows.map((r, i) => ({
            job_id: jobId,
            label: r.label.trim() || null,
            rate_per_hour: parseFloat(r.rate_per_hour) || 0,
            start_time: r.start_time || null,
            finish_time: r.finish_time || null,
            sort_order: i,
          })))
        }
      } catch { /* migration not yet applied */ }
      try {
        await supabase.from('job_addresses').delete().eq('job_id', jobId)
        const addrRows = extraAddresses.filter((r) => r.address.trim())
        if (addrRows.length) {
          await supabase.from('job_addresses').insert(addrRows.map((r, i) => ({
            job_id: jobId,
            address_type: r.address_type,
            address: r.address.trim(),
            sort_order: i,
          })))
        }
      } catch { /* migration not yet applied */ }
    } else {
      const { data: job, error: insErr } = await supabase.from('jobs').insert(payload).select().single()
      if (insErr || !job) throw insErr ?? new Error('Insert failed')
      const newId = (job as { id: string }).id
      if (crewRows.length) await supabase.from('job_crew').insert(crewRows.map((r) => ({ ...r, job_id: newId })))
      if (matRows.length) await supabase.from('job_materials').insert(matRows.map((m) => ({ ...m, job_id: newId })))
      if (truckPersistRows.length) await supabase.from('job_trucks').insert(truckPersistRows.map((r) => ({ job_id: newId, fleet_id: r.fleet_id, client_charge_amount: parseFloat(r.client_charge) || 0 })))
      if (photos.length) await supabase.from('job_photos').insert(photos.map((p) => ({ job_id: newId, url: p.url, caption: p.caption || null, category: p.category })))
      try {
        if (extraMenPersistRows.length) {
          await supabase.from('job_extra_men').insert(extraMenPersistRows.map((r) => {
            const match = resolveExtraMan(r.name)
            return {
              job_id: newId,
              employee_id: match?.id ?? null,
              name: r.name.trim(),
              rate_per_hour: parseFloat(r.rate_per_hour) || match?.rate || 0,
              start_time: r.start_time || null,
              finish_time: r.finish_time || null,
              cof_share: r.cof_share,
              client_rate_per_hour: parseFloat(r.client_rate_per_hour) || 0,
              client_charge_amount: (() => {
                const rate = parseFloat(r.client_rate_per_hour) || 0
                if (rate > 0) return rate * Math.max(0, calcCrewHours(r.start_time, r.finish_time))
                return parseFloat(r.client_charge) || 0
              })(),
            }
          }))
        }
      } catch { /* migration not yet applied */ }
      try {
        const ccRows = casualCrew.filter((r) => r.name.trim())
        if (ccRows.length) {
          await supabase.from('job_casual_crew').insert(ccRows.map((r) => {
            const hasTime = r.start_time.length === 5 && r.finish_time.length === 5
            let hours: number
            if (hasTime) {
              hours = Math.max(0, calcCrewHours(r.start_time, r.finish_time))
            } else if (workedHrsForSave !== null) {
              hours = Math.max(2, workedHrsForSave) + (r.cof_share ? (cofFinalVal ?? 0) : 0)
            } else {
              hours = r.cof_share ? (cofFinalVal ?? 0) : 0
            }
            const cw = casualWorkers.find((c) => c.name.toLowerCase() === r.name.trim().toLowerCase())
            return {
              job_id: newId,
              name: r.name.trim(),
              rate_per_hour: parseFloat(r.rate_per_hour) || 0,
              start_time: r.start_time || null,
              finish_time: r.finish_time || null,
              cof_share: r.cof_share,
              heavy_item: r.heavy_item,
              hours,
              casual_worker_id: cw?.id ?? null,
            }
          }))
        }
      } catch { /* migration not yet applied */ }
      try {
        const comRows = commissions.filter((r) => r.employee_id || r.casual_worker_id)
        if (comRows.length) {
          await supabase.from('job_commissions').insert(comRows.map((r) => ({
            job_id: newId,
            commission_type_id: r.commission_type_id || null,
            employee_id: r.employee_id || null,
            casual_worker_id: r.casual_worker_id || null,
            rate_per_hour: parseFloat(r.rate_per_hour) || 0,
            hours: parseFloat(r.hours) || 0,
          })))
        }
      } catch { /* migration not yet applied */ }
      try {
        const expRows = expenses.filter((r) => r.description.trim())
        if (expRows.length) {
          await supabase.from('job_expenses').insert(expRows.map((r) => ({
            job_id: newId,
            description: r.description.trim(),
            amount: parseFloat(r.amount) || 0,
            is_client_expense: r.is_client_expense,
          })))
        }
      } catch { /* migration not yet applied */ }
      try {
        const empExpRows = employeeExpenses.filter((r) => r.employee_id || r.casual_worker_id)
        if (empExpRows.length) {
          await supabase.from('job_employee_expenses').insert(empExpRows.map((r) => ({
            job_id: newId,
            employee_id: r.employee_id || null,
            casual_worker_id: r.casual_worker_id || null,
            description: r.description.trim() || null,
            amount: parseFloat(r.amount) || 0,
          })))
        }
      } catch { /* migration not yet applied */ }
      try {
        if (rateBlocksPersistRows.length) {
          await supabase.from('job_rate_blocks').insert(rateBlocksPersistRows.map((r, i) => ({
            job_id: newId,
            label: r.label.trim() || null,
            rate_per_hour: parseFloat(r.rate_per_hour) || 0,
            start_time: r.start_time || null,
            finish_time: r.finish_time || null,
            sort_order: i,
          })))
        }
      } catch { /* migration not yet applied */ }
      try {
        const addrRows = extraAddresses.filter((r) => r.address.trim())
        if (addrRows.length) {
          await supabase.from('job_addresses').insert(addrRows.map((r, i) => ({
            job_id: newId,
            address_type: r.address_type,
            address: r.address.trim(),
            sort_order: i,
          })))
        }
      } catch { /* migration not yet applied */ }
    }

    if (!isEdit) {
      router.push('/')
    } else if (statusOverride) {
      setForm((f) => ({ ...f, status: statusOverride }))
    }
  }

  function extractMsg(e: unknown, fallback: string): string {
    if (e instanceof Error) return e.message
    if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
    return fallback
  }

  async function confirmNewCasualWorker() {
    if (!pendingNewCasualWorker) return
    const { name, rate, thenSave } = pendingNewCasualWorker
    setPendingNewCasualWorker(null)
    const { data } = await supabase.from('casual_workers').insert({ name, rate_per_hour: rate }).select().single()
    if (data) {
      setCasualWorkers((prev) =>
        [...prev, data as CasualWorker].sort((a, b) => a.name.localeCompare(b.name))
      )
    }
    if (thenSave) handleSave()
  }

  function declineNewCasualWorker() {
    if (!pendingNewCasualWorker) return
    declinedCasualWorkerNamesRef.current.add(pendingNewCasualWorker.name.toLowerCase())
    const thenSave = pendingNewCasualWorker.thenSave
    setPendingNewCasualWorker(null)
    if (thenSave) handleSave()
  }

  async function handleSave() {
    const unregisteredCasual = casualCrew.find((r) => {
      const name = r.name.trim()
      return name &&
        !casualWorkers.some((cw) => cw.name.toLowerCase() === name.toLowerCase()) &&
        !declinedCasualWorkerNamesRef.current.has(name.toLowerCase())
    })
    const unregisteredExtraMan = !unregisteredCasual && extraMen.find((r) => {
      const name = r.name.trim()
      return name &&
        !employees.some((e) => e.name.toLowerCase() === name.toLowerCase()) &&
        !casualWorkers.some((cw) => cw.name.toLowerCase() === name.toLowerCase()) &&
        !declinedCasualWorkerNamesRef.current.has(name.toLowerCase())
    })
    const unregistered = unregisteredCasual || unregisteredExtraMan
    if (unregistered) {
      setPendingNewCasualWorker({
        rowId: unregistered._id,
        name: unregistered.name.trim(),
        rate: parseFloat(unregistered.rate_per_hour) || 0,
        thenSave: true,
      })
      return
    }
    setSaving(true)
    setError('')
    try { await performSave(); setIsViewMode(true) }
    catch (e) { setError(extractMsg(e, 'Failed to save job.')) }
    finally { setSaving(false) }
  }

  async function handleSaveWithStatus(s: JobStatus) {
    setSaving(true)
    setError('')
    try { await performSave(s); setIsViewMode(true) }
    catch (e) { setError(extractMsg(e, 'Failed to save job.')) }
    finally { setSaving(false) }
  }

  async function handleMarkReviewed() {
    setMarkingReviewed(true)
    setError('')
    try { await performSave('reviewed'); setIsViewMode(true) }
    catch (e) { setError(extractMsg(e, 'Failed to mark as reviewed.')) }
    finally { setMarkingReviewed(false) }
  }

  async function handleCancelJob() {
    setSaving(true)
    try { await performSave('cancelled') }
    catch (e) { setError(extractMsg(e, 'Failed to cancel job.')) }
    finally { setSaving(false); setCancelModalOpen(false) }
  }

  async function handleConfirmPayment() {
    setSaving(true)
    setError('')
    try { await performSave('paid') }
    catch (e) { setError(extractMsg(e, 'Failed to save payment.')) }
    finally { setSaving(false); setPaymentModalOpen(false) }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!jobId) return
    if (!confirm('Delete this job permanently? This cannot be undone.')) return
    setDeleting(true)
    await supabase.from('jobs').delete().eq('id', jobId)
    router.push('/')
  }

  const usedEmployeeIds = new Set(crew.map((r) => r.employee_id).filter(Boolean))

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-dim text-sm">Loading job…</div>
  }

  // ── SHARED: Entity card ────────────────────────────────────────────────────
  function renderEntityCard(locked = false) {
    return (
      <Card title="Client">
        {/* Source selector */}
        {(isBooking || isInProgress) && !locked ? (
          <div className="flex gap-2 mb-3">
            {(['private', 'subcontract', 'contract'] as JobSource[]).map((src) => (
              <button
                key={src}
                type="button"
                onClick={() => handleSourceChange(src)}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold border-2 transition-colors ${
                  form.source === src
                    ? 'border-gold-ring bg-gold/8 text-gold'
                    : 'border-wire bg-panel text-dim hover:border-dim'
                }`}
              >
                {src === 'private' ? 'Private' : src === 'subcontract' ? 'Subcontract' : 'Contract'}
              </button>
            ))}
          </div>
        ) : (
          <div className="mb-3 flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              form.source === 'private' ? 'bg-violet-100 text-violet-700' :
              form.source === 'contract' ? 'bg-teal-500/10 text-teal-300' :
              'bg-wire/50 text-dim'
            }`}>
              {form.source === 'private' ? 'Private' : form.source === 'subcontract' ? 'Subcontract' : 'Contract'}
            </span>
          </div>
        )}

        {/* SUBCONTRACT */}
        {form.source === 'subcontract' && (
          locked ? (
            <div className="space-y-1">
              <p className="text-sm font-medium text-parchment">{selectedSub?.name ?? '—'}</p>
              {form.subcontractor_rate_id && selectedSub?.billing_type === 'ratecard' && (
                <p className="text-xs text-dim">Rate: {(selectedSub.config as RateCardConfig).rateList?.find((r) => r.id === form.subcontractor_rate_id)?.name ?? '—'}</p>
              )}
              {form.subcontractor_trucks && <p className="text-xs text-dim">Trucks: {form.subcontractor_trucks}</p>}
              {form.subcontractor_crew_size && <p className="text-xs text-dim">Crew: {form.subcontractor_crew_size}</p>}
              {form.contractor_job_id && <p className="text-xs text-dim">Contractor Job ID: {form.contractor_job_id}</p>}
            </div>
          ) : (
            <div className="space-y-3">
              <Select
                label="Subcontractor"
                placeholder="Select subcontractor…"
                options={subs.map((s) => ({ value: s.id, label: s.name }))}
                value={form.subcontractor_id ?? ''}
                onChange={(e) => handleSubChange(e.target.value)}
              />
              {form.subcontractor_id && selectedSub?.billing_type === 'ratecard' && (() => {
                const rateList = (selectedSub.config as RateCardConfig).rateList ?? []
                if (rateList.length === 0) return (
                  <p className="text-xs text-dim">No rates configured — <Link href="/settings/subcontractors" className="text-gold hover:underline">add rates in Settings</Link></p>
                )
                return (
                  <div>
                    <label className="block text-sm font-medium text-warm mb-1">Rate</label>
                    <select
                      value={form.subcontractor_rate_id ?? ''}
                      onChange={(e) => setField('subcontractor_rate_id', e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring bg-panel"
                    >
                      <option value="">Select rate…</option>
                      {rateList.map((r) => (
                        <option key={r.id} value={r.id}>{r.name} — ${r.rate_per_hour}/hr</option>
                      ))}
                    </select>
                  </div>
                )
              })()}
              <Input
                label="Crew Size"
                type="number"
                min="1"
                step="1"
                value={form.subcontractor_crew_size ?? ''}
                onChange={(e) => setField('subcontractor_crew_size', e.target.value)}
                placeholder="e.g. 3"
              />
              <Input
                label="Contractor Job ID"
                value={form.contractor_job_id}
                onChange={(e) => setField('contractor_job_id', e.target.value)}
                placeholder="e.g. ABC-1234 (optional)"
              />
            </div>
          )
        )}

        {/* PRIVATE */}
        {form.source === 'private' && (
          locked ? (
            <div className="space-y-1">
              <p className="text-sm font-medium text-parchment">{selectedCustomer?.name ?? '—'}</p>
              {selectedCustomer?.phone && (
                <p className="text-xs text-dim">{selectedCustomer.phone}</p>
              )}
              {(form.private_rate_id || form.private_rate_custom) && (
                <p className="text-xs text-dim">
                  {form.private_rate_custom
                    ? `Custom — $${form.private_rate_custom_price}/hr${form.private_rate_custom_desc ? ` (${form.private_rate_custom_desc})` : ''}`
                    : privateRates.find((r) => r.id === form.private_rate_id)?.name ?? '—'}
                </p>
              )}
              {rateBlocks.length > 0 && (
                <div className="text-xs text-dim space-y-0.5">
                  {rateBlocks.map((r) => (
                    <p key={r._id}>{r.label || 'Custom'} — ${r.rate_per_hour}/hr ({r.start_time}–{r.finish_time})</p>
                  ))}
                </div>
              )}
              {(parseFloat(form.deposit) || 0) > 0 && (
                <p className="text-xs text-dim">Deposit: ${form.deposit}</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Customer search */}
              <div ref={customerRef} className="relative">
                <label className="block text-sm font-medium text-warm mb-1">
                  Customer <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  value={customerSearch}
                  onFocus={() => setShowCustomerDrop(true)}
                  onChange={(e) => { setCustomerSearch(e.target.value); setField('customer_id', ''); setShowCustomerDrop(true) }}
                  placeholder="Search or type new customer name…"
                  className="w-full px-3 py-2 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
                />
                {showCustomerDrop && (
                  <div className="absolute z-20 w-full mt-1 bg-surface border border-wire rounded-lg shadow-lg max-h-44 overflow-y-auto">
                    <button type="button" onClick={() => { setField('customer_id', ''); setCustomerSearch(''); setShowCustomerDrop(false) }} className="w-full text-left px-3 py-2 text-sm text-dim hover:bg-panel">
                      No customer
                    </button>
                    {filteredCustomers.map((c) => (
                      <button key={c.id} type="button" onClick={() => { setField('customer_id', c.id); setCustomerSearch(c.name); setShowCustomerDrop(false) }} className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-baseline gap-2">
                        <span className="font-medium">{c.name}</span>
                        {c.phone && <span className="text-dim text-xs">{c.phone}</span>}
                        {!c.phone && c.contact_info && <span className="text-dim text-xs">{c.contact_info}</span>}
                      </button>
                    ))}
                    {filteredCustomers.length === 0 && customerSearch.trim() && (
                      <p className="px-3 py-2 text-xs text-gold">Will create new customer &quot;{customerSearch}&quot; on save</p>
                    )}
                  </div>
                )}
                {selectedCustomer?.phone && (
                  <p className="mt-1 text-xs text-dim">{selectedCustomer.phone}</p>
                )}
                {!form.customer_id && customerSearch.trim() && (
                  <p className="mt-1 text-xs text-gold">New customer &quot;{customerSearch}&quot; will be created on save</p>
                )}
              </div>

              {/* Rate dropdown grouped by truck size */}
              <div>
                <label className="block text-sm font-medium text-warm mb-1">Rate <span className="text-danger">*</span></label>
                <select
                  value={form.private_rate_custom ? 'custom' : (form.private_rate_id ?? '')}
                  onChange={(e) => {
                    if (e.target.value === 'custom') {
                      setField('private_rate_custom', true)
                      setField('private_rate_id', '')
                    } else {
                      setField('private_rate_custom', false)
                      setField('private_rate_id', e.target.value)
                    }
                  }}
                  className="w-full px-3 py-2 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring bg-panel"
                >
                  <option value="">Select rate…</option>
                  {(['small', 'large'] as const).map((size) => {
                    const sizeRates = privateRates.filter((r) => r.truck_size === size)
                    if (!sizeRates.length) return null
                    return (
                      <optgroup key={size} label={size === 'small' ? '— Small Truck —' : '— Large Truck —'}>
                        {sizeRates.map((r) => (
                          <option key={r.id} value={r.id}>{r.name} — ${r.rate_per_hour}/hr</option>
                        ))}
                      </optgroup>
                    )
                  })}
                  <optgroup label="— Custom —">
                    <option value="custom">Custom price…</option>
                  </optgroup>
                </select>
              </div>

              {/* Custom price fields */}
              {form.private_rate_custom && (
                <>
                  <Input
                    label="Description"
                    value={form.private_rate_custom_desc ?? ''}
                    onChange={(e) => setField('private_rate_custom_desc', e.target.value)}
                    placeholder="e.g. Special rate — VIP client"
                  />
                  <Input
                    label="Rate ($/hr)"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.private_rate_custom_price ?? ''}
                    onChange={(e) => setField('private_rate_custom_price', e.target.value)}
                    placeholder="0.00"
                  />
                </>
              )}

              {/* Rate Changes — crew/truck size changed mid-job (e.g. starts
                  2 Men & 1 Truck, becomes 4 Men & 2 Trucks): each segment is
                  billed at its own rate instead of one flat rate for the
                  whole day. Optional — leave empty for a normal flat-rate job. */}
              <div className="pt-2 border-t border-wire space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-dim uppercase tracking-wide">Rate Changes (optional)</label>
                  <button type="button" onClick={addRateBlock} className="flex items-center gap-1 text-xs text-gold hover:text-gold-bright font-medium">
                    <Plus size={13} /> Add Rate Change
                  </button>
                </div>
                {rateBlocks.map((row) => {
                  const hours = row.start_time.length === 5 && row.finish_time.length === 5 ? Math.max(0, calcCrewHours(row.start_time, row.finish_time)) : null
                  const rate = parseFloat(row.rate_per_hour) || 0
                  return (
                    <div key={row._id} className="flex items-center gap-1.5 flex-wrap p-2 bg-panel rounded-lg">
                      <select
                        value=""
                        onChange={(e) => {
                          const val = e.target.value
                          if (!val) return
                          const [label, rateStr] = val.split('|')
                          updateRateBlock(row._id, 'label', label)
                          updateRateBlock(row._id, 'rate_per_hour', rateStr)
                        }}
                        className="text-xs px-2 py-1.5 border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring bg-panel"
                      >
                        <option value="">Quick-fill from rate…</option>
                        {(['small', 'large'] as const).map((size) => {
                          const sizeRates = privateRates.filter((r) => r.truck_size === size)
                          if (!sizeRates.length) return null
                          return (
                            <optgroup key={size} label={size === 'small' ? '— Small Truck —' : '— Large Truck —'}>
                              {sizeRates.map((r) => (
                                <option key={r.id} value={`${r.name}|${r.rate_per_hour}`}>{r.name} — ${r.rate_per_hour}/hr</option>
                              ))}
                            </optgroup>
                          )
                        })}
                      </select>
                      <input
                        type="text"
                        value={row.label}
                        onChange={(e) => updateRateBlock(row._id, 'label', e.target.value)}
                        placeholder="e.g. 3 Men & 1 Truck"
                        className="flex-1 min-w-[110px] px-2 py-1.5 text-xs border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
                      />
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-xs text-dim">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.rate_per_hour}
                          onChange={(e) => updateRateBlock(row._id, 'rate_per_hour', e.target.value)}
                          placeholder="0.00"
                          className="w-16 px-2 py-1.5 text-xs border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
                        />
                        <span className="text-xs text-dim">/hr</span>
                      </div>
                      <input type="time" value={row.start_time} onChange={(e) => updateRateBlock(row._id, 'start_time', e.target.value)} className="w-24 px-1.5 py-1.5 text-xs border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring" />
                      <span className="text-dim text-xs">–</span>
                      <input type="time" value={row.finish_time} onChange={(e) => updateRateBlock(row._id, 'finish_time', e.target.value)} className="w-24 px-1.5 py-1.5 text-xs border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring" />
                      {hours !== null && rate > 0 && (
                        <span className="text-xs font-medium text-success whitespace-nowrap">{hours}h = {fmt(hours * rate)}</span>
                      )}
                      <button type="button" onClick={() => removeRateBlock(row._id)} className="text-dim hover:text-danger shrink-0"><Trash2 size={14} /></button>
                    </div>
                  )
                })}
              </div>

              <Input
                id="main-deposit"
                label="Deposit ($)"
                type="number"
                min="0"
                step="0.01"
                value={form.deposit}
                onChange={(e) => setField('deposit', e.target.value)}
                placeholder="0.00"
              />

            </div>
          )
        )}

        {/* CONTRACT */}
        {form.source === 'contract' && (
          locked ? (
            <div className="space-y-1">
              <p className="text-sm font-medium text-parchment">{entityDisplayName}</p>
              {form.contract_rate_custom && form.contract_rate_custom_price
                ? <p className="text-xs text-dim">Rate: Custom — ${form.contract_rate_custom_price}/hr</p>
                : form.contract_rate_id
                  ? <p className="text-xs text-dim">Rate: {contractRates.find((r) => r.id === form.contract_rate_id)?.name ?? '—'}</p>
                  : form.rate_card_key
                    ? <p className="text-xs text-dim">Rate: {form.rate_card_key}</p>
                    : null
              }
              {rateBlocks.length > 0 && (
                <div className="text-xs text-dim space-y-0.5">
                  {rateBlocks.map((r) => (
                    <p key={r._id}>{r.label || 'Custom'} — ${r.rate_per_hour}/hr ({r.start_time}–{r.finish_time})</p>
                  ))}
                </div>
              )}
              {form.reference_number && <p className="text-xs text-dim">Job ID: {form.reference_number}</p>}
            </div>
          ) : (
            <div className="space-y-3">
              <Select
                label="Contract"
                placeholder="Select contract…"
                options={contracts.map((c) => ({ value: c.id, label: c.name }))}
                value={form.contract_id ?? ''}
                onChange={(e) => handleContractChange(e.target.value)}
              />
              {form.contract_id && (
                <Input
                  label="Client"
                  placeholder="Client name…"
                  value={form.contract_client_name}
                  onChange={(e) => setField('contract_client_name', e.target.value)}
                />
              )}
              {/* Rate dropdown + custom option (mirrors Private pattern) */}
              {form.contract_id && (
                <div>
                  <label className="block text-sm font-medium text-warm mb-1">Rate</label>
                  <select
                    value={form.contract_rate_custom ? 'custom' : (form.contract_rate_id ?? '')}
                    onChange={(e) => {
                      if (e.target.value === 'custom') {
                        setForm((f) => ({ ...f, contract_rate_custom: true, contract_rate_id: '', contract_rate_custom_price: '' }))
                      } else {
                        setForm((f) => ({ ...f, contract_rate_custom: false, contract_rate_id: e.target.value, contract_rate_custom_price: '' }))
                      }
                    }}
                    className="w-full px-3 py-2 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring bg-panel"
                  >
                    <option value="">Select rate…</option>
                    {contractRates.filter((r) => r.contract_id === form.contract_id).map((r) => (
                      <option key={r.id} value={r.id}>{r.name} — ${r.rate_per_hour}/hr</option>
                    ))}
                    <optgroup label="— Custom —">
                      <option value="custom">Custom price…</option>
                    </optgroup>
                  </select>
                </div>
              )}
              {form.contract_rate_custom && (
                <Input
                  label="Rate ($/hr)"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.contract_rate_custom_price}
                  onChange={(e) => setField('contract_rate_custom_price', e.target.value)}
                  placeholder="0.00"
                />
              )}
              {/* Additional hours/rate when contract_rate selected */}
              {form.contract_id && form.contract_rate_id && (
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Additional Hrs" type="number" min="0" step="0.25" value={form.additional_hours ?? ''} onChange={(e) => setField('additional_hours', e.target.value)} placeholder="0" />
                  <Input label="Addtl Rate ($/hr)" type="number" min="0" step="0.01" value={form.additional_rate ?? ''} onChange={(e) => setField('additional_rate', e.target.value)} placeholder="0.00" />
                </div>
              )}

              {/* Rate Changes — crew/truck size changed mid-job: each segment
                  is billed at its own rate instead of one flat rate for the
                  whole day. Optional — leave empty for a normal flat-rate job. */}
              {form.contract_id && (
                <div className="pt-2 border-t border-wire space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-dim uppercase tracking-wide">Rate Changes (optional)</label>
                    <button type="button" onClick={addRateBlock} className="flex items-center gap-1 text-xs text-gold hover:text-gold-bright font-medium">
                      <Plus size={13} /> Add Rate Change
                    </button>
                  </div>
                  {rateBlocks.map((row) => {
                    const hours = row.start_time.length === 5 && row.finish_time.length === 5 ? Math.max(0, calcCrewHours(row.start_time, row.finish_time)) : null
                    const rate = parseFloat(row.rate_per_hour) || 0
                    return (
                      <div key={row._id} className="flex items-center gap-1.5 flex-wrap p-2 bg-panel rounded-lg">
                        <select
                          value=""
                          onChange={(e) => {
                            const val = e.target.value
                            if (!val) return
                            const [label, rateStr] = val.split('|')
                            updateRateBlock(row._id, 'label', label)
                            updateRateBlock(row._id, 'rate_per_hour', rateStr)
                          }}
                          className="text-xs px-2 py-1.5 border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring bg-panel"
                        >
                          <option value="">Quick-fill from rate…</option>
                          {contractRates.filter((r) => r.contract_id === form.contract_id).map((r) => (
                            <option key={r.id} value={`${r.name}|${r.rate_per_hour}`}>{r.name} — ${r.rate_per_hour}/hr</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={row.label}
                          onChange={(e) => updateRateBlock(row._id, 'label', e.target.value)}
                          placeholder="e.g. 3 Men & 1 Truck"
                          className="flex-1 min-w-[110px] px-2 py-1.5 text-xs border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
                        />
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-xs text-dim">$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.rate_per_hour}
                            onChange={(e) => updateRateBlock(row._id, 'rate_per_hour', e.target.value)}
                            placeholder="0.00"
                            className="w-16 px-2 py-1.5 text-xs border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
                          />
                          <span className="text-xs text-dim">/hr</span>
                        </div>
                        <input type="time" value={row.start_time} onChange={(e) => updateRateBlock(row._id, 'start_time', e.target.value)} className="w-24 px-1.5 py-1.5 text-xs border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring" />
                        <span className="text-dim text-xs">–</span>
                        <input type="time" value={row.finish_time} onChange={(e) => updateRateBlock(row._id, 'finish_time', e.target.value)} className="w-24 px-1.5 py-1.5 text-xs border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring" />
                        {hours !== null && rate > 0 && (
                          <span className="text-xs font-medium text-success whitespace-nowrap">{hours}h = {fmt(hours * rate)}</span>
                        )}
                        <button type="button" onClick={() => removeRateBlock(row._id)} className="text-dim hover:text-danger shrink-0"><Trash2 size={14} /></button>
                      </div>
                    )
                  })}
                </div>
              )}

              <Input label="COF (hrs)" type="number" min="0" step="0.25" value={form.cof ?? ''} onChange={(e) => setField('cof', e.target.value)} placeholder="0.5" />
            </div>
          )
        )}
      </Card>
    )
  }

  // ── Truck helpers ─────────────────────────────────────────────────────────
  function addTruck() { setJobTruckRows((rows) => [...rows, { fleet_id: '', client_charge: '' }]) }
  function setTruckId(idx: number, fid: string) {
    setJobTruckRows((rows) => rows.map((r, i) => (i === idx ? { ...r, fleet_id: fid } : r)))
  }
  function setTruckCharge(idx: number, value: string) {
    setJobTruckRows((rows) => rows.map((r, i) => (i === idx ? { ...r, client_charge: value } : r)))
  }
  function removeTruck(idx: number) {
    setJobTruckRows((rows) => rows.filter((_, i) => i !== idx))
  }

  // ── Rate Change (billing segment) helpers ───────────────────────────────────
  function addRateBlock() {
    setRateBlocks((rows) => [...rows, { _id: crypto.randomUUID(), dbId: null, label: '', rate_per_hour: '', start_time: '', finish_time: '' }])
  }
  function updateRateBlock(_id: string, field: 'label' | 'rate_per_hour' | 'start_time' | 'finish_time', value: string) {
    setRateBlocks((rows) => rows.map((r) => r._id === _id ? { ...r, [field]: value } : r))
  }
  function removeRateBlock(_id: string) {
    setRateBlocks((rows) => rows.filter((r) => r._id !== _id))
  }

  // ── SHARED: Crew card ──────────────────────────────────────────────────────
  function renderCrewCard(showTimeInputs: boolean, locked = false) {
    return (
      <Card title="Crew" action={!locked ? <button type="button" onClick={addCrew} className="flex items-center gap-1 text-xs text-gold hover:text-gold-bright font-medium"><Plus size={14} /> Add</button> : undefined}>
        {/* Truck — available for all job sources; supports multiple trucks per
            job (e.g. a job that escalates mid-way needs a second truck sent
            out) each with an optional value charged to the client. */}
        <div className="mb-3 space-y-1.5">
          <label className="block text-xs font-semibold text-dim uppercase tracking-wide">Truck</label>
          {locked ? (
            jobTruckRows.length === 0 ? (
              <p className="text-sm text-dim">—</p>
            ) : (
              <div className="space-y-1">
                {jobTruckRows.map((row, i) => {
                  const t = fleet.find((f) => f.id === row.fleet_id)
                  if (!t) return null
                  const charge = parseFloat(row.client_charge) || 0
                  return (
                    <p key={i} className="text-sm text-warm">
                      <span className="font-mono font-semibold">{t.registration ?? t.name}</span>
                      {charge > 0 && <span className="text-success ml-2">+{fmt(charge)} charged</span>}
                    </p>
                  )
                })}
              </div>
            )
          ) : (
            <>
              {jobTruckRows.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select
                    value={row.fleet_id}
                    onChange={(e) => setTruckId(idx, e.target.value)}
                    className="flex-1 px-3 py-2 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring bg-panel"
                  >
                    <option value="">Select truck…</option>
                    {fleet.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}{t.registration ? ` · ${t.registration}` : ''}{t.size ? ` · ${t.size === 'large' ? 'Large' : 'Small'}` : ''}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs text-dim">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.client_charge}
                      onChange={(e) => setTruckCharge(idx, e.target.value)}
                      placeholder="Client charge"
                      title="Value charged to client for this truck"
                      className="w-28 px-2 py-2 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring bg-panel"
                    />
                  </div>
                  <button type="button" onClick={() => removeTruck(idx)} className="text-dim hover:text-danger shrink-0"><Trash2 size={15} /></button>
                </div>
              ))}
              <button
                type="button"
                onClick={addTruck}
                className="flex items-center gap-1 text-xs text-gold hover:text-gold-bright font-medium"
              >
                <Plus size={13} /> Add Truck
              </button>
            </>
          )}
        </div>
        <div className="border-t border-wire mb-3" />
        <div>
        {crew.length === 0 && <p className="text-sm text-dim text-center py-2">No crew added yet.</p>}
        <div className="space-y-2">
          {crew.map((row) => {
            if (!showTimeInputs) {
              // Booking view: simplified row — employee + COF checkbox + COF hrs + delete
              return (
                <div key={row._id} className="flex items-center gap-2">
                  <select
                    value={row.employee_id ?? ''}
                    onChange={(e) => updateCrew(row._id, 'employee_id', e.target.value)}
                    className="flex-1 px-3 py-2 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
                  >
                    <option value="">Select employee…</option>
                    {employees.filter((e) => e.id === row.employee_id || !usedEmployeeIds.has(e.id)).map((e) => (
                      <option key={e.id} value={e.id}>{e.name} (${e.hourly_rate}/hr)</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 text-sm text-warm whitespace-nowrap cursor-pointer select-none shrink-0">
                    <input
                      type="checkbox"
                      checked={row.cof_share}
                      onChange={(e) => updateCrew(row._id, 'cof_share', e.target.checked)}
                      className="rounded"
                    />
                    COF
                  </label>
                  <button type="button" onClick={() => removeCrew(row._id)} className="text-dim hover:text-danger shrink-0" aria-label="Remove">
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            }

            // In Progress / Completion view: full row with time inputs
            const hasTime = crewHasTime(row)
            const rawComputed = hasTime ? calcCrewHours(row.start_time, row.end_time) : null
            const computed = rawComputed !== null && rawComputed > 0 ? Math.max(2, rawComputed) : rawComputed
            return (
              <div key={row._id} className="flex flex-col gap-1.5">
                <select
                  value={row.employee_id ?? ''}
                  onChange={(e) => updateCrew(row._id, 'employee_id', e.target.value)}
                  disabled={locked}
                  className="w-full px-3 py-2 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-panel disabled:text-dim"
                >
                  <option value="">Select employee…</option>
                  {employees.filter((e) => e.id === row.employee_id || !usedEmployeeIds.has(e.id)).map((e) => (
                    <option key={e.id} value={e.id}>{e.name} (${e.hourly_rate}/hr)</option>
                  ))}
                </select>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="time"
                    value={row.start_time ?? ''}
                    onChange={(e) => updateCrew(row._id, 'start_time', e.target.value)}
                    disabled={locked}
                    className="w-28 px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-panel"
                  />
                  <span className="text-dim text-xs">–</span>
                  <input
                    type="time"
                    value={row.end_time ?? ''}
                    onChange={(e) => updateCrew(row._id, 'end_time', e.target.value)}
                    disabled={locked}
                    className="w-28 px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-panel"
                  />
                  {hasTime ? (
                    <span className="text-sm font-medium text-warm w-14 text-right tabular-nums">{computed?.toFixed(2)}h</span>
                  ) : (
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      value={row.hours ?? ''}
                      onChange={(e) => updateCrew(row._id, 'hours', e.target.value)}
                      disabled={locked}
                      placeholder="hrs"
                      className="w-20 px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-panel"
                    />
                  )}
                  <label className="flex items-center gap-1.5 text-sm text-warm whitespace-nowrap cursor-pointer select-none">
                    <input type="checkbox" checked={row.cof_share} onChange={(e) => updateCrew(row._id, 'cof_share', e.target.checked)} disabled={locked} className="rounded" />
                    COF
                  </label>
                  {!locked && (
                    <button type="button" onClick={() => removeCrew(row._id)} className="ml-auto text-dim hover:text-danger" aria-label="Remove">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {summary && summary.payrollEntries.length > 0 && (
          <div className="mt-3 pt-3 border-t border-wire space-y-1">
            {summary.payrollEntries.map((e) => (
              <div key={`${e.employee_id}-${e.label ?? 'crew'}`} className="flex justify-between text-xs text-dim">
                <span>
                  {e.employee_name} — {e.paid_hours}h × ${e.hourly_rate}
                  {e.google_review_bonus && <span className="ml-1 text-gold">(+0.5h ★)</span>}
                </span>
                <span className="font-medium">{fmt(e.pay)}</span>
              </div>
            ))}
            <div className="flex justify-between text-xs font-semibold text-warm pt-1 border-t border-wire">
              <span>Payroll total</span>
              <span>{fmt(summary.payrollTotal)}</span>
            </div>
          </div>
        )}
        </div>
      </Card>
    )
  }

  // ── SHARED: Photos & Documents card ───────────────────────────────────────
  function renderPhotosCard(availableCategories: string[], locked = false) {
    const displayCategories = availableCategories.length === 1
      ? availableCategories
      : ['inventory', 'completion', 'damage', 'receipt', 'google_review'].filter((c) => availableCategories.includes(c))

    function isImage(url: string) {
      return /\.(png|jpe?g|gif|webp|heic|heif|bmp)(\?|$)/i.test(url)
    }

    function fileNameFromUrl(url: string) {
      try {
        const parts = new URL(url).pathname.split('/')
        const last = parts[parts.length - 1]
        // Strip leading timestamp prefix (e.g. "1719000000000-filename.pdf")
        return decodeURIComponent(last.replace(/^\d+-/, ''))
      } catch {
        return 'document.pdf'
      }
    }

    return (
      <Card title="Photos & Documents">
        {!locked && (
          <div className="flex gap-2 mb-3">
            {availableCategories.length > 1 && (
              <select
                value={photoCategory}
                onChange={(e) => setPhotoCategory(e.target.value)}
                className="px-2 py-2 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
              >
                {PHOTO_CATEGORIES.filter((c) => availableCategories.includes(c.value)).map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            )}
            <input
              type="text"
              value={photoCaption}
              onChange={(e) => setPhotoCaption(e.target.value)}
              placeholder="Caption (optional)…"
              className="flex-1 px-3 py-2 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
            />
            <label className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gold border border-gold-ring/50 rounded-lg hover:bg-gold/8 cursor-pointer shrink-0">
              <FilePlus size={16} />
              {uploadingPhoto ? 'Uploading…' : 'Add'}
              <input
                type="file"
                accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                multiple
                className="hidden"
                disabled={uploadingPhoto}
                onChange={(e) => {
                  const files = e.target.files
                  const cat = availableCategories.length === 1 ? availableCategories[0] : photoCategory
                  if (files && files.length > 0) { uploadPhotos(files, cat); e.target.value = '' }
                }}
              />
            </label>
          </div>
        )}
        {uploadError && <p className="text-xs text-danger mb-2">{uploadError}</p>}
        {photos.filter((p) => displayCategories.includes(p.category)).length === 0 && (
          <p className="text-sm text-dim text-center py-2">No photos or documents yet.</p>
        )}
        {displayCategories.map((cat) => {
          const catPhotos = photos.filter((p) => p.category === cat)
          if (catPhotos.length === 0) return null
          return (
            <div key={cat} className="mb-3">
              {availableCategories.length > 1 && (
                <p className="text-xs font-semibold text-dim uppercase tracking-wide mb-1.5">{PHOTO_LABELS[cat] ?? cat}</p>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {catPhotos.map((p) => (
                  !isImage(p.url) ? (
                    <div key={p._id} className="relative group rounded-lg overflow-hidden bg-wire/30 aspect-video flex flex-col items-center justify-center gap-1.5 px-2">
                      {locked ? (
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex flex-col items-center gap-1.5 text-center w-full"
                        >
                          <FileText size={28} className="text-gold shrink-0" />
                          <span className="text-xs text-parchment truncate w-full text-center leading-tight">{p.caption || fileNameFromUrl(p.url)}</span>
                        </a>
                      ) : (
                        <>
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex flex-col items-center gap-1.5 text-center w-full"
                          >
                            <FileText size={28} className="text-gold shrink-0" />
                            <span className="text-xs text-parchment truncate w-full text-center leading-tight">{p.caption || fileNameFromUrl(p.url)}</span>
                          </a>
                          <button
                            type="button"
                            onClick={() => removePhoto(p._id)}
                            className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label="Remove document"
                          >
                            <X size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <div key={p._id} className="relative group rounded-lg overflow-hidden bg-wire/30 aspect-video">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={p.caption || 'Job photo'} className="w-full h-full object-cover" />
                      {p.caption && (
                        <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs px-2 py-1 truncate">{p.caption}</div>
                      )}
                      {!locked && (
                        <button
                          type="button"
                          onClick={() => removePhoto(p._id)}
                          className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Remove photo"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  )
                ))}
              </div>
            </div>
          )
        })}
      </Card>
    )
  }

  // ── SHARED: Casual / Packing Crew card ────────────────────────────────────
  function renderCasualCrewCard(locked = false) {
    return (
      <Card
        title="Casual / Packing Crew"
        action={!locked ? (
          <button type="button" onClick={addCasualCrew} className="flex items-center gap-1 text-xs text-gold hover:text-gold-bright font-medium">
            <Plus size={14} /> Add Person
          </button>
        ) : undefined}
      >
        {casualCrew.length === 0 && <p className="text-sm text-dim text-center py-2">No casual crew added.</p>}
        <datalist id="casual-worker-list">
          {casualWorkers.map((cw) => <option key={cw.id} value={cw.name} />)}
        </datalist>
        <div className="space-y-2">
          {casualCrew.map((row) => {
            const hasTime = row.start_time.length === 5 && row.finish_time.length === 5
            const cofFinalHrsUI = form.cof_final.trim() ? (parseFloat(form.cof_final) || null) : null
            const baseComputed = hasTime
              ? Math.max(0, calcCrewHours(row.start_time, row.finish_time))
              : (row.cof_share ? (cofFinalHrsUI ?? null) : null)
            const casualWorkerIdUI = casualWorkers.find((cw) => cw.name.toLowerCase() === row.name.trim().toLowerCase())?.id
            const reviewHrsUI = (baseComputed !== null && form.google_review && casualWorkerIdUI && form.google_review_employee_ids.includes(casualWorkerIdUI)) ? 0.5 : 0
            const hiHrsUI = (baseComputed !== null && row.heavy_item) ? 0.5 : 0
            const computed = baseComputed !== null ? baseComputed + reviewHrsUI + hiHrsUI : null
            const pay = computed !== null ? computed * (parseFloat(row.rate_per_hour) || 0) : null
            return (
              <div key={row._id} className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  list="casual-worker-list"
                  value={row.name}
                  onChange={(e) => {
                    const val = e.target.value
                    updateCasualCrew(row._id, 'name', val)
                    const match = casualWorkers.find((cw) => cw.name.toLowerCase() === val.toLowerCase())
                    if (match) updateCasualCrew(row._id, 'rate_per_hour', match.rate_per_hour.toString())
                  }}
                  onBlur={() => {
                    const name = row.name.trim()
                    if (!name || locked) return
                    const known = casualWorkers.some((cw) => cw.name.toLowerCase() === name.toLowerCase())
                    if (!known && !declinedCasualWorkerNamesRef.current.has(name.toLowerCase())) {
                      setPendingNewCasualWorker({ rowId: row._id, name, rate: parseFloat(row.rate_per_hour) || 0 })
                    }
                  }}
                  disabled={locked}
                  placeholder="Person name…"
                  className="flex-1 min-w-[120px] px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-panel disabled:text-dim"
                />
                <input
                  type="time"
                  value={row.start_time}
                  onChange={(e) => updateCasualCrew(row._id, 'start_time', e.target.value)}
                  disabled={locked}
                  className="w-28 px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-panel"
                />
                <span className="text-dim text-xs">–</span>
                <input
                  type="time"
                  value={row.finish_time}
                  onChange={(e) => updateCasualCrew(row._id, 'finish_time', e.target.value)}
                  disabled={locked}
                  className="w-28 px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-panel"
                />
                <div className="flex items-center gap-1">
                  <span className="text-xs text-dim">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.50"
                    value={row.rate_per_hour}
                    onChange={(e) => updateCasualCrew(row._id, 'rate_per_hour', e.target.value)}
                    disabled={locked}
                    placeholder="0"
                    className="w-20 px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-panel"
                  />
                  <span className="text-xs text-dim">/hr</span>
                </div>
                <label className="flex items-center gap-1.5 text-sm text-warm whitespace-nowrap cursor-pointer select-none shrink-0">
                  <input
                    type="checkbox"
                    checked={row.cof_share}
                    onChange={(e) => updateCasualCrew(row._id, 'cof_share', e.target.checked)}
                    disabled={locked}
                    className="rounded"
                  />
                  COF
                </label>
                {computed !== null && (
                  <span className="text-xs text-dim tabular-nums w-10">{computed}h</span>
                )}
                {pay !== null && (
                  <span className="text-xs font-medium text-warm tabular-nums">{fmt(pay)}</span>
                )}
                {!locked && (
                  <button type="button" onClick={() => removeCasualCrew(row._id)} className="text-dim hover:text-danger">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
        {summary && summary.casualEntries.length > 0 && (
          <div className="mt-3 pt-3 border-t border-wire space-y-1">
            {summary.casualEntries.map((e, i) => (
              <div key={i} className="flex justify-between text-xs text-dim">
                <span>{e.name} — {e.hours}h × ${e.rate_per_hour}</span>
                <span className="font-medium">{fmt(e.pay)}</span>
              </div>
            ))}
            <div className="flex justify-between text-xs font-semibold text-warm pt-1 border-t border-wire">
              <span>Casual crew total</span>
              <span>{fmt(summary.casualEntries.reduce((s, e) => s + e.pay, 0))}</span>
            </div>
          </div>
        )}
      </Card>
    )
  }

  // ── SHARED: Commissions card ───────────────────────────────────────────────
  function renderCommissionsCard(locked = false) {
    return (
      <Card
        title="Commissions"
        action={!locked ? (
          <button type="button" onClick={addCommission} className="flex items-center gap-1 text-xs text-gold hover:text-gold-bright font-medium">
            <Plus size={14} /> Add Commission
          </button>
        ) : undefined}
      >
        {commissions.length === 0 && <p className="text-sm text-dim text-center py-2">No commissions.</p>}
        <div className="space-y-2">
          {commissions.map((row) => {
            const total = (parseFloat(row.rate_per_hour) || 0) * (parseFloat(row.hours) || 0)
            return (
              <div key={row._id} className="flex items-center gap-2 flex-wrap">
                <select
                  value={row.commission_type_id}
                  onChange={(e) => updateCommission(row._id, 'commission_type_id', e.target.value)}
                  disabled={locked}
                  className="flex-1 min-w-[140px] px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-panel disabled:text-dim"
                >
                  <option value="">Type…</option>
                  {commissionTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} (${t.rate_per_hour}/hr)</option>
                  ))}
                </select>
                <select
                  value={row.casual_worker_id ? `casual:${row.casual_worker_id}` : row.employee_id ? `staff:${row.employee_id}` : ''}
                  onChange={(e) => {
                    const val = e.target.value
                    const [type, id] = val.split(':')
                    setCommissions((cs) => cs.map((r) => r._id === row._id ? {
                      ...r,
                      employee_id: type === 'staff' ? id : '',
                      casual_worker_id: type === 'casual' ? id : '',
                    } : r))
                  }}
                  disabled={locked}
                  className="flex-1 min-w-[120px] px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-panel disabled:text-dim"
                >
                  <option value="">Person…</option>
                  <optgroup label="Staff">
                    {employees.map((e) => (
                      <option key={e.id} value={`staff:${e.id}`}>{e.name}</option>
                    ))}
                  </optgroup>
                  {casualWorkers.length > 0 && (
                    <optgroup label="Casual Workers">
                      {casualWorkers.map((cw) => (
                        <option key={cw.id} value={`casual:${cw.id}`}>{cw.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-dim">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.50"
                    value={row.rate_per_hour}
                    onChange={(e) => updateCommission(row._id, 'rate_per_hour', e.target.value)}
                    disabled={locked}
                    placeholder="0"
                    className="w-20 px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-panel"
                  />
                  <span className="text-xs text-dim">/hr</span>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={row.hours}
                    onChange={(e) => updateCommission(row._id, 'hours', e.target.value)}
                    disabled={locked}
                    placeholder="hrs"
                    className="w-16 px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-panel"
                  />
                  <span className="text-xs text-dim">h</span>
                </div>
                {total > 0 && (
                  <span className="text-xs font-medium text-warm tabular-nums">{fmt(total)}</span>
                )}
                {!locked && (
                  <button type="button" onClick={() => removeCommission(row._id)} className="text-dim hover:text-danger">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
        {summary && commissions.some((r) => r.employee_id && parseFloat(r.hours) > 0) && (
          <div className="mt-3 pt-3 border-t border-wire space-y-1">
            {summary.payrollEntries.filter((e) => e.label).map((e, i) => (
              <div key={i} className="flex justify-between text-xs text-dim">
                <span>{e.employee_name} — {e.label} — {e.hours}h × ${e.hourly_rate}</span>
                <span className="font-medium">{fmt(e.pay)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    )
  }

  // ── SHARED: Materials card ─────────────────────────────────────────────────
  function renderMaterialsCard(locked = false) {
    const catalogAction = !locked ? (
      <div ref={catalogRef} className="relative">
        <button
          type="button"
          onClick={() => setShowCatalogDrop((v) => !v)}
          className="flex items-center gap-1 text-xs text-gold hover:text-gold-bright font-medium"
        >
          <Plus size={14} /> Add
        </button>
        {showCatalogDrop && (
          <div className="absolute right-0 top-full mt-1 z-30 w-52 bg-surface border border-wire rounded-lg shadow-lg py-1">
            {catalog.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => addMaterialFromCatalog(item)}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex justify-between items-center gap-2"
              >
                <span>{item.name}</span>
                <span className="text-dim text-xs shrink-0">${Number(item.sale_price).toFixed(2)}</span>
              </button>
            ))}
            <div className="border-t border-wire mt-1 pt-1">
              <button
                type="button"
                onClick={() => addMaterialFromCatalog(null)}
                className="w-full text-left px-3 py-1.5 text-sm text-dim hover:bg-panel"
              >
                Custom item…
              </button>
            </div>
          </div>
        )}
      </div>
    ) : undefined
    return (
      <Card title="Materials" action={catalogAction}>
        {materials.length === 0 && <p className="text-sm text-dim text-center py-2">No materials.</p>}
        {materials.length > 0 && !locked && (
          <div className="text-xs text-dim grid grid-cols-[1fr_56px_72px_72px_20px] gap-2 px-1 mb-1">
            <span>Name</span><span>Qty</span><span>Cost</span><span>Sale</span><span />
          </div>
        )}
        <div className="space-y-2">
          {materials.map((row) => (
            locked ? (
              <div key={row._id} className="flex justify-between text-sm text-warm">
                <span>{row.material_name} × {row.quantity}</span>
                <span className="text-dim">{fmt(parseFloat(row.sale_price) * parseFloat(row.quantity) || 0)}</span>
              </div>
            ) : (
              <div key={row._id} className="grid grid-cols-[1fr_56px_72px_72px_20px] gap-2 items-center">
                <input type="text" value={row.material_name ?? ''} onChange={(e) => updateMaterial(row._id, 'material_name', e.target.value)} placeholder="Item name" className="w-full px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring" />
                <input type="number" min="0" step="1" value={row.quantity ?? ''} onChange={(e) => updateMaterial(row._id, 'quantity', e.target.value)} className="w-full px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring" />
                <input type="number" min="0" step="0.01" value={row.cost_price ?? ''} onChange={(e) => updateMaterial(row._id, 'cost_price', e.target.value)} placeholder="0.00" className="w-full px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring" />
                <input type="number" min="0" step="0.01" value={row.sale_price ?? ''} onChange={(e) => updateMaterial(row._id, 'sale_price', e.target.value)} placeholder="0.00" className="w-full px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring" />
                <button type="button" onClick={() => removeMaterial(row._id)} className="text-dim hover:text-danger" aria-label="Remove"><Trash2 size={14} /></button>
              </div>
            )
          ))}
        </div>
      </Card>
    )
  }

  // ── RENDER: Executive view (invoiced + paid) ───────────────────────────────
  if (isInvoiced) {
    const empMap = new Map(employees.map((e) => [e.id, e]))
    const MIN_CALL = 2
    const crewLines = crew.filter((r) => r.employee_id).map((r) => {
      const emp = empMap.get(r.employee_id)
      if (!emp) return null
      const workedHours = resolveCrewHours(r)
      const cofHours = r.cof_share ? (parseFloat(r.cof_hours) || 0) : 0
      const reviewBonus = form.google_review && form.google_review_employee_ids.includes(emp.id) ? 0.5 : 0
      const paidHours = Math.max(workedHours, MIN_CALL) + cofHours + reviewBonus
      const pay = paidHours * emp.hourly_rate
      return { name: emp.name, workedHours, paidHours, rate: emp.hourly_rate, pay }
    }).filter(Boolean)

    const payrollTotal = crewLines.reduce((s, l) => s + (l?.pay ?? 0), 0)

    return (
      <div className="max-w-2xl pb-28">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/jobs" className="text-dim hover:text-warm">
              <ChevronLeft size={20} />
            </Link>
            <div>
              <h1 className="text-2xl font-display font-bold text-parchment">Job #{form.job_number}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[form.status]}`}>
                {STATUS_LABEL[form.status]}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-dim">{form.date}</span>
            {isEdit && (
              <button onClick={handleDelete} disabled={deleting} className="text-sm text-danger hover:text-danger font-medium disabled:opacity-50">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {/* SERVIÇO PRESTADO */}
          <Card title="Service Details">
            <div className="space-y-2 text-sm">
              <div className="flex gap-4">
                <span className="text-dim w-20 shrink-0">Client</span>
                <span className="font-medium text-parchment">{entityDisplayName}</span>
              </div>
              {form.reference_number && (
                <div className="flex gap-4">
                  <span className="text-dim w-20 shrink-0">Ref</span>
                  <span className="text-warm">{form.reference_number}</span>
                </div>
              )}
              {form.contractor_job_id && (
                <div className="flex gap-4">
                  <span className="text-dim w-20 shrink-0">Ctrt. Job</span>
                  <span className="text-warm">{form.contractor_job_id}</span>
                </div>
              )}
              <div className="flex gap-4">
                <span className="text-dim w-20 shrink-0">Date</span>
                <span className="text-warm">{form.date}</span>
              </div>
              {form.pickup_address && (
                <div className="flex gap-4">
                  <span className="text-dim w-20 shrink-0">Pickup</span>
                  <span className="text-warm">{form.pickup_address}</span>
                </div>
              )}
              {form.delivery_address && (
                <div className="flex gap-4">
                  <span className="text-dim w-20 shrink-0">Delivery</span>
                  <span className="text-warm">{form.delivery_address}</span>
                </div>
              )}
              {form.actual_start_time && form.actual_finish_time && (
                <div className="flex gap-4">
                  <span className="text-dim w-20 shrink-0">Hours</span>
                  <span className="text-warm">{form.actual_start_time.slice(0,5)} – {form.actual_finish_time.slice(0,5)}</span>
                </div>
              )}
            </div>
          </Card>

          {/* EQUIPE */}
          {crewLines.length > 0 && (
            <Card title="Crew">
              <div className="space-y-2">
                {crewLines.map((l, i) => l && (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div>
                      <span className="font-medium text-parchment">{l.name}</span>
                      <span className="text-dim ml-2">{l.paidHours}h × ${l.rate}/hr</span>
                    </div>
                    <span className="font-semibold text-parchment">{fmt(l.pay)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-sm font-bold pt-2 border-t border-wire">
                  <span className="text-warm">Total Payroll</span>
                  <span className="text-parchment">{fmt(payrollTotal)}</span>
                </div>
              </div>
            </Card>
          )}

          {/* FINANCEIRO */}
          {summary && (
            <Card title="Financials">
              <div className="space-y-1.5 text-sm">
                {form.gross_job_value && (
                  <div className="flex justify-between">
                    <span className="text-dim">Gross Value</span>
                    <span className="font-semibold text-parchment">{fmt(parseFloat(form.gross_job_value))}</span>
                  </div>
                )}
                {malibuRevenue !== null && (
                  <div className="flex justify-between">
                    <span className="text-dim">Malibu Revenue</span>
                    <span className="font-semibold text-gold">{fmt(malibuRevenue)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-dim">Revenue (inc. GST)</span>
                  <span className="font-semibold text-parchment">{fmt(summary.totalRevenue)}</span>
                </div>
                {summary.clientExpensesTotal > 0 && (
                  <div className="flex justify-between text-xs pl-2">
                    <span className="text-dim">incl. Client Expenses</span>
                    <span className="text-success">+{fmt(summary.clientExpensesTotal)}</span>
                  </div>
                )}
                {summary.heavyItemCharge > 0 && (
                  <div className="flex justify-between text-xs pl-2">
                    <span className="text-dim">incl. Heavy Item</span>
                    <span className="text-success">+{fmt(summary.heavyItemCharge)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-dim">GST (10%)</span>
                  <span className="text-danger font-medium">−{fmt(summary.gstAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-dim">Net Revenue</span>
                  <span className="font-medium text-warm">{fmt(summary.netRevenue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-dim">Payroll</span>
                  <span className="text-orange-600 font-medium">−{fmt(summary.payrollTotal)}</span>
                </div>
                {summary.companyExpensesTotal > 0 && (
                  <div className="flex justify-between">
                    <span className="text-dim">Company Expenses</span>
                    <span className="text-danger font-medium">−{fmt(summary.companyExpensesTotal)}</span>
                  </div>
                )}
                {summary.materialsRevenue !== 0 && (
                  <div className="flex justify-between">
                    <span className="text-dim">Materials</span>
                    <span className="font-medium text-warm">{fmt(summary.materialsRevenue)}</span>
                  </div>
                )}
                {summary.discount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-dim">Discount</span>
                    <span className="text-danger font-medium">−{fmt(summary.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t border-wire">
                  <span className="font-bold text-parchment">Profit</span>
                  <span className={`font-bold ${summary.profit >= 0 ? 'text-success' : 'text-danger'}`}>
                    {fmt(summary.profit)}
                    {summary.margin !== null && <span className="text-xs font-normal ml-1">({(summary.margin * 100).toFixed(1)}%)</span>}
                  </span>
                </div>
              </div>
            </Card>
          )}

          {/* NOTAS */}
          {(form.completion_notes || form.notes) && (
            <Card title="Notes">
              {form.completion_notes && (
                <div className="mb-2">
                  <p className="text-xs text-dim uppercase tracking-wide mb-0.5">Completion</p>
                  <p className="text-sm text-warm whitespace-pre-wrap">{form.completion_notes}</p>
                </div>
              )}
              {form.notes && (
                <div>
                  <p className="text-xs text-dim uppercase tracking-wide mb-0.5">Notes</p>
                  <p className="text-sm text-warm whitespace-pre-wrap">{form.notes}</p>
                </div>
              )}
            </Card>
          )}

          {/* PAGAMENTO (paid status only) */}
          {isPaid && (form.payment_date || form.payment_methods.length > 0) && (
            <Card title="Payment">
              <div className="space-y-1.5 text-sm">
                {form.payment_date && (
                  <div className="flex justify-between">
                    <span className="text-dim">Date</span>
                    <span className="text-parchment">{form.payment_date}</span>
                  </div>
                )}
                {form.payment_methods.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-dim">Method</span>
                    <span className="text-parchment">{form.payment_methods.map((m) => PAYMENT_METHODS.find((pm) => pm.value === m)?.label ?? m).join(' + ')}</span>
                  </div>
                )}
                {parseFloat(form.payment_cash_amount) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-dim">Cash</span>
                    <span className="text-parchment">{fmt(parseFloat(form.payment_cash_amount))}</span>
                  </div>
                )}
                {parseFloat(form.payment_transfer_amount) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-dim">Transfer</span>
                    <span className="text-parchment">{fmt(parseFloat(form.payment_transfer_amount))}</span>
                  </div>
                )}
                {parseFloat(form.payment_card_amount) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-dim">Card</span>
                    <span className="text-parchment">{fmt(parseFloat(form.payment_card_amount))}</span>
                  </div>
                )}
                {form.payment_collected_by && (
                  <div className="flex justify-between">
                    <span className="text-dim">Collected by</span>
                    <span className="text-parchment">{form.payment_collected_by}</span>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Photos (completion/damage only) */}
          {photos.filter((p) => ['completion','damage'].includes(p.category)).length > 0 && renderPhotosCard(['completion','damage'], true)}
        </div>

        {/* Sticky footer */}
        <div className="fixed bottom-0 left-0 right-0 lg:left-56 bg-surface border-t border-wire shadow-xl z-10">
          <div className="px-4 lg:px-6 py-3 flex items-center justify-end gap-3 max-w-2xl">
            {!isPaid && (
              <Button onClick={() => setPaymentModalOpen(true)} disabled={saving} size="md" className="bg-teal-600 hover:bg-teal-700 border-teal-600">
                <Banknote size={16} /> Mark as Paid
              </Button>
            )}
            {isPaid && (
              <div className="flex items-center gap-2 text-teal-600 font-semibold text-sm">
                <CheckCircle size={16} />
                Payment confirmed
              </div>
            )}
          </div>
        </div>

        {/* Payment modal */}
        <Modal open={paymentModalOpen} onClose={() => setPaymentModalOpen(false)} title={`Payment — Job #${form.job_number}`}>
          <div className="space-y-4">
            <Input label="Payment Date" type="date" value={form.payment_date ?? ''} onChange={(e) => setField('payment_date', e.target.value)} />
            <div>
              <p className="text-sm font-medium text-warm mb-2">Payment Method</p>
              <div className="flex gap-3 flex-wrap">
                {PAYMENT_METHODS.map((pm) => (
                  <label key={pm.value} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.payment_methods.includes(pm.value)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...form.payment_methods, pm.value]
                          : form.payment_methods.filter((m) => m !== pm.value)
                        setField('payment_methods', next)
                      }}
                      className="rounded"
                    />
                    {pm.label}
                  </label>
                ))}
              </div>
            </div>
            {form.payment_methods.includes('cash') && (
              <Input label="Cash Amount ($)" type="number" min="0" step="0.01" value={form.payment_cash_amount ?? ''} onChange={(e) => setField('payment_cash_amount', e.target.value)} placeholder="0.00" />
            )}
            {form.payment_methods.includes('bank_transfer') && (
              <Input label="Transfer Amount ($)" type="number" min="0" step="0.01" value={form.payment_transfer_amount ?? ''} onChange={(e) => setField('payment_transfer_amount', e.target.value)} placeholder="0.00" />
            )}
            {form.payment_methods.includes('card') && (
              <Input label="Card Amount ($)" type="number" min="0" step="0.01" value={form.payment_card_amount ?? ''} onChange={(e) => setField('payment_card_amount', e.target.value)} placeholder="0.00" />
            )}
            <Input label="Collected by" value={form.payment_collected_by ?? ''} onChange={(e) => setField('payment_collected_by', e.target.value)} placeholder="e.g. Alex" />
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex gap-2 pt-2">
              <Button onClick={handleConfirmPayment} disabled={saving} className="flex-1 bg-teal-600 hover:bg-teal-700 border-teal-600">
                {saving ? 'Saving…' : 'Confirm Payment'}
              </Button>
              <Button variant="secondary" onClick={() => setPaymentModalOpen(false)} className="flex-1">Cancel</Button>
            </div>
          </div>
        </Modal>
      </div>
    )
  }

  // ── RENDER: Cancelled view ─────────────────────────────────────────────────
  if (isCancelled) {
    return (
      <div className="max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/jobs" className="text-dim hover:text-warm">
            <ChevronLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-display font-bold text-parchment">Job #{form.job_number}</h1>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-danger/10 text-danger">Cancelled</span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <XCircle size={20} className="text-danger shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-danger text-sm">Job cancelled</p>
              {form.cancellation_reason && (
                <p className="text-sm text-danger mt-1">{form.cancellation_reason}</p>
              )}
            </div>
          </div>

          <Card title="Job Info">
            <div className="space-y-2 text-sm">
              <div className="flex gap-4">
                <span className="text-dim w-24 shrink-0">Job #</span>
                <span className="font-mono font-medium">{form.job_number}</span>
              </div>
              <div className="flex gap-4">
                <span className="text-dim w-24 shrink-0">Date</span>
                <span>{form.date}</span>
              </div>
              <div className="flex gap-4">
                <span className="text-dim w-24 shrink-0">Client</span>
                <span>{entityDisplayName}</span>
              </div>
            </div>
          </Card>

          {form.minimum_charge_applied && (
            <Card title="Minimum Charge">
              <div className="flex items-center justify-between">
                <span className="text-sm text-warm">Minimum charge applied</span>
                <span className="font-semibold text-parchment">{fmt(parseFloat(form.minimum_charge_amount) || 0)}</span>
              </div>
            </Card>
          )}
        </div>
      </div>
    )
  }

  // ── RENDER: Main form (booking / in_progress / completed / reviewed) ────────
  return (
    <div className="max-w-2xl pb-28">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/jobs" className="text-dim hover:text-warm">
            <ChevronLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-display font-bold text-parchment">
              {isEdit ? `Job #${form.job_number}` : 'New Job'}
            </h1>
            {isEdit && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[form.status]}`}>
                {STATUS_LABEL[form.status]}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Cancel job link — visible for pre-completion statuses */}
          {isEdit && (isBooking || isInProgress) && (
            <button
              type="button"
              onClick={() => setCancelModalOpen(true)}
              className="text-sm text-danger hover:text-danger font-medium"
            >
              Cancel Job
            </button>
          )}
          {isEdit && !isBooking && !isInProgress && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-sm text-danger hover:text-danger font-medium disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete Job'}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4">

        {/* ── Reviewed lock banner ──────────────────────────────────────── */}
        {form.status === 'reviewed' && isViewMode && (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-amber-300">This job has been reviewed and is locked.</span>
            <button
              type="button"
              onClick={() => setIsViewMode(false)}
              className="text-sm font-semibold text-gold hover:text-gold-bright underline whitespace-nowrap"
            >
              Edit anyway
            </button>
          </div>
        )}

        {/* ── FINAL REVIEW (completed / reviewed) ──────────────────────── */}
        {isCompletionMode && (
          <div className={`rounded-xl border-2 p-4 ${isReviewed ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-amber-500/50 bg-amber-500/10'}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {isReviewed
                  ? <Lock size={16} className="text-cyan-300" />
                  : <CheckCircle size={16} className="text-gold" />
                }
                <h2 className="text-sm font-semibold uppercase tracking-wide text-warm">Final Review</h2>
              </div>
              {isReviewed && (
                <span className="text-xs font-medium text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <CheckCircle size={11} /> Reviewed
                </span>
              )}
            </div>

            {/* Actual times */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Input id="rfv-start" label="Actual Start" type="time" value={form.actual_start_time ?? ''} onChange={(e) => setField('actual_start_time', e.target.value)} disabled={isReviewed} />
              <Input id="rfv-finish" label="Actual Finish" type="time" value={form.actual_finish_time ?? ''} onChange={(e) => setField('actual_finish_time', e.target.value)} disabled={isReviewed} />
            </div>

            {/* Break + Call Out Fee */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Input id="rfv-break" label="Break (min)" type="number" step="1" value={form.break_minutes ?? ''} onChange={(e) => setField('break_minutes', e.target.value)} placeholder="0" disabled={isReviewed} />
              <Input id="rfv-cof-final" label="Call Out Fee — crew (hrs)" type="number" min="0" step="0.25" value={form.cof_final ?? ''} onChange={(e) => setField('cof_final', e.target.value)} placeholder="0" disabled={isReviewed} />
            </div>

            {/* Heavy Item Charge — job-level client charge (inc. GST, same as expenses) */}
            <div className="mb-3">
              <Input
                label="Heavy Item Charge ($, inc. GST)"
                type="number"
                min="0"
                step="0.01"
                value={form.heavy_item_charge}
                onChange={(e) => setField('heavy_item_charge', e.target.value)}
                placeholder="0.00"
                disabled={isReviewed}
              />
            </div>

            {/* Client COF override — only relevant when there's a COF */}
            {((parseFloat(form.cof_final) || 0) > 0 || form.client_cof_override) && (
              <div className="mb-3 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.client_cof_override}
                    onChange={(e) => {
                      setField('client_cof_override', e.target.checked)
                      if (!e.target.checked) setField('client_cof_hours', '')
                    }}
                    disabled={isReviewed}
                    className="w-3.5 h-3.5 rounded accent-gold"
                  />
                  <span className="text-xs text-dim">Charge different Call Out amount to client</span>
                </label>
                {form.client_cof_override && (
                  <div className="flex items-center gap-2 pl-5">
                    <label className="text-xs text-dim whitespace-nowrap">Client Call Out (hrs)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      placeholder={form.cof_final || '0'}
                      value={form.client_cof_hours}
                      onChange={(e) => setField('client_cof_hours', e.target.value)}
                      disabled={isReviewed}
                      className="w-24 px-2 py-1 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-surface"
                    />
                    <span className="text-xs text-dim">
                      vs crew {form.cof_final || '0'}h
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Hours worked breakdown */}
            {workedHoursCalc !== null && (
              <div className="mb-3 p-3 rounded-lg bg-panel/60 border border-wire space-y-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-dim">Hours worked</span>
                  <span className="font-mono text-warm">{workedHoursCalc.toFixed(2)}h</span>
                </div>
                {workedHoursCalc < 2 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-amber-400 bg-amber-500/15 px-2 py-0.5 rounded-full">Minimum Call Applied</span>
                    <span className="text-xs text-dim font-mono">2.00h</span>
                  </div>
                )}
                {(parseFloat(form.cof_final) || 0) > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-dim">Call Out Fee</span>
                    <span className="font-mono text-warm">+{(parseFloat(form.cof_final) || 0).toFixed(2)}h</span>
                  </div>
                )}
                <div className="flex items-center justify-between font-semibold pt-1.5 border-t border-wire">
                  <span className="text-parchment">Total paid per crew</span>
                  <span className="font-mono text-gold">
                    {(Math.max(2, workedHoursCalc) + (parseFloat(form.cof_final) || 0)).toFixed(2)}h
                  </span>
                </div>
              </div>
            )}

            {/* Individual Crew Hours */}
            {(crew.some((r) => r.employee_id) || casualCrew.some((r) => r.name.trim())) && (
              <div className="mb-3 pt-2 border-t border-wire">
                <p className="text-xs font-medium text-warm mb-2">Individual Crew Hours</p>
                <div className="space-y-2">
                  {crew.filter((r) => r.employee_id).map((r) => {
                    const emp = employees.find((e) => e.id === r.employee_id)
                    const cofFinalDisplay = form.cof_final.trim() ? (parseFloat(form.cof_final) || 0) : 0
                    const baseHrs = (() => {
                      const rawC = crewHasTime(r) ? calcCrewHours(r.start_time, r.end_time) : null
                      if (rawC !== null && rawC > 0) return Math.max(2, rawC)
                      if (form.actual_start_time && form.actual_finish_time) {
                        const [sh, sm] = form.actual_start_time.split(':').map(Number)
                        const [eh, em] = form.actual_finish_time.split(':').map(Number)
                        const rawMins = (eh * 60 + em) - (sh * 60 + sm) - (parseFloat(form.break_minutes) || 0)
                        if (rawMins > 0) return Math.max(2, Math.ceil(rawMins / 15) * 15 / 60)
                      }
                      const manual = parseFloat(r.hours) || 0
                      return manual > 0 ? Math.max(2, manual) : 0
                    })()
                    const cofHrs = r.cof_share ? cofFinalDisplay : 0
                    const hiHrs = r.heavy_item ? 0.5 : 0
                    const reviewHrs = (form.google_review && r.employee_id && form.google_review_employee_ids.includes(r.employee_id)) ? 0.5 : 0
                    const totalHrs = baseHrs + cofHrs + hiHrs + reviewHrs
                    const parts: string[] = []
                    if (baseHrs > 0) parts.push(`${baseHrs.toFixed(2)}h`)
                    if (cofHrs > 0) parts.push(`+${cofHrs.toFixed(2)} COF`)
                    if (hiHrs > 0) parts.push(`+0.50 HI`)
                    if (reviewHrs > 0) parts.push(`+0.50 ★`)
                    const summaryText = parts.join(' ') + (parts.length > 1 ? ` = ${totalHrs.toFixed(2)}h` : '')
                    return (
                      <div key={r._id} className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-dim w-20 truncate shrink-0">{emp?.name ?? '—'}</span>
                        <input
                          type="time"
                          value={r.start_time}
                          disabled={isReviewed}
                          onChange={(e) => setCrew((prev) => prev.map((c) => c._id === r._id ? { ...c, start_time: e.target.value } : c))}
                          className="text-xs bg-surface border border-wire rounded-lg px-2 py-1 text-parchment focus:border-gold-ring focus:outline-none disabled:opacity-50 shrink-0"
                        />
                        <input
                          type="time"
                          value={r.end_time}
                          disabled={isReviewed}
                          onChange={(e) => setCrew((prev) => prev.map((c) => c._id === r._id ? { ...c, end_time: e.target.value } : c))}
                          className="text-xs bg-surface border border-wire rounded-lg px-2 py-1 text-parchment focus:border-gold-ring focus:outline-none disabled:opacity-50 shrink-0"
                        />
                        <label className="flex items-center gap-1 cursor-pointer select-none shrink-0" title="Heavy Item +0.5h">
                          <input
                            type="checkbox"
                            checked={r.heavy_item}
                            disabled={isReviewed}
                            onChange={(e) => setCrew((prev) => prev.map((c) => c._id === r._id ? { ...c, heavy_item: e.target.checked } : c))}
                            className="w-3 h-3 rounded accent-gold"
                          />
                          <span className="text-xs text-dim">HI</span>
                        </label>
                        {summaryText && (
                          <span className="text-xs font-mono text-warm ml-auto whitespace-nowrap shrink-0">{summaryText}</span>
                        )}
                      </div>
                    )
                  })}
                  {casualCrew.filter((r) => r.name.trim()).map((r) => {
                    const hasTime = r.start_time.length === 5 && r.finish_time.length === 5
                    const cofFinalDisplay = form.cof_final.trim() ? (parseFloat(form.cof_final) || 0) : 0
                    const baseHrs = (() => {
                      const rawC = hasTime ? calcCrewHours(r.start_time, r.finish_time) : null
                      if (rawC !== null && rawC > 0) return Math.max(2, rawC)
                      if (form.actual_start_time && form.actual_finish_time) {
                        const [sh, sm] = form.actual_start_time.split(':').map(Number)
                        const [eh, em] = form.actual_finish_time.split(':').map(Number)
                        const rawMins = (eh * 60 + em) - (sh * 60 + sm) - (parseFloat(form.break_minutes) || 0)
                        if (rawMins > 0) return Math.max(2, Math.ceil(rawMins / 15) * 15 / 60)
                      }
                      return 0
                    })()
                    const cofHrs = r.cof_share ? cofFinalDisplay : 0
                    const hiHrs = r.heavy_item ? 0.5 : 0
                    const casualWorkerId = casualWorkers.find((cw) => cw.name.toLowerCase() === r.name.trim().toLowerCase())?.id
                    const reviewHrs = (form.google_review && casualWorkerId && form.google_review_employee_ids.includes(casualWorkerId)) ? 0.5 : 0
                    const totalHrs = baseHrs + cofHrs + hiHrs + reviewHrs
                    const parts: string[] = []
                    if (baseHrs > 0) parts.push(`${baseHrs.toFixed(2)}h`)
                    if (cofHrs > 0) parts.push(`+${cofHrs.toFixed(2)} COF`)
                    if (hiHrs > 0) parts.push(`+0.50 HI`)
                    if (reviewHrs > 0) parts.push(`+0.50 ★`)
                    const summaryText = parts.join(' ') + (parts.length > 1 ? ` = ${totalHrs.toFixed(2)}h` : '')
                    return (
                      <div key={r._id} className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-dim w-20 truncate shrink-0">{r.name}</span>
                        <input
                          type="time"
                          value={r.start_time}
                          disabled={isReviewed}
                          onChange={(e) => setCasualCrew((prev) => prev.map((c) => c._id === r._id ? { ...c, start_time: e.target.value } : c))}
                          className="text-xs bg-surface border border-wire rounded-lg px-2 py-1 text-parchment focus:border-gold-ring focus:outline-none disabled:opacity-50 shrink-0"
                        />
                        <input
                          type="time"
                          value={r.finish_time}
                          disabled={isReviewed}
                          onChange={(e) => setCasualCrew((prev) => prev.map((c) => c._id === r._id ? { ...c, finish_time: e.target.value } : c))}
                          className="text-xs bg-surface border border-wire rounded-lg px-2 py-1 text-parchment focus:border-gold-ring focus:outline-none disabled:opacity-50 shrink-0"
                        />
                        <label className="flex items-center gap-1 cursor-pointer select-none shrink-0" title="Heavy Item +0.5h">
                          <input
                            type="checkbox"
                            checked={r.heavy_item}
                            disabled={isReviewed}
                            onChange={(e) => setCasualCrew((prev) => prev.map((c) => c._id === r._id ? { ...c, heavy_item: e.target.checked } : c))}
                            className="w-3 h-3 rounded accent-gold"
                          />
                          <span className="text-xs text-dim">HI</span>
                        </label>
                        {summaryText && (
                          <span className="text-xs font-mono text-warm ml-auto whitespace-nowrap shrink-0">{summaryText}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Commission per crew member (visible while closing the job) */}
            {commissions.some((r) => r.employee_id || r.casual_worker_id) && (
              <div className="mb-3 pt-2 border-t border-wire">
                <p className="text-xs font-medium text-warm mb-2">Commission</p>
                <div className="space-y-1">
                  {commissions.filter((r) => r.employee_id || r.casual_worker_id).map((r) => {
                    const person = r.employee_id
                      ? employees.find((e) => e.id === r.employee_id)?.name
                      : casualWorkers.find((cw) => cw.id === r.casual_worker_id)?.name
                    const type = commissionTypes.find((t) => t.id === r.commission_type_id)
                    const hours = parseFloat(r.hours) || 0
                    const rate = parseFloat(r.rate_per_hour) || 0
                    const total = rate * hours
                    return (
                      <div key={r._id} className="flex items-center justify-between text-xs flex-wrap gap-1">
                        <span className="text-dim truncate">
                          {person ?? '—'}{type ? ` · ${type.name}` : ''}
                          {hours > 0 && <span className="text-dim/70"> ({hours}h × {fmt(rate)})</span>}
                        </span>
                        <span className="font-mono text-gold">{fmt(total)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Gross Job Value (percent subs only) */}
            {form.source === 'subcontract' && selectedSub?.billing_type === 'percent' && (
              <div className="mb-3 pt-2 border-t border-wire">
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Gross Job Value ($)"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.gross_job_value}
                    onChange={(e) => setField('gross_job_value', e.target.value)}
                    disabled={isReviewed}
                    placeholder="0.00"
                  />
                  <div>
                    <label className="block text-sm font-medium text-parchment mb-1">Malibu Revenue</label>
                    <p className="px-3 py-2 text-sm rounded-lg bg-panel border border-wire font-semibold text-gold">
                      {malibuRevenue !== null ? fmt(malibuRevenue) : '—'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Extra Men */}
            <div className="mb-3 pt-2 border-t border-wire">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-[#1a1a1a]">Extra Men</label>
                {!isReviewed && (
                  <button type="button" onClick={addExtraMan} className="flex items-center gap-1 text-xs text-gold hover:text-gold-bright font-medium">
                    <Plus size={13} /> Add Extra Man
                  </button>
                )}
              </div>
              {extraMen.length === 0 && <p className="text-xs text-dim opacity-100">No extra men added.</p>}
              <datalist id="extra-man-list">
                {employees.map((e) => <option key={`e-${e.id}`} value={e.name} />)}
                {casualWorkers.map((cw) => <option key={`c-${cw.id}`} value={cw.name} />)}
              </datalist>
              <div className="space-y-2">
                {extraMen.map((row) => {
                  const hasTime = row.start_time.length === 5 && row.finish_time.length === 5
                  const rawComputed = hasTime ? Math.max(0, calcCrewHours(row.start_time, row.finish_time)) : null
                  const baseHrs = rawComputed !== null && rawComputed > 0 ? Math.max(2, rawComputed) : rawComputed
                  const cofFinalDisplay = form.cof_final.trim() ? (parseFloat(form.cof_final) || 0) : 0
                  const cofHrs = (baseHrs !== null && row.cof_share) ? cofFinalDisplay : 0
                  const matchedId = resolveExtraMan(row.name)?.id
                  const reviewHrs = (baseHrs && form.google_review && matchedId && form.google_review_employee_ids.includes(matchedId)) ? 0.5 : 0
                  const totalHrs = baseHrs !== null ? baseHrs + cofHrs + reviewHrs : null
                  const parts: string[] = []
                  if (baseHrs !== null) parts.push(`${baseHrs.toFixed(2)}h`)
                  if (cofHrs > 0) parts.push(`+${cofHrs.toFixed(2)} COF`)
                  if (reviewHrs > 0) parts.push(`+0.50 ★`)
                  const computedLabel = totalHrs !== null
                    ? parts.join(' ') + (parts.length > 1 ? ` = ${totalHrs.toFixed(2)}h` : '')
                    : null
                  return (
                    <div key={row._id} className="flex items-center gap-2 flex-wrap">
                      <input
                        type="text"
                        list="extra-man-list"
                        value={row.name}
                        onChange={(e) => {
                          const val = e.target.value
                          updateExtraMan(row._id, 'name', val)
                          const match = resolveExtraMan(val)
                          if (match) updateExtraMan(row._id, 'rate_per_hour', match.rate.toString())
                        }}
                        onBlur={() => {
                          const name = row.name.trim()
                          if (!name || isReviewed) return
                          if (!resolveExtraMan(name) && !declinedCasualWorkerNamesRef.current.has(name.toLowerCase())) {
                            setPendingNewCasualWorker({ rowId: row._id, name, rate: parseFloat(row.rate_per_hour) || 0 })
                          }
                        }}
                        disabled={isReviewed}
                        placeholder="Person name…"
                        className="flex-1 min-w-[120px] px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-surface"
                      />
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-xs text-dim">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.50"
                          value={row.rate_per_hour}
                          onChange={(e) => updateExtraMan(row._id, 'rate_per_hour', e.target.value)}
                          disabled={isReviewed}
                          placeholder="0"
                          className="w-16 px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-surface"
                        />
                        <span className="text-xs text-dim">/hr</span>
                      </div>
                      <input type="time" value={row.start_time} onChange={(e) => updateExtraMan(row._id, 'start_time', e.target.value)} disabled={isReviewed} className="w-28 px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-surface" />
                      <span className="text-dim text-xs">–</span>
                      <input type="time" value={row.finish_time} onChange={(e) => updateExtraMan(row._id, 'finish_time', e.target.value)} disabled={isReviewed} className="w-28 px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-surface" />
                      <label className="flex items-center gap-1 cursor-pointer select-none shrink-0" title="Include Call Out Fee">
                        <input
                          type="checkbox"
                          checked={row.cof_share}
                          disabled={isReviewed}
                          onChange={(e) => updateExtraMan(row._id, 'cof_share', e.target.checked)}
                          className="w-3 h-3 rounded accent-gold"
                        />
                        <span className="text-xs text-dim">COF</span>
                      </label>
                      {computedLabel && <span className="text-xs font-mono text-warm tabular-nums whitespace-nowrap">{computedLabel}</span>}
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-xs text-dim whitespace-nowrap">Client rate $</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.client_rate_per_hour}
                          onChange={(e) => updateExtraMan(row._id, 'client_rate_per_hour', e.target.value)}
                          disabled={isReviewed}
                          placeholder="0.00"
                          title="Hourly rate charged to the client for this extra man — total = hours × rate"
                          className="w-20 px-2 py-1 text-xs border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-surface"
                        />
                        <span className="text-xs text-dim">/hr</span>
                        {baseHrs !== null && (parseFloat(row.client_rate_per_hour) || 0) > 0 && (
                          <span className="text-xs text-success font-medium whitespace-nowrap">= {fmt(baseHrs * (parseFloat(row.client_rate_per_hour) || 0))}</span>
                        )}
                      </div>
                      {!isReviewed && (
                        <button type="button" onClick={() => removeExtraMan(row._id)} className="text-dim hover:text-danger">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Completion notes */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-[#1a1a1a]">Completion Notes</label>
                <label className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-dim border border-wire rounded-lg hover:bg-panel cursor-pointer">
                  <ImagePlus size={13} />
                  Photo
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploadingPhoto || isReviewed}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) { uploadPhoto(f, 'completion'); e.target.value = '' } }}
                  />
                </label>
              </div>
              <textarea
                rows={2}
                value={form.completion_notes ?? ''}
                onChange={(e) => setField('completion_notes', e.target.value)}
                disabled={isReviewed}
                placeholder="e.g. Job took longer due to access issues"
                className="w-full px-3 py-2 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-surface disabled:text-dim"
              />
              {/* Inline preview of completion photos */}
              {photos.filter((p) => p.category === 'completion').length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {photos.filter((p) => p.category === 'completion').map((p) => (
                    <div key={p._id} className="relative group w-20 h-14 rounded-lg overflow-hidden bg-wire/30 shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={p.caption || 'Completion photo'} className="w-full h-full object-cover" />
                      {!isReviewed && (
                        <button
                          type="button"
                          onClick={() => removePhoto(p._id)}
                          className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Remove"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Google Review */}
            <div className="mb-3 pt-3 border-t border-wire">
              <label className="flex items-center gap-2 text-sm font-medium text-[#1a1a1a] cursor-pointer mb-2">
                <input
                  type="checkbox"
                  checked={form.google_review}
                  onChange={(e) => {
                    setField('google_review', e.target.checked)
                    if (!e.target.checked) setField('google_review_employee_ids', [])
                  }}
                  disabled={isReviewed}
                  className="rounded"
                />
                <Star size={14} className="text-gold" />
                Google Review received
              </label>
              {form.google_review && (
                <div className="space-y-2 pl-1">
                  <div>
                    <p className="text-xs text-[#1a1a1a] mb-1.5">Who received the review <span className="text-gold">(+0.5h each)</span></p>
                    <div className="flex flex-wrap gap-1.5">
                      {(() => {
                        const crewEmpIds = crew.filter((r) => r.employee_id).map((r) => r.employee_id)
                        const extraMenEmpIds = extraMen
                          .map((r) => resolveExtraMan(r.name)?.id)
                          .filter((id): id is string => !!id)
                        const legacyId = form.extra_man_employee_id && !crewEmpIds.includes(form.extra_man_employee_id) && !extraMenEmpIds.includes(form.extra_man_employee_id) ? form.extra_man_employee_id : null
                        const casualReviewIds = casualCrew
                          .filter((r) => r.name.trim())
                          .map((r) => casualWorkers.find((cw) => cw.name.toLowerCase() === r.name.trim().toLowerCase())?.id)
                          .filter((id): id is string => !!id)
                        const allIds = [...new Set([...crewEmpIds, ...extraMenEmpIds, ...(legacyId ? [legacyId] : []), ...casualReviewIds])]
                        return allIds.map((id) => {
                          const staffEmp = employees.find((e) => e.id === id)
                          const casualWorker = staffEmp ? null : casualWorkers.find((cw) => cw.id === id)
                          const name = staffEmp?.name ?? casualWorker?.name
                          if (!name) return null
                          const isCasual = !staffEmp
                          const isExtra = !isCasual && !crewEmpIds.includes(id)
                          const checked = form.google_review_employee_ids.includes(id)
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => setField(
                                'google_review_employee_ids',
                                checked
                                  ? form.google_review_employee_ids.filter((rid) => rid !== id)
                                  : [...form.google_review_employee_ids, id]
                              )}
                              disabled={isReviewed}
                              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                                checked ? 'bg-gold/10 text-gold border-gold-ring' : 'bg-panel text-warm border-wire hover:border-gold-ring'
                              }`}
                            >
                              {checked ? '★ ' : ''}{name}{isExtra ? ' (extra)' : ''}{isCasual ? ' (casual)' : ''}
                            </button>
                          )
                        })
                      })()}
                      {crew.filter((r) => r.employee_id).length === 0 && extraMen.filter((r) => r.name.trim()).length === 0 && !form.extra_man_employee_id && casualCrew.filter((r) => r.name.trim()).length === 0 && (
                        <p className="text-xs text-dim">Add crew members above to select recipients.</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-[#1a1a1a] mb-1.5">Screenshot (optional)</p>
                    <label className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gold border border-gold-ring/50 rounded-lg hover:bg-gold/8 cursor-pointer w-fit">
                      <ImagePlus size={13} />
                      {uploadingPhoto ? 'Uploading…' : 'Upload screenshot'}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploadingPhoto || isReviewed}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) { uploadPhoto(f, 'google_review'); e.target.value = '' } }}
                      />
                    </label>
                    {photos.filter((p) => p.category === 'google_review').length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {photos.filter((p) => p.category === 'google_review').map((p) => (
                          <div key={p._id} className="relative group w-20 h-14 rounded-lg overflow-hidden bg-wire/30 shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.url} alt="Review screenshot" className="w-full h-full object-cover" />
                            {!isReviewed && (
                              <button type="button" onClick={() => removePhoto(p._id)} className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity" aria-label="Remove">
                                <X size={10} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Expenses */}
            <div className="mb-3 pt-2 border-t border-wire">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-warm">Expenses</label>
                {!isReviewed && (
                  <button type="button" onClick={addExpense} className="flex items-center gap-1 text-xs text-gold hover:text-gold-bright font-medium">
                    <Plus size={13} /> Add Expense
                  </button>
                )}
              </div>
              {expenses.length === 0 && <p className="text-xs text-dim">No expenses added.</p>}
              <div className="space-y-2">
                {expenses.map((row) => (
                  <div key={row._id} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Description"
                      value={row.description}
                      onChange={(e) => updateExpense(row._id, 'description', e.target.value)}
                      disabled={isReviewed}
                      className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-surface disabled:text-dim"
                    />
                    <div className="relative w-24 shrink-0">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-dim pointer-events-none">$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={row.amount}
                        onChange={(e) => updateExpense(row._id, 'amount', e.target.value)}
                        disabled={isReviewed}
                        className="w-full pl-5 pr-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-surface disabled:text-dim"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => !isReviewed && updateExpense(row._id, 'is_client_expense', !row.is_client_expense)}
                      disabled={isReviewed}
                      title={row.is_client_expense ? 'Charged to client — click to make internal' : 'Internal cost — click to charge to client'}
                      className={`shrink-0 text-xs px-2 py-1.5 rounded-lg font-medium border transition-colors whitespace-nowrap ${row.is_client_expense ? 'border-gold/60 text-gold bg-gold/10' : 'border-wire text-dim'} disabled:cursor-default`}
                    >
                      {row.is_client_expense ? 'Client' : 'Internal'}
                    </button>
                    {!isReviewed && (
                      <button type="button" onClick={() => removeExpense(row._id)} className="shrink-0 p-1 text-dim hover:text-danger transition-colors">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {expenses.length > 0 && (
                <div className="mt-2 pt-2 border-t border-wire/50 space-y-1">
                  {expenses.some((e) => e.is_client_expense && parseFloat(e.amount) > 0) && (
                    <div className="flex justify-between text-xs">
                      <span className="text-dim">Client expenses (added to revenue)</span>
                      <span className="text-success font-medium">+{fmt(expenses.filter((e) => e.is_client_expense).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0))}</span>
                    </div>
                  )}
                  {expenses.some((e) => !e.is_client_expense && parseFloat(e.amount) > 0) && (
                    <div className="flex justify-between text-xs">
                      <span className="text-dim">Company expenses (reduces profit)</span>
                      <span className="text-danger font-medium">−{fmt(expenses.filter((e) => !e.is_client_expense).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0))}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Paid by Employee — out-of-pocket spend (e.g. a parking ticket)
                that must be reimbursed to the crew member on their invoice/payroll */}
            <div className="mb-3 pt-2 border-t border-wire">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-warm">Paid by Employee</label>
                {!isReviewed && (
                  <button type="button" onClick={addEmployeeExpense} className="flex items-center gap-1 text-xs text-gold hover:text-gold-bright font-medium">
                    <Plus size={13} /> Add
                  </button>
                )}
              </div>
              {employeeExpenses.length === 0 && <p className="text-xs text-dim">No reimbursements added.</p>}
              <div className="space-y-2">
                {employeeExpenses.map((row) => (
                  <div key={row._id} className="flex items-center gap-2 flex-wrap">
                    <select
                      value={row.casual_worker_id ? `casual:${row.casual_worker_id}` : row.employee_id ? `staff:${row.employee_id}` : ''}
                      onChange={(e) => {
                        const val = e.target.value
                        const [type, id] = val.split(':')
                        setEmployeeExpenses((rows) => rows.map((r) => r._id === row._id ? {
                          ...r,
                          employee_id: type === 'staff' ? id : '',
                          casual_worker_id: type === 'casual' ? id : '',
                        } : r))
                      }}
                      disabled={isReviewed}
                      className="flex-1 min-w-[120px] px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-surface disabled:text-dim"
                    >
                      <option value="">Select employee…</option>
                      <optgroup label="Staff">
                        {employees.map((e) => (
                          <option key={e.id} value={`staff:${e.id}`}>{e.name}</option>
                        ))}
                      </optgroup>
                      {casualWorkers.length > 0 && (
                        <optgroup label="Casual Workers">
                          {casualWorkers.map((cw) => (
                            <option key={cw.id} value={`casual:${cw.id}`}>{cw.name}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <input
                      type="text"
                      placeholder="What was paid for (e.g. parking ticket)"
                      value={row.description}
                      onChange={(e) => updateEmployeeExpense(row._id, 'description', e.target.value)}
                      disabled={isReviewed}
                      className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-surface disabled:text-dim"
                    />
                    <div className="relative w-24 shrink-0">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-dim pointer-events-none">$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={row.amount}
                        onChange={(e) => updateEmployeeExpense(row._id, 'amount', e.target.value)}
                        disabled={isReviewed}
                        className="w-full pl-5 pr-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-surface disabled:text-dim"
                      />
                    </div>
                    {!isReviewed && (
                      <button type="button" onClick={() => removeEmployeeExpense(row._id)} className="shrink-0 p-1 text-dim hover:text-danger transition-colors">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {employeeExpenses.some((r) => (r.employee_id || r.casual_worker_id) && parseFloat(r.amount) > 0) && (
                <div className="mt-2 pt-2 border-t border-wire/50">
                  <div className="flex justify-between text-xs">
                    <span className="text-dim">Total to reimburse (added to their invoice)</span>
                    <span className="text-success font-medium">
                      +{fmt(employeeExpenses.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0))}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Deposit (private jobs only) */}
            {form.source === 'private' && (
              <div className="mb-3 pt-2 border-t border-wire">
                <Input
                  id="rfv-deposit"
                  label="Deposit ($)"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.deposit}
                  onChange={(e) => setField('deposit', e.target.value)}
                  disabled={isReviewed}
                  placeholder="0.00"
                />
              </div>
            )}

            {!isReviewed && (
              <button
                onClick={handleMarkReviewed}
                disabled={markingReviewed}
                className="w-full py-2 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors disabled:opacity-50"
              >
                {markingReviewed ? 'Marking…' : 'Confirm & Complete Job'}
              </button>
            )}
          </div>
        )}

        {/* ── Job Summary (completion view) ─────────────────────────────── */}
        {isCompletionMode && summary && (
          <Card title="Job Summary">
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-dim">Revenue (inc. GST)</span>
                <span className="font-semibold text-parchment">{fmt(summary.totalRevenue)}</span>
              </div>
              {summary.clientExpensesTotal > 0 && (
                <div className="flex justify-between text-xs pl-2">
                  <span className="text-dim">incl. Client Expenses</span>
                  <span className="text-success">+{fmt(summary.clientExpensesTotal)}</span>
                </div>
              )}
              {summary.heavyItemCharge > 0 && (
                <div className="flex justify-between text-xs pl-2">
                  <span className="text-dim">incl. Heavy Item</span>
                  <span className="text-success">+{fmt(summary.heavyItemCharge)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-dim">GST (10%)</span>
                <span className="text-danger">−{fmt(summary.gstAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dim">Net Revenue</span>
                <span className="text-warm">{fmt(summary.netRevenue)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dim">Payroll</span>
                <span className="text-orange-600">−{fmt(summary.payrollTotal)}</span>
              </div>
              {summary.companyExpensesTotal > 0 && (
                <div className="flex justify-between">
                  <span className="text-dim">Company Expenses</span>
                  <span className="text-danger">−{fmt(summary.companyExpensesTotal)}</span>
                </div>
              )}
              {summary.discount > 0 && (
                <div className="flex justify-between">
                  <span className="text-dim">Discount</span>
                  <span className="text-danger">−{fmt(summary.discount)}</span>
                </div>
              )}
              <div className={`flex justify-between pt-2 border-t border-wire font-bold ${summary.profit >= 0 ? 'text-success' : 'text-danger'}`}>
                <span>Profit</span>
                <span>{fmt(summary.profit)}{summary.margin !== null ? ` (${(summary.margin * 100).toFixed(1)}%)` : ''}</span>
              </div>
              {summary.deposit > 0 && (
                <div className="mt-3 pt-3 border-t border-wire space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-dim">Deposit Paid</span>
                    <span className="text-success font-medium">{fmt(summary.deposit)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-semibold">
                    <span className="text-parchment">Balance Due</span>
                    <span className="text-warm">{fmt(Math.max(0, summary.totalRevenue - summary.deposit))}</span>
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* ── Job Info ──────────────────────────────────────────────────── */}
        <Card title="Job Info">
          <div className="mb-3">
            <Input
              label="Job ID"
              value={form.reference_number ?? ''}
              onChange={(e) => setField('reference_number', e.target.value)}
              placeholder="e.g. JOB-001 (optional)"
              disabled={isReviewed}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Input
              label="Job #"
              value={form.job_number ?? ''}
              onChange={(e) => setField('job_number', e.target.value)}
              placeholder="100001"
              disabled={isReviewed}
            />
            <Input
              label="Date"
              type="date"
              value={form.date ?? ''}
              onChange={(e) => setField('date', e.target.value)}
              disabled={isReviewed}
            />
            <Input
              label="Start Time"
              type="time"
              value={form.scheduled_time ?? ''}
              onChange={(e) => setField('scheduled_time', e.target.value)}
              disabled={isReviewed}
            />
            <Input
              label="Finish Time"
              type="time"
              value={form.scheduled_finish_time ?? ''}
              onChange={(e) => setField('scheduled_finish_time', e.target.value)}
              disabled={isReviewed}
            />
          </div>
          {form.scheduled_time && form.scheduled_finish_time && (() => {
            const dur = calcCrewHours(form.scheduled_time, form.scheduled_finish_time)
            return dur > 0 ? <p className="mt-1.5 text-xs text-dim">Est. duration: {dur}h</p> : null
          })()}
          {isEdit && (
            <div className="mt-3">
              <label className="block text-sm font-medium text-warm mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => setField('status', e.target.value as JobStatus)}
                className="w-full sm:w-48 px-3 py-2 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
              >
                {(Object.entries(STATUS_LABEL) as [JobStatus, string][]).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
          )}
        </Card>

        {/* ── Entity + Billing ─────────────────────────────────────────── */}
        {renderEntityCard(isReviewed)}

        {/* ── Location ─────────────────────────────────────────────────── */}
        <Card title="Location">
          {form.source === 'subcontract' && (
            <div ref={customerRef} className="relative mb-3">
              <label className="block text-sm font-medium text-warm mb-1">
                Customer <span className="text-dim font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={customerSearch}
                onFocus={() => setShowCustomerDrop(true)}
                onChange={(e) => { setCustomerSearch(e.target.value); setField('customer_id', ''); setShowCustomerDrop(true) }}
                placeholder="Search customers…"
                disabled={isReviewed}
                className="w-full px-3 py-2 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-panel"
              />
              {showCustomerDrop && (
                <div className="absolute z-20 w-full mt-1 bg-surface border border-wire rounded-lg shadow-lg max-h-44 overflow-y-auto">
                  <button type="button" onClick={() => { setField('customer_id', ''); setCustomerSearch(''); setShowCustomerDrop(false) }} className="w-full text-left px-3 py-2 text-sm text-dim hover:bg-panel">
                    No customer
                  </button>
                  {filteredCustomers.map((c) => (
                    <button key={c.id} type="button" onClick={() => { setField('customer_id', c.id); setCustomerSearch(c.name); setShowCustomerDrop(false) }} className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-baseline gap-2">
                      <span className="font-medium">{c.name}</span>
                      {c.phone && <span className="text-dim text-xs">{c.phone}</span>}
                      {!c.phone && c.contact_info && <span className="text-dim text-xs">{c.contact_info}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <AddressInput label="Pickup Address" value={form.pickup_address ?? ''} onValueChange={(v) => setField('pickup_address', v)} placeholder="123 Main St, Sydney" disabled={isReviewed} />
            <AddressInput label="Delivery Address" value={form.delivery_address ?? ''} onValueChange={(v) => setField('delivery_address', v)} placeholder="45 Park Ave, Sydney" disabled={isReviewed} />
          </div>

          {/* Extra pickup/dropoff stops — informational only, no billing/distance impact */}
          {extraAddresses.length > 0 && (
            <div className="mt-3 pt-3 border-t border-wire space-y-2">
              {extraAddresses.map((row) => (
                <div key={row._id} className="flex items-center gap-2">
                  <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full ${row.address_type === 'pickup' ? 'bg-blue-500/15 text-blue-300' : 'bg-orange-500/15 text-orange-300'}`}>
                    {row.address_type === 'pickup' ? 'Pickup' : 'Drop-off'}
                  </span>
                  <input
                    type="text"
                    value={row.address}
                    onChange={(e) => updateExtraAddress(row._id, e.target.value)}
                    disabled={isReviewed}
                    placeholder="Additional address…"
                    className="flex-1 px-3 py-2 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-panel disabled:text-dim"
                  />
                  {!isReviewed && (
                    <button type="button" onClick={() => removeExtraAddress(row._id)} className="text-dim hover:text-danger shrink-0">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {!isReviewed && (
            <div className="mt-3 flex items-center gap-4">
              <button type="button" onClick={() => addExtraAddress('pickup')} className="flex items-center gap-1 text-xs text-gold hover:text-gold-bright font-medium">
                <Plus size={13} /> Add pickup stop
              </button>
              <button type="button" onClick={() => addExtraAddress('dropoff')} className="flex items-center gap-1 text-xs text-gold hover:text-gold-bright font-medium">
                <Plus size={13} /> Add drop-off stop
              </button>
            </div>
          )}
        </Card>

        {/* ── Extra Men (in_progress only — completion shows inside Final Review) */}
        {showExtraMen && !isCompletionMode && (
          <Card title="Extra Men" action={
            <button type="button" onClick={addExtraMan} className="flex items-center gap-1 text-xs text-gold hover:text-gold-bright font-medium">
              <Plus size={14} /> Add
            </button>
          }>
            {extraMen.length === 0 && <p className="text-sm text-dim text-center py-2">No extra men added.</p>}
            <datalist id="extra-man-list">
              {employees.map((e) => <option key={`e-${e.id}`} value={e.name} />)}
              {casualWorkers.map((cw) => <option key={`c-${cw.id}`} value={cw.name} />)}
            </datalist>
            <div className="space-y-2">
              {extraMen.map((row) => {
                const hasTime = row.start_time.length === 5 && row.finish_time.length === 5
                const computed = hasTime ? Math.max(0, calcCrewHours(row.start_time, row.finish_time)) : null
                return (
                  <div key={row._id} className="flex items-center gap-2 flex-wrap">
                    <input
                      type="text"
                      list="extra-man-list"
                      value={row.name}
                      onChange={(e) => {
                        const val = e.target.value
                        updateExtraMan(row._id, 'name', val)
                        const match = resolveExtraMan(val)
                        if (match) updateExtraMan(row._id, 'rate_per_hour', match.rate.toString())
                      }}
                      onBlur={() => {
                        const name = row.name.trim()
                        if (!name) return
                        if (!resolveExtraMan(name) && !declinedCasualWorkerNamesRef.current.has(name.toLowerCase())) {
                          setPendingNewCasualWorker({ rowId: row._id, name, rate: parseFloat(row.rate_per_hour) || 0 })
                        }
                      }}
                      placeholder="Person name…"
                      className="flex-1 min-w-[120px] px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
                    />
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs text-dim">$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.50"
                        value={row.rate_per_hour}
                        onChange={(e) => updateExtraMan(row._id, 'rate_per_hour', e.target.value)}
                        placeholder="0"
                        className="w-16 px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
                      />
                      <span className="text-xs text-dim">/hr</span>
                    </div>
                    <input type="time" value={row.start_time} onChange={(e) => updateExtraMan(row._id, 'start_time', e.target.value)} className="w-28 px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring" />
                    <span className="text-dim text-xs">–</span>
                    <input type="time" value={row.finish_time} onChange={(e) => updateExtraMan(row._id, 'finish_time', e.target.value)} className="w-28 px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring" />
                    {computed !== null && <span className="text-sm text-dim tabular-nums w-10">{computed}h</span>}
                    <label className="flex items-center gap-1 cursor-pointer select-none shrink-0" title="Include Call Out Fee">
                      <input
                        type="checkbox"
                        checked={row.cof_share}
                        onChange={(e) => updateExtraMan(row._id, 'cof_share', e.target.checked)}
                        className="w-3 h-3 rounded accent-gold"
                      />
                      <span className="text-xs text-dim">COF</span>
                    </label>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs text-dim whitespace-nowrap">Client rate $</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.client_rate_per_hour}
                        onChange={(e) => updateExtraMan(row._id, 'client_rate_per_hour', e.target.value)}
                        placeholder="0.00"
                        title="Hourly rate charged to the client for this extra man — total = hours × rate"
                        className="w-20 px-2 py-1 text-xs border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
                      />
                      <span className="text-xs text-dim">/hr</span>
                      {computed !== null && (parseFloat(row.client_rate_per_hour) || 0) > 0 && (
                        <span className="text-xs text-success font-medium whitespace-nowrap">= {fmt(computed * (parseFloat(row.client_rate_per_hour) || 0))}</span>
                      )}
                    </div>
                    <button type="button" onClick={() => removeExtraMan(row._id)} className="text-dim hover:text-danger">
                      <Trash2 size={15} />
                    </button>
                  </div>
                )
              })}
            </div>
          </Card>
        )}

        {/* ── Crew ─────────────────────────────────────────────────────── */}
        {renderCrewCard(!isBooking, isReviewed)}

        {/* ── Casual / Packing Crew ────────────────────────────────────── */}
        {renderCasualCrewCard(isReviewed)}

        {/* ── Commissions ──────────────────────────────────────────────── */}
        {renderCommissionsCard(isReviewed)}

        {/* ── Materials ────────────────────────────────────────────────── */}
        {renderMaterialsCard(isReviewed)}

        {/* ── Photos ───────────────────────────────────────────────────── */}
        {renderPhotosCard(
          isBooking
            ? ['inventory']
            : ['inventory', 'completion', 'damage', 'receipt', 'google_review'],
          isReviewed
        )}

        {/* ── Notes ────────────────────────────────────────────────────── */}
        <Card title="Notes">
          {(isInProgress || isCompletionMode) && (
            <div className="mb-3">
              <Input label="Discount ($)" type="number" min="0" step="0.01" value={form.discount ?? ''} onChange={(e) => setField('discount', e.target.value)} placeholder="0.00" disabled={isReviewed} />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-warm mb-1">Notes</label>
            <textarea
              rows={8}
              value={form.notes ?? ''}
              onChange={(e) => setField('notes', e.target.value)}
              disabled={isReviewed}
              placeholder="e.g. EASTWOOD › EPPING"
              className="w-full px-3 py-2 text-base leading-relaxed border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring disabled:bg-panel disabled:text-dim resize-y"
            />
          </div>
        </Card>

        {/* ── Comments ─────────────────────────────────────────────────── */}
        {isEdit && (
          <Card title="Comments">
            <div className="space-y-3">
              {comments.length === 0 && (
                <p className="text-sm text-dim text-center py-2">No comments yet.</p>
              )}
              {comments.map((c) => (
                <div key={c.id} className="flex gap-2">
                  <div className="w-7 h-7 rounded-full bg-gold/15 text-gold text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">
                    {c.author_name.trim().slice(0, 1).toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0 bg-panel rounded-lg px-3 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-parchment truncate">{c.author_name}</span>
                      <span className="text-xs text-dim shrink-0">
                        {new Date(c.created_at).toLocaleString('en-AU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-sm text-warm whitespace-pre-wrap break-words">{c.body}</p>
                  </div>
                </div>
              ))}
              <div className="pt-2 border-t border-wire space-y-2">
                <input
                  type="text"
                  value={commentAuthor}
                  onChange={(e) => setCommentAuthor(e.target.value)}
                  placeholder="Your name"
                  className="w-40 px-2 py-1.5 text-xs border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
                />
                <div className="flex gap-2">
                  <textarea
                    rows={2}
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Write a comment…"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        postComment()
                      }
                    }}
                    className="flex-1 px-3 py-2 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring resize-y"
                  />
                  <Button
                    onClick={postComment}
                    disabled={postingComment || !commentText.trim() || !commentAuthor.trim()}
                    className="self-end"
                  >
                    {postingComment ? 'Posting…' : 'Post'}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        {error && (
          <div className="bg-danger/10 border border-danger/30 text-danger text-sm px-4 py-3 rounded-lg">{error}</div>
        )}
      </div>

      {/* ── Sticky footer ────────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 lg:left-56 bg-surface border-t border-wire shadow-xl z-10">
        <div className="px-4 lg:px-6 py-3 flex items-center justify-between gap-3 max-w-2xl">
          {/* Summary numbers — only when we have data */}
          <div className="flex items-center gap-5 min-w-0">
            {summary && (
              <>
                <SummaryCell label="Revenue" value={fmt(summary.totalRevenue)} color="text-parchment" />
                <SummaryCell label="Payroll" value={fmt(summary.payrollTotal)} color="text-warm" />
                <SummaryCell
                  label="Profit"
                  value={`${fmt(summary.profit)}${summary.margin !== null ? ` (${(summary.margin * 100).toFixed(1)}%)` : ''}`}
                  color={summary.profit >= 0 ? 'text-success' : 'text-danger'}
                />
              </>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 shrink-0">
            {/* New job — always in edit mode */}
            {!isEdit && (
              <>
                <Button onClick={() => handleSaveWithStatus('draft')} disabled={saving} size="md" variant="ghost">
                  Save as Draft
                </Button>
                <Button onClick={() => handleSaveWithStatus('scheduled')} disabled={saving} size="md" variant="secondary">
                  {saving ? 'Saving…' : 'Schedule'}
                </Button>
                <Button onClick={() => handleSaveWithStatus('confirmed')} disabled={saving} size="md">
                  {saving ? 'Saving…' : 'Book'}
                </Button>
              </>
            )}

            {/* Existing job — view mode: just Edit */}
            {isEdit && isViewMode && (
              <Button onClick={() => setIsViewMode(false)} size="md" variant="secondary">
                Edit
              </Button>
            )}

            {/* Existing job — edit mode: Cancel + status-specific saves */}
            {isEdit && !isViewMode && form.status === 'draft' && (
              <>
                <Button onClick={() => setIsViewMode(true)} disabled={saving} size="md" variant="ghost">Cancel</Button>
                <Button onClick={() => handleSaveWithStatus('draft')} disabled={saving} size="md" variant="ghost">
                  Save Draft
                </Button>
                <Button onClick={() => handleSaveWithStatus('scheduled')} disabled={saving} size="md" variant="secondary">
                  Schedule
                </Button>
                <Button onClick={() => handleSaveWithStatus('confirmed')} disabled={saving} size="md">
                  {saving ? 'Saving…' : 'Book'}
                </Button>
              </>
            )}

            {isEdit && !isViewMode && form.status === 'scheduled' && (
              <>
                <Button onClick={() => setIsViewMode(true)} disabled={saving} size="md" variant="ghost">Cancel</Button>
                <Button onClick={handleSave} disabled={saving} size="md" variant="secondary">
                  {saving ? 'Saving…' : 'Update'}
                </Button>
                <Button onClick={() => handleSaveWithStatus('confirmed')} disabled={saving} size="md" variant="secondary">
                  Book
                </Button>
                <Button onClick={() => handleSaveWithStatus('in_progress')} disabled={saving} size="md">
                  {saving ? 'Saving…' : 'Start Job'}
                </Button>
              </>
            )}

            {isEdit && !isViewMode && form.status === 'confirmed' && (
              <>
                <Button onClick={() => setIsViewMode(true)} disabled={saving} size="md" variant="ghost">Cancel</Button>
                <Button onClick={handleSave} disabled={saving} size="md" variant="secondary">
                  {saving ? 'Saving…' : 'Update'}
                </Button>
                <Button onClick={() => handleSaveWithStatus('in_progress')} disabled={saving} size="md">
                  {saving ? 'Saving…' : 'Start Job'}
                </Button>
              </>
            )}

            {isEdit && !isViewMode && form.status === 'in_progress' && (
              <>
                <Button onClick={() => setIsViewMode(true)} disabled={saving} size="md" variant="ghost">Cancel</Button>
                <Button onClick={handleSave} disabled={saving} size="md" variant="secondary">
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                <Button onClick={() => handleSaveWithStatus('completed')} disabled={saving} size="md" className="bg-green-600 hover:bg-green-700 border-green-600">
                  {saving ? 'Saving…' : 'Complete Job'}
                </Button>
              </>
            )}

            {isEdit && !isViewMode && form.status === 'completed' && (
              <>
                <Button onClick={() => setIsViewMode(true)} disabled={saving} size="md" variant="ghost">Cancel</Button>
                <Button onClick={handleSave} disabled={saving} size="md" variant="secondary">
                  {saving ? 'Saving…' : 'Save Changes'}
                </Button>
              </>
            )}

            {isEdit && !isViewMode && form.status === 'reviewed' && (
              <>
                <Button onClick={() => setIsViewMode(true)} disabled={saving} size="md" variant="ghost">Cancel</Button>
                <Button onClick={() => handleSaveWithStatus('invoiced')} disabled={saving} size="md" className="bg-purple-600 hover:bg-purple-700 border-purple-600">
                  <FileText size={15} />
                  {saving ? 'Saving…' : 'Send Invoice'}
                </Button>
                <Button onClick={handleSave} disabled={saving} size="md">
                  {saving ? 'Saving…' : 'Save Changes'}
                </Button>
              </>
            )}

            {isEdit && !isViewMode && (form.status === 'invoiced' || form.status === 'paid') && (
              <>
                <Button onClick={() => setIsViewMode(true)} disabled={saving} size="md" variant="ghost">Cancel</Button>
                <Button onClick={handleSave} disabled={saving} size="md">
                  {saving ? 'Saving…' : 'Save Changes'}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Cancel Job modal */}
      <Modal open={cancelModalOpen} onClose={() => setCancelModalOpen(false)} title={`Cancel Job #${form.job_number}`}>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-dim uppercase tracking-wide mb-3">Minimum Charge</p>
            <label className="flex items-center gap-2 text-sm font-medium text-warm cursor-pointer mb-3">
              <input
                type="checkbox"
                checked={form.minimum_charge_applied}
                onChange={(e) => setField('minimum_charge_applied', e.target.checked)}
                className="rounded"
              />
              Apply minimum charge?
            </label>
            {form.minimum_charge_applied && (
              <Input
                label="Amount ($)"
                type="number"
                min="0"
                step="0.01"
                value={form.minimum_charge_amount ?? ''}
                onChange={(e) => setField('minimum_charge_amount', e.target.value)}
                placeholder="0.00"
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-warm mb-1">Cancellation Reason</label>
            <textarea
              rows={3}
              value={form.cancellation_reason ?? ''}
              onChange={(e) => setField('cancellation_reason', e.target.value)}
              placeholder="e.g. Client cancelled last minute"
              className="w-full px-3 py-2 text-sm border border-wire rounded-lg focus:outline-none focus:border-danger/60 focus:ring-1 focus:ring-danger/40"
            />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2 pt-2">
            <Button onClick={handleCancelJob} disabled={saving} variant="danger" className="flex-1">
              {saving ? 'Cancelling…' : 'Confirm Cancellation'}
            </Button>
            <Button variant="secondary" onClick={() => setCancelModalOpen(false)} className="flex-1">Keep Job</Button>
          </div>
        </div>
      </Modal>

      {/* New casual worker registration prompt */}
      <Modal
        open={pendingNewCasualWorker !== null}
        onClose={declineNewCasualWorker}
        title="New Casual Worker?"
      >
        <p className="text-sm text-parchment mb-4">
          <strong>{pendingNewCasualWorker?.name}</strong> is not in the Casual Workers list.
          Would you like to add them now with a rate of{' '}
          <strong>${pendingNewCasualWorker?.rate ?? 0}/hr</strong>?
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" type="button" onClick={declineNewCasualWorker}>
            No, just for this job
          </Button>
          <Button type="button" onClick={confirmNewCasualWorker}>
            Yes, add them
          </Button>
        </div>
      </Modal>
    </div>
  )
}

// ─── Small helpers ────────────────────────────────────────────────────────────
function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-xl border border-wire p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-dim uppercase tracking-wide">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

function SummaryCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-dim">{label}</div>
      <div className={`text-sm font-bold truncate ${color}`}>{value}</div>
    </div>
  )
}
