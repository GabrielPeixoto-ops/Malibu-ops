'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, Trash2, ChevronLeft, ImagePlus, CheckCircle, Lock,
  X, Star, Banknote, FileText, XCircle,
} from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { calculateJobSummary, extractFormulaVars, type JobSummary, type PrivateRateInput } from '@/lib/billing'
import type {
  Contract,
  ContractClient,
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
} from '@/types/database'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Modal from '@/components/ui/Modal'

// ─── Local types ──────────────────────────────────────────────────────────────
interface CrewRow {
  _id: string
  employee_id: string
  hours: string
  start_time: string
  end_time: string
  cof_share: boolean
  cof_hours: string
}

function calcCrewHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const mins = (eh * 60 + em) - (sh * 60 + sm)
  return Math.round((mins / 60) * 100) / 100
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

interface PhotoLocal {
  _id: string
  dbId?: string
  url: string
  caption: string
  storagePath?: string
  category: string
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
  const [customers, setCustomers] = useState<Customer[]>([])
  const [contracts, setContracts] = useState<(Contract & { contract_clients: ContractClient[] })[]>([])
  const [privateRates, setPrivateRates] = useState<PrivateRate[]>([])
  const [fleet, setFleet] = useState<Fleet[]>([])
  const [jobTruckIds, setJobTruckIds] = useState<string[]>([])
  const [catalog, setCatalog] = useState<MaterialCatalog[]>([])
  const [showCatalogDrop, setShowCatalogDrop] = useState(false)
  const catalogRef = useRef<HTMLDivElement>(null)
  const [form, setForm] = useState<FormState>(defaultForm())
  const [crew, setCrew] = useState<CrewRow[]>([])
  const [materials, setMaterials] = useState<MaterialRow[]>([])
  const [photos, setPhotos] = useState<PhotoLocal[]>([])
  const [photoCaption, setPhotoCaption] = useState('')
  const [photoCategory, setPhotoCategory] = useState('inventory')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const pendingJobId = useRef(crypto.randomUUID())
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [markingReviewed, setMarkingReviewed] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [overrideBilling, setOverrideBilling] = useState<OverrideBilling>(emptyOverrideBilling())
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [editAnyway, setEditAnyway] = useState(false)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)

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
      setSubs(loadedSubs)
      setEmployees((empsRes.data ?? []) as Employee[])
      setCustomers(loadedCustomers)
      setContracts(loadedContracts)
      setPrivateRates((ratesRes.data ?? []) as PrivateRate[])
      setFleet((fleetRes.data ?? []) as unknown as Fleet[])
      setCatalog((catalogRes.data ?? []) as unknown as MaterialCatalog[])

      if (isEdit && jobId) {
        const [jobRes, photosRes, trucksRes] = await Promise.all([
          supabase.from('jobs').select('*, job_crew(*), job_materials(*)').eq('id', jobId).single(),
          supabase.from('job_photos').select('*').eq('job_id', jobId).order('created_at'),
          supabase.from('job_trucks').select('fleet_id').eq('job_id', jobId),
        ])
        setJobTruckIds((trucksRes.data ?? []).map((r: { fleet_id: string }) => r.fleet_id))

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
            job_crew: Array<{ employee_id: string; hours: number; cof_share: boolean; cof_hours: number; start_time: string | null; end_time: string | null }>
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
          })

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
          })))

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
  const isBooking = ['draft', 'scheduled', 'confirmed'].includes(form.status)
  const isInProgress = form.status === 'in_progress'
  const isCompletionMode = form.status === 'completed' || form.status === 'reviewed'
  const isReviewed = form.status === 'reviewed' && !editAnyway
  const isInvoiced = form.status === 'invoiced' || form.status === 'paid'
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
      const client = availableContractClients.find((c) => c.id === form.contract_client_id)
      return client ? `${base} → ${client.name}` : base
    }
    return selectedSub?.name ?? '—'
  }, [form.source, selectedCustomer, customerSearch, selectedContract, availableContractClients, form.contract_client_id, selectedSub])

  // ── Real-time summary ──────────────────────────────────────────────────────
  const selectedPrivateRateInput = useMemo<PrivateRateInput | null>(() => {
    if (form.source !== 'private') return null
    const cofHours = parseFloat(form.cof_final || form.cof) || 0
    if (form.private_rate_custom) {
      const price = parseFloat(form.private_rate_custom_price)
      if (!price) return null
      return { rate_per_hour: price, cofHours }
    }
    const rate = privateRates.find((r) => r.id === form.private_rate_id)
    if (!rate) return null
    return { rate_per_hour: rate.rate_per_hour, cofHours }
  }, [form.source, form.private_rate_custom, form.private_rate_custom_price, form.private_rate_id, form.cof_final, form.cof, privateRates])

  const summary = useMemo<JobSummary | null>(() => {
    if (form.source === 'subcontract' && !selectedSub) return null
    if (form.source === 'private' && !selectedPrivateRateInput) return null
    if (form.source === 'contract' && !selectedEntity) return null

    const jobData = {
      cof: parseFloat(form.cof) || null,
      cof_final: form.cof_final.trim() ? parseFloat(form.cof_final) : null,
      additional_hours: parseFloat(form.additional_hours) || null,
      additional_rate: parseFloat(form.additional_rate) || null,
      rate_card_key: form.rate_card_key || null,
      formula_vars: Object.fromEntries(Object.entries(form.formula_vars).map(([k, v]) => [k, parseFloat(v) || 0])),
      extra_men_hours: parseFloat(form.extra_men_hours) || 0,
      break_minutes: parseFloat(form.break_minutes) || 0,
      discount: parseFloat(form.discount) || 0,
      source: form.source,
      client_billing_config: overrideOpen ? buildOverrideConfig(overrideBilling) as unknown as SubcontractorConfig : null,
      google_review: form.google_review,
      google_review_employee_ids: form.google_review_employee_ids,
      override_revenue: null,
    }
    const crewData = crew.filter((r) => r.employee_id).map((r) => ({
      employee_id: r.employee_id,
      hours: resolveCrewHours(r),
      cof_share: r.cof_share,
      cof_hours: r.cof_share ? (parseFloat(r.cof_hours) || 0.5) : 0,
    }))
    const matsData = materials.map((m) => ({
      quantity: parseFloat(m.quantity) || 0,
      cost_price: parseFloat(m.cost_price) || 0,
      sale_price: parseFloat(m.sale_price) || 0,
    }))
    return calculateJobSummary(
      jobData,
      form.source === 'subcontract' ? selectedSub : null,
      crewData,
      matsData,
      employees,
      form.source !== 'subcontract' && form.source !== 'private' ? selectedEntity : null,
      form.source === 'private' ? selectedPrivateRateInput : null
    )
  }, [form, crew, materials, selectedSub, selectedEntity, selectedPrivateRateInput, employees, overrideOpen, overrideBilling])

  // ── COF suggestion from actual times ──────────────────────────────────────
  const suggestedCofFinal = useMemo<number | null>(() => {
    if (!form.actual_start_time || !form.actual_finish_time) return null
    const [sh, sm] = form.actual_start_time.split(':').map(Number)
    const [eh, em] = form.actual_finish_time.split(':').map(Number)
    const totalMins = (eh * 60 + em) - (sh * 60 + sm)
    if (totalMins <= 0) return null
    const breakMins = parseFloat(form.break_minutes) || 0
    const hrs = Math.round(((totalMins - breakMins) / 60) * 100) / 100
    return hrs > 0 ? hrs : null
  }, [form.actual_start_time, form.actual_finish_time, form.break_minutes])

  useEffect(() => {
    if (!form.actual_start_time || !form.actual_finish_time) return
    const [sh, sm] = form.actual_start_time.split(':').map(Number)
    const [eh, em] = form.actual_finish_time.split(':').map(Number)
    const totalMins = (eh * 60 + em) - (sh * 60 + sm)
    if (totalMins <= 0) return
    const breakMins = parseFloat(form.break_minutes) || 0
    const hrs = Math.round(((totalMins - breakMins) / 60) * 100) / 100
    if (hrs > 0) setForm((f) => ({ ...f, cof_final: hrs.toString() }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.actual_start_time, form.actual_finish_time])

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
      formula_vars: {},
      rate_card_key: '',
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
    setForm((f) => ({ ...f, subcontractor_id: subId, formula_vars: fvars, rate_card_key: '', cof: '', additional_hours: '', additional_rate: '' }))
  }

  function handleContractChange(contractId: string) {
    const contract = contracts.find((c) => c.id === contractId)
    let fvars: Record<string, string> = {}
    if (contract?.billing_type === 'formula') {
      const { expression, defaults } = contract.billing_config as FormulaConfig
      const keys = extractFormulaVars(expression)
      fvars = Object.fromEntries(keys.map((k) => [k, String(defaults[k] ?? '')]))
    }
    setForm((f) => ({ ...f, contract_id: contractId, contract_client_id: '', formula_vars: fvars, rate_card_key: '' }))
  }

  // ── Crew helpers ───────────────────────────────────────────────────────────
  function addCrew() { setCrew((c) => [...c, { _id: crypto.randomUUID(), employee_id: '', hours: '', start_time: '', end_time: '', cof_share: false, cof_hours: '0.5' }]) }
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

  // ── Photo helpers ──────────────────────────────────────────────────────────
  async function uploadPhoto(file: File, category = photoCategory) {
    setUploadingPhoto(true)
    setUploadError('')
    try {
      const ts = Date.now()
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const folder = isEdit && jobId ? jobId : pendingJobId.current
      const path = `jobs/${folder}/${ts}-${safeName}`
      const { error: upErr } = await supabase.storage.from('job-photos').upload(path, file)
      if (upErr) throw upErr
      const { data: urlData } = supabase.storage.from('job-photos').getPublicUrl(path)
      const publicUrl = urlData.publicUrl
      const caption = photoCaption.trim()
      if (isEdit && jobId) {
        const { data } = await supabase
          .from('job_photos')
          .insert({ job_id: jobId, url: publicUrl, caption: caption || null, category })
          .select()
          .single()
        if (data) {
          const p = data as { id: string; url: string; caption: string | null; category: string }
          setPhotos((prev) => [...prev, { _id: p.id, dbId: p.id, url: p.url, caption: p.caption ?? '', storagePath: path, category: p.category }])
        }
      } else {
        setPhotos((prev) => [...prev, { _id: crypto.randomUUID(), url: publicUrl, caption, storagePath: path, category }])
      }
      setPhotoCaption('')
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploadingPhoto(false)
    }
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

    const payload = {
      job_number: form.job_number.trim(),
      date: form.date,
      status: statusOverride ?? form.status,
      source: form.source,
      subcontractor_id: form.source === 'subcontract' ? (form.subcontractor_id || null) : null,
      customer_id: form.source === 'private' ? (resolvedCustomerId || null) : null,
      contract_id: form.source === 'contract' ? (form.contract_id || null) : null,
      contract_client_id: form.source === 'contract' ? (form.contract_client_id || null) : null,
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
      extra_men_hours: parseFloat(form.extra_men_hours) || 0,
      extra_man_employee_id: form.extra_man_employee_id || null,
      break_minutes: parseFloat(form.break_minutes) || 0,
      discount: parseFloat(form.discount) || 0,
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
    }

    const crewRows = crew.filter((r) => r.employee_id).map((r) => ({
      employee_id: r.employee_id,
      hours: resolveCrewHours(r),
      cof_share: r.cof_share,
      cof_hours: parseFloat(r.cof_hours) || 0.5,
      role: null,
      start_time: r.start_time || null,
      end_time: r.end_time || null,
    }))
    const matRows = materials.filter((m) => m.material_name.trim()).map((m) => ({
      material_name: m.material_name.trim(),
      quantity: parseFloat(m.quantity) || 1,
      cost_price: parseFloat(m.cost_price) || 0,
      sale_price: parseFloat(m.sale_price) || 0,
    }))

    const truckFleetIds = jobTruckIds.filter(Boolean)

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
      if (truckFleetIds.length) await supabase.from('job_trucks').insert(truckFleetIds.map((fid) => ({ job_id: jobId, fleet_id: fid })))
    } else {
      const { data: job, error: insErr } = await supabase.from('jobs').insert(payload).select().single()
      if (insErr || !job) throw insErr ?? new Error('Insert failed')
      const newId = (job as { id: string }).id
      if (crewRows.length) await supabase.from('job_crew').insert(crewRows.map((r) => ({ ...r, job_id: newId })))
      if (matRows.length) await supabase.from('job_materials').insert(matRows.map((m) => ({ ...m, job_id: newId })))
      if (truckFleetIds.length) await supabase.from('job_trucks').insert(truckFleetIds.map((fid) => ({ job_id: newId, fleet_id: fid })))
      if (photos.length) await supabase.from('job_photos').insert(photos.map((p) => ({ job_id: newId, url: p.url, caption: p.caption || null, category: p.category })))
    }

    router.push('/')
  }

  function extractMsg(e: unknown, fallback: string): string {
    if (e instanceof Error) return e.message
    if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
    return fallback
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try { await performSave() }
    catch (e) { setError(extractMsg(e, 'Failed to save job.')) }
    finally { setSaving(false) }
  }

  async function handleSaveWithStatus(s: JobStatus) {
    setSaving(true)
    setError('')
    try { await performSave(s) }
    catch (e) { setError(extractMsg(e, 'Failed to save job.')) }
    finally { setSaving(false) }
  }

  async function handleMarkReviewed() {
    setMarkingReviewed(true)
    setError('')
    try { await performSave('reviewed') }
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
    return <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Loading job…</div>
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
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
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
              form.source === 'contract' ? 'bg-teal-100 text-teal-700' :
              'bg-gray-100 text-gray-600'
            }`}>
              {form.source === 'private' ? 'Private' : form.source === 'subcontract' ? 'Subcontract' : 'Contract'}
            </span>
          </div>
        )}

        {/* SUBCONTRACT */}
        {form.source === 'subcontract' && (
          locked ? (
            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-800">{selectedSub?.name ?? '—'}</p>
              {form.reference_number && <p className="text-xs text-gray-500">Ref: {form.reference_number}</p>}
              {form.subcontractor_service_type && <p className="text-xs text-gray-500">Service: {form.subcontractor_service_type}</p>}
              {form.subcontractor_trucks && <p className="text-xs text-gray-500">Trucks: {form.subcontractor_trucks}</p>}
              {form.subcontractor_crew_size && <p className="text-xs text-gray-500">Crew: {form.subcontractor_crew_size}</p>}
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
              <Input
                label="Invoice # / Reference"
                value={form.reference_number ?? ''}
                onChange={(e) => setField('reference_number', e.target.value)}
                placeholder="e.g. INV-2024-001 (optional)"
              />
              <Input
                label="Service Type"
                value={form.subcontractor_service_type ?? ''}
                onChange={(e) => setField('subcontractor_service_type', e.target.value)}
                placeholder="e.g. 2 Men + 1 Truck, Packing Only"
              />
              <Input
                label="Subcontractor Truck(s)"
                value={form.subcontractor_trucks ?? ''}
                onChange={(e) => setField('subcontractor_trucks', e.target.value)}
                placeholder="e.g. 1x 4.5T truck, Truck A + Truck B"
              />
              <Input
                label="Crew Size"
                type="number"
                min="1"
                step="1"
                value={form.subcontractor_crew_size ?? ''}
                onChange={(e) => setField('subcontractor_crew_size', e.target.value)}
                placeholder="e.g. 3"
              />
            </div>
          )
        )}

        {/* PRIVATE */}
        {form.source === 'private' && (
          locked ? (
            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-800">{selectedCustomer?.name ?? '—'}</p>
              {selectedCustomer?.phone && (
                <p className="text-xs text-gray-500">{selectedCustomer.phone}</p>
              )}
              {(form.private_rate_id || form.private_rate_custom) && (
                <p className="text-xs text-gray-500">
                  {form.private_rate_custom
                    ? `Custom — $${form.private_rate_custom_price}/hr${form.private_rate_custom_desc ? ` (${form.private_rate_custom_desc})` : ''}`
                    : privateRates.find((r) => r.id === form.private_rate_id)?.name ?? '—'}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Customer search */}
              <div ref={customerRef} className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Customer <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={customerSearch}
                  onFocus={() => setShowCustomerDrop(true)}
                  onChange={(e) => { setCustomerSearch(e.target.value); setField('customer_id', ''); setShowCustomerDrop(true) }}
                  placeholder="Search or type new customer name…"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {showCustomerDrop && (
                  <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-44 overflow-y-auto">
                    <button type="button" onClick={() => { setField('customer_id', ''); setCustomerSearch(''); setShowCustomerDrop(false) }} className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-gray-50">
                      No customer
                    </button>
                    {filteredCustomers.map((c) => (
                      <button key={c.id} type="button" onClick={() => { setField('customer_id', c.id); setCustomerSearch(c.name); setShowCustomerDrop(false) }} className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-baseline gap-2">
                        <span className="font-medium">{c.name}</span>
                        {c.phone && <span className="text-gray-400 text-xs">{c.phone}</span>}
                        {!c.phone && c.contact_info && <span className="text-gray-400 text-xs">{c.contact_info}</span>}
                      </button>
                    ))}
                    {filteredCustomers.length === 0 && customerSearch.trim() && (
                      <p className="px-3 py-2 text-xs text-blue-600">Will create new customer &quot;{customerSearch}&quot; on save</p>
                    )}
                  </div>
                )}
                {selectedCustomer?.phone && (
                  <p className="mt-1 text-xs text-gray-500">{selectedCustomer.phone}</p>
                )}
                {!form.customer_id && customerSearch.trim() && (
                  <p className="mt-1 text-xs text-blue-600">New customer &quot;{customerSearch}&quot; will be created on save</p>
                )}
              </div>

              {/* Rate dropdown grouped by truck size */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rate <span className="text-red-400">*</span></label>
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
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
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

              <Input
                label="Job ID"
                value={form.reference_number ?? ''}
                onChange={(e) => setField('reference_number', e.target.value)}
                placeholder="e.g. JOB-001 (optional)"
              />

            </div>
          )
        )}

        {/* CONTRACT */}
        {form.source === 'contract' && (
          locked ? (
            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-800">{entityDisplayName}</p>
              {form.rate_card_key && <p className="text-xs text-gray-500">Rate: {form.rate_card_key}</p>}
              {form.reference_number && <p className="text-xs text-gray-500">Job ID: {form.reference_number}</p>}
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
                <Select
                  label="Client"
                  placeholder="Select client…"
                  options={availableContractClients.map((c) => ({ value: c.id, label: c.name }))}
                  value={form.contract_client_id ?? ''}
                  onChange={(e) => setField('contract_client_id', e.target.value)}
                />
              )}
              {/* Rate selector for ratecard contracts */}
              {form.contract_id && activeBillingType === 'ratecard' && rateCardKeys.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Rate <span className="text-red-400">*</span></label>
                  <select
                    value={form.rate_card_key ?? ''}
                    onChange={(e) => setField('rate_card_key', e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">Select rate…</option>
                    {rateCardKeys.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
              )}
              {/* Additional hours/rate (visible once a rate is selected) */}
              {form.contract_id && activeBillingType === 'ratecard' && form.rate_card_key && (
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Additional Hrs" type="number" min="0" step="0.25" value={form.additional_hours ?? ''} onChange={(e) => setField('additional_hours', e.target.value)} placeholder="0" />
                  <Input label="Addtl Rate ($/hr)" type="number" min="0" step="0.01" value={form.additional_rate ?? ''} onChange={(e) => setField('additional_rate', e.target.value)} placeholder="0.00" />
                </div>
              )}
              <Input label="COF (hrs)" type="number" min="0" step="0.25" value={form.cof ?? ''} onChange={(e) => setField('cof', e.target.value)} placeholder="0.5" />
              <Input
                label="Job ID"
                value={form.reference_number ?? ''}
                onChange={(e) => setField('reference_number', e.target.value)}
                placeholder="e.g. JOB-001 (optional)"
              />
            </div>
          )
        )}
      </Card>
    )
  }

  // ── Truck helpers ─────────────────────────────────────────────────────────
  function addTruck() { setJobTruckIds((ids) => [...ids, '']) }
  function setTruckId(idx: number, fid: string) {
    setJobTruckIds((ids) => ids.map((v, i) => (i === idx ? fid : v)))
  }
  function removeTruck(idx: number) {
    setJobTruckIds((ids) => ids.filter((_, i) => i !== idx))
  }

  // ── SHARED: Crew card ──────────────────────────────────────────────────────
  function renderCrewCard(showTimeInputs: boolean, locked = false) {
    return (
      <Card title="Crew" action={!locked ? <button type="button" onClick={addCrew} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"><Plus size={14} /> Add</button> : undefined}>
        {/* Truck selector — only for private and contract jobs */}
        {(form.source === 'private' || form.source === 'contract') && <div className="mb-3 space-y-1.5">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Truck</label>
          {locked ? (
            <p className="text-sm text-gray-700">
              {jobTruckIds.length === 0
                ? <span className="text-gray-400">—</span>
                : jobTruckIds.map((fid) => fleet.find((t) => t.id === fid)).filter(Boolean).map((t, i) => (
                    <span key={i}>
                      {i > 0 && ' + '}
                      <span className="font-mono font-semibold">{t!.registration ?? t!.name}</span>
                    </span>
                  ))
              }
            </p>
          ) : (
            <>
              {jobTruckIds.map((fid, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select
                    value={fid}
                    onChange={(e) => setTruckId(idx, e.target.value)}
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">Select truck…</option>
                    {fleet.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}{t.registration ? ` · ${t.registration}` : ''}{t.size ? ` · ${t.size === 'large' ? 'Large' : 'Small'}` : ''}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => removeTruck(idx)} className="text-gray-300 hover:text-red-500 shrink-0"><Trash2 size={15} /></button>
                </div>
              ))}
              <button
                type="button"
                onClick={addTruck}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                <Plus size={13} /> Add Truck
              </button>
            </>
          )}
        </div>}
        {(form.source === 'private' || form.source === 'contract') && <div className="border-t border-gray-100 mb-3" />}
        <div>
        {crew.length === 0 && <p className="text-sm text-gray-400 text-center py-2">No crew added yet.</p>}
        <div className="space-y-2">
          {crew.map((row) => {
            if (!showTimeInputs) {
              // Booking view: simplified row — employee + COF checkbox + COF hrs + delete
              return (
                <div key={row._id} className="flex items-center gap-2">
                  <select
                    value={row.employee_id ?? ''}
                    onChange={(e) => updateCrew(row._id, 'employee_id', e.target.value)}
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select employee…</option>
                    {employees.filter((e) => e.id === row.employee_id || !usedEmployeeIds.has(e.id)).map((e) => (
                      <option key={e.id} value={e.id}>{e.name} (${e.hourly_rate}/hr)</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 text-sm text-gray-700 whitespace-nowrap cursor-pointer select-none shrink-0">
                    <input
                      type="checkbox"
                      checked={row.cof_share}
                      onChange={(e) => updateCrew(row._id, 'cof_share', e.target.checked)}
                      className="rounded"
                    />
                    COF
                  </label>
                  {row.cof_share && (
                    <div className="flex items-center gap-1 shrink-0">
                      <input
                        type="number"
                        min="0.5"
                        step="0.5"
                        value={row.cof_hours ?? ''}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value)
                          updateCrew(row._id, 'cof_hours', isNaN(val) ? '0.5' : Math.max(0.5, val).toString())
                        }}
                        className="w-16 px-2 py-1.5 text-sm text-center border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-xs text-gray-400 whitespace-nowrap">hrs</span>
                    </div>
                  )}
                  <button type="button" onClick={() => removeCrew(row._id)} className="text-gray-300 hover:text-red-500 shrink-0" aria-label="Remove">
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            }

            // In Progress / Completion view: full row with time inputs
            const hasTime = crewHasTime(row)
            const computed = hasTime ? calcCrewHours(row.start_time, row.end_time) : null
            return (
              <div key={row._id} className="flex flex-col gap-1.5">
                <select
                  value={row.employee_id ?? ''}
                  onChange={(e) => updateCrew(row._id, 'employee_id', e.target.value)}
                  disabled={locked}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
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
                    className="w-28 px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                  />
                  <span className="text-gray-400 text-xs">–</span>
                  <input
                    type="time"
                    value={row.end_time ?? ''}
                    onChange={(e) => updateCrew(row._id, 'end_time', e.target.value)}
                    disabled={locked}
                    className="w-28 px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                  />
                  {hasTime ? (
                    <span className="text-sm font-medium text-gray-700 w-14 text-right tabular-nums">{computed}h</span>
                  ) : (
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      value={row.hours ?? ''}
                      onChange={(e) => updateCrew(row._id, 'hours', e.target.value)}
                      disabled={locked}
                      placeholder="hrs"
                      className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                    />
                  )}
                  <label className="flex items-center gap-1.5 text-sm text-gray-700 whitespace-nowrap cursor-pointer select-none">
                    <input type="checkbox" checked={row.cof_share} onChange={(e) => updateCrew(row._id, 'cof_share', e.target.checked)} disabled={locked} className="rounded" />
                    COF
                  </label>
                  {row.cof_share && (
                    <div className="flex items-center gap-1 shrink-0">
                      <input
                        type="number"
                        min="0.5"
                        step="0.5"
                        value={row.cof_hours ?? ''}
                        disabled={locked}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value)
                          updateCrew(row._id, 'cof_hours', isNaN(val) ? '0.5' : Math.max(0.5, val).toString())
                        }}
                        className="w-16 px-2 py-1.5 text-sm text-center border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                      />
                      <span className="text-xs text-gray-400">hrs</span>
                    </div>
                  )}
                  {!locked && (
                    <button type="button" onClick={() => removeCrew(row._id)} className="ml-auto text-gray-300 hover:text-red-500" aria-label="Remove">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {summary && summary.payrollEntries.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
            {summary.payrollEntries.map((e) => (
              <div key={e.employee_id} className="flex justify-between text-xs text-gray-500">
                <span>
                  {e.employee_name} — {e.paid_hours}h × ${e.hourly_rate}
                  {e.google_review_bonus && <span className="ml-1 text-amber-600">(+0.5h ★)</span>}
                </span>
                <span className="font-medium">{fmt(e.pay)}</span>
              </div>
            ))}
            <div className="flex justify-between text-xs font-semibold text-gray-700 pt-1 border-t border-gray-100">
              <span>Payroll total</span>
              <span>{fmt(summary.payrollTotal)}</span>
            </div>
          </div>
        )}
        </div>
      </Card>
    )
  }

  // ── SHARED: Photos card ────────────────────────────────────────────────────
  function renderPhotosCard(availableCategories: string[], locked = false) {
    const displayCategories = availableCategories.length === 1
      ? availableCategories
      : ['inventory', 'completion', 'damage', 'receipt', 'google_review'].filter((c) => availableCategories.includes(c))

    return (
      <Card title="Photos">
        {!locked && (
          <div className="flex gap-2 mb-3">
            {availableCategories.length > 1 && (
              <select
                value={photoCategory}
                onChange={(e) => setPhotoCategory(e.target.value)}
                className="px-2 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <label className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 cursor-pointer shrink-0">
              <ImagePlus size={16} />
              {uploadingPhoto ? 'Uploading…' : 'Add'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploadingPhoto}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  const cat = availableCategories.length === 1 ? availableCategories[0] : photoCategory
                  if (f) { uploadPhoto(f, cat); e.target.value = '' }
                }}
              />
            </label>
          </div>
        )}
        {uploadError && <p className="text-xs text-red-600 mb-2">{uploadError}</p>}
        {photos.filter((p) => displayCategories.includes(p.category)).length === 0 && (
          <p className="text-sm text-gray-400 text-center py-2">No photos yet.</p>
        )}
        {displayCategories.map((cat) => {
          const catPhotos = photos.filter((p) => p.category === cat)
          if (catPhotos.length === 0) return null
          return (
            <div key={cat} className="mb-3">
              {availableCategories.length > 1 && (
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{PHOTO_LABELS[cat] ?? cat}</p>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {catPhotos.map((p) => (
                  <div key={p._id} className="relative group rounded-lg overflow-hidden bg-gray-100 aspect-video">
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
                ))}
              </div>
            </div>
          )
        })}
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
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
        >
          <Plus size={14} /> Add
        </button>
        {showCatalogDrop && (
          <div className="absolute right-0 top-full mt-1 z-30 w-52 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
            {catalog.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => addMaterialFromCatalog(item)}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex justify-between items-center gap-2"
              >
                <span>{item.name}</span>
                <span className="text-gray-400 text-xs shrink-0">${Number(item.sale_price).toFixed(2)}</span>
              </button>
            ))}
            <div className="border-t border-gray-100 mt-1 pt-1">
              <button
                type="button"
                onClick={() => addMaterialFromCatalog(null)}
                className="w-full text-left px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
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
        {materials.length === 0 && <p className="text-sm text-gray-400 text-center py-2">No materials.</p>}
        {materials.length > 0 && !locked && (
          <div className="text-xs text-gray-400 grid grid-cols-[1fr_56px_72px_72px_20px] gap-2 px-1 mb-1">
            <span>Name</span><span>Qty</span><span>Cost</span><span>Sale</span><span />
          </div>
        )}
        <div className="space-y-2">
          {materials.map((row) => (
            locked ? (
              <div key={row._id} className="flex justify-between text-sm text-gray-700">
                <span>{row.material_name} × {row.quantity}</span>
                <span className="text-gray-500">{fmt(parseFloat(row.sale_price) * parseFloat(row.quantity) || 0)}</span>
              </div>
            ) : (
              <div key={row._id} className="grid grid-cols-[1fr_56px_72px_72px_20px] gap-2 items-center">
                <input type="text" value={row.material_name ?? ''} onChange={(e) => updateMaterial(row._id, 'material_name', e.target.value)} placeholder="Item name" className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="number" min="0" step="1" value={row.quantity ?? ''} onChange={(e) => updateMaterial(row._id, 'quantity', e.target.value)} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="number" min="0" step="0.01" value={row.cost_price ?? ''} onChange={(e) => updateMaterial(row._id, 'cost_price', e.target.value)} placeholder="0.00" className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="number" min="0" step="0.01" value={row.sale_price ?? ''} onChange={(e) => updateMaterial(row._id, 'sale_price', e.target.value)} placeholder="0.00" className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button type="button" onClick={() => removeMaterial(row._id)} className="text-gray-300 hover:text-red-500" aria-label="Remove"><Trash2 size={14} /></button>
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
      const cofHours = r.cof_share ? (parseFloat(r.cof_hours) || 0.5) : 0
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
            <Link href="/jobs" className="text-gray-400 hover:text-gray-600">
              <ChevronLeft size={20} />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Job #{form.job_number}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[form.status]}`}>
                {STATUS_LABEL[form.status]}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{form.date}</span>
            {isEdit && (
              <button onClick={handleDelete} disabled={deleting} className="text-sm text-red-500 hover:text-red-700 font-medium disabled:opacity-50">
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
                <span className="text-gray-400 w-20 shrink-0">Client</span>
                <span className="font-medium text-gray-900">{entityDisplayName}</span>
              </div>
              {form.reference_number && (
                <div className="flex gap-4">
                  <span className="text-gray-400 w-20 shrink-0">Ref</span>
                  <span className="text-gray-700">{form.reference_number}</span>
                </div>
              )}
              <div className="flex gap-4">
                <span className="text-gray-400 w-20 shrink-0">Date</span>
                <span className="text-gray-700">{form.date}</span>
              </div>
              {form.pickup_address && (
                <div className="flex gap-4">
                  <span className="text-gray-400 w-20 shrink-0">Pickup</span>
                  <span className="text-gray-700">{form.pickup_address}</span>
                </div>
              )}
              {form.delivery_address && (
                <div className="flex gap-4">
                  <span className="text-gray-400 w-20 shrink-0">Delivery</span>
                  <span className="text-gray-700">{form.delivery_address}</span>
                </div>
              )}
              {form.actual_start_time && form.actual_finish_time && (
                <div className="flex gap-4">
                  <span className="text-gray-400 w-20 shrink-0">Hours</span>
                  <span className="text-gray-700">{form.actual_start_time.slice(0,5)} – {form.actual_finish_time.slice(0,5)}</span>
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
                      <span className="font-medium text-gray-900">{l.name}</span>
                      <span className="text-gray-400 ml-2">{l.paidHours}h × ${l.rate}/hr</span>
                    </div>
                    <span className="font-semibold text-gray-800">{fmt(l.pay)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-sm font-bold pt-2 border-t border-gray-100">
                  <span className="text-gray-700">Total Payroll</span>
                  <span className="text-gray-900">{fmt(payrollTotal)}</span>
                </div>
              </div>
            </Card>
          )}

          {/* FINANCEIRO */}
          {summary && (
            <Card title="Financials">
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Revenue</span>
                  <span className="font-semibold text-gray-900">{fmt(summary.totalRevenue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Payroll</span>
                  <span className="text-orange-600 font-medium">−{fmt(summary.payrollTotal)}</span>
                </div>
                {summary.materialsRevenue !== 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Materials</span>
                    <span className="font-medium text-gray-700">{fmt(summary.materialsRevenue)}</span>
                  </div>
                )}
                {summary.discount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Discount</span>
                    <span className="text-red-500 font-medium">−{fmt(summary.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t border-gray-100">
                  <span className="font-bold text-gray-800">Profit</span>
                  <span className={`font-bold ${summary.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
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
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Completion</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{form.completion_notes}</p>
                </div>
              )}
              {form.notes && (
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Notes</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{form.notes}</p>
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
                    <span className="text-gray-500">Date</span>
                    <span className="text-gray-800">{form.payment_date}</span>
                  </div>
                )}
                {form.payment_methods.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Method</span>
                    <span className="text-gray-800">{form.payment_methods.map((m) => PAYMENT_METHODS.find((pm) => pm.value === m)?.label ?? m).join(' + ')}</span>
                  </div>
                )}
                {parseFloat(form.payment_cash_amount) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Cash</span>
                    <span className="text-gray-800">{fmt(parseFloat(form.payment_cash_amount))}</span>
                  </div>
                )}
                {parseFloat(form.payment_transfer_amount) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Transfer</span>
                    <span className="text-gray-800">{fmt(parseFloat(form.payment_transfer_amount))}</span>
                  </div>
                )}
                {parseFloat(form.payment_card_amount) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Card</span>
                    <span className="text-gray-800">{fmt(parseFloat(form.payment_card_amount))}</span>
                  </div>
                )}
                {form.payment_collected_by && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Collected by</span>
                    <span className="text-gray-800">{form.payment_collected_by}</span>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Photos (completion/damage only) */}
          {photos.filter((p) => ['completion','damage'].includes(p.category)).length > 0 && renderPhotosCard(['completion','damage'], true)}
        </div>

        {/* Sticky footer */}
        <div className="fixed bottom-0 left-0 right-0 lg:left-56 bg-white border-t border-gray-200 shadow-xl z-10">
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
              <p className="text-sm font-medium text-gray-700 mb-2">Payment Method</p>
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
            {error && <p className="text-sm text-red-600">{error}</p>}
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
          <Link href="/jobs" className="text-gray-400 hover:text-gray-600">
            <ChevronLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Job #{form.job_number}</h1>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-600">Cancelled</span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <XCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-800 text-sm">Job cancelled</p>
              {form.cancellation_reason && (
                <p className="text-sm text-red-700 mt-1">{form.cancellation_reason}</p>
              )}
            </div>
          </div>

          <Card title="Job Info">
            <div className="space-y-2 text-sm">
              <div className="flex gap-4">
                <span className="text-gray-400 w-24 shrink-0">Job #</span>
                <span className="font-mono font-medium">{form.job_number}</span>
              </div>
              <div className="flex gap-4">
                <span className="text-gray-400 w-24 shrink-0">Date</span>
                <span>{form.date}</span>
              </div>
              <div className="flex gap-4">
                <span className="text-gray-400 w-24 shrink-0">Client</span>
                <span>{entityDisplayName}</span>
              </div>
            </div>
          </Card>

          {form.minimum_charge_applied && (
            <Card title="Minimum Charge">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">Minimum charge applied</span>
                <span className="font-semibold text-gray-900">{fmt(parseFloat(form.minimum_charge_amount) || 0)}</span>
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
          <Link href="/jobs" className="text-gray-400 hover:text-gray-600">
            <ChevronLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
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
              className="text-sm text-red-400 hover:text-red-600 font-medium"
            >
              Cancel Job
            </button>
          )}
          {isEdit && !isBooking && !isInProgress && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-sm text-red-500 hover:text-red-700 font-medium disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete Job'}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4">

        {/* ── Reviewed lock banner ──────────────────────────────────────── */}
        {form.status === 'reviewed' && !editAnyway && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-amber-800">This job has been reviewed and is locked.</span>
            <button
              type="button"
              onClick={() => setEditAnyway(true)}
              className="text-sm font-semibold text-amber-700 hover:text-amber-900 underline whitespace-nowrap"
            >
              Edit anyway
            </button>
          </div>
        )}

        {/* ── FINAL REVIEW (completed / reviewed) ──────────────────────── */}
        {isCompletionMode && (
          <div className={`rounded-xl border-2 p-4 ${isReviewed ? 'border-cyan-300 bg-cyan-50/60' : 'border-amber-300 bg-amber-50/60'}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {isReviewed
                  ? <Lock size={16} className="text-cyan-600" />
                  : <CheckCircle size={16} className="text-amber-600" />
                }
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Final Review</h2>
              </div>
              {isReviewed && (
                <span className="text-xs font-medium text-cyan-700 bg-cyan-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <CheckCircle size={11} /> Reviewed
                </span>
              )}
            </div>

            {/* Adjustment fields */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <Input id="rfv-cof-final" label="COF Final (hrs)" type="number" min="0" step="0.25" value={form.cof_final ?? ''} onChange={(e) => setField('cof_final', e.target.value)} placeholder={form.cof || '—'} disabled={isReviewed} />
                {suggestedCofFinal !== null && !isReviewed && (
                  <button type="button" onClick={() => setField('cof_final', suggestedCofFinal.toString())} className="mt-1 text-xs text-blue-600 hover:text-blue-800">
                    ↑ Use {suggestedCofFinal}h from actual times
                  </button>
                )}
              </div>
              <Input id="rfv-break" label="Break (min)" type="number" step="1" value={form.break_minutes ?? ''} onChange={(e) => setField('break_minutes', e.target.value)} placeholder="0" disabled={isReviewed} />
              <Input id="rfv-extra-men" label="Extra Men (hrs)" type="number" min="0" step="0.25" value={form.extra_men_hours ?? ''} onChange={(e) => setField('extra_men_hours', e.target.value)} placeholder="0" disabled={isReviewed} />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Extra Man</label>
                <select value={form.extra_man_employee_id ?? ''} onChange={(e) => setField('extra_man_employee_id', e.target.value)} disabled={isReviewed} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:bg-gray-50 disabled:text-gray-500">
                  <option value="">— none —</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
            </div>

            {/* Actual times */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Input id="rfv-start" label="Actual Start" type="time" value={form.actual_start_time ?? ''} onChange={(e) => setField('actual_start_time', e.target.value)} disabled={isReviewed} />
              <Input id="rfv-finish" label="Actual Finish" type="time" value={form.actual_finish_time ?? ''} onChange={(e) => setField('actual_finish_time', e.target.value)} disabled={isReviewed} />
            </div>

            {/* Completion notes */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-gray-700">Completion Notes</label>
                <label className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
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
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>

            {/* Google Review */}
            <div className="mb-3 pt-3 border-t border-gray-100">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer mb-2">
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
                <Star size={14} className="text-amber-500" />
                Google Review received
              </label>
              {form.google_review && (
                <div className="space-y-2 pl-1">
                  <div>
                    <p className="text-xs text-gray-400 mb-1.5">Who received the review <span className="text-amber-600">(+0.5h each)</span></p>
                    <div className="flex flex-wrap gap-1.5">
                      {(() => {
                        const crewEmpIds = crew.filter((r) => r.employee_id).map((r) => r.employee_id)
                        const allIds = form.extra_man_employee_id && !crewEmpIds.includes(form.extra_man_employee_id)
                          ? [...crewEmpIds, form.extra_man_employee_id]
                          : crewEmpIds
                        return allIds.map((empId) => {
                          const emp = employees.find((e) => e.id === empId)
                          if (!emp) return null
                          const checked = form.google_review_employee_ids.includes(emp.id)
                          return (
                            <button
                              key={emp.id}
                              type="button"
                              onClick={() => setField(
                                'google_review_employee_ids',
                                checked
                                  ? form.google_review_employee_ids.filter((id) => id !== emp.id)
                                  : [...form.google_review_employee_ids, emp.id]
                              )}
                              disabled={isReviewed}
                              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors disabled:opacity-50 ${
                                checked ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-white text-gray-600 border-gray-300 hover:border-amber-300'
                              }`}
                            >
                              {checked ? '★ ' : ''}{emp.name}{empId === form.extra_man_employee_id && !crewEmpIds.includes(empId) ? ' (extra)' : ''}
                            </button>
                          )
                        })
                      })()}
                      {crew.filter((r) => r.employee_id).length === 0 && !form.extra_man_employee_id && (
                        <p className="text-xs text-gray-400">Add crew members above to select recipients.</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1.5">Screenshot (optional)</p>
                    <label className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-50 cursor-pointer w-fit">
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
                          <div key={p._id} className="relative group w-20 h-14 rounded-lg overflow-hidden bg-gray-100 shrink-0">
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
                <span className="text-gray-500">Revenue</span>
                <span className="font-semibold text-gray-900">{fmt(summary.totalRevenue)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Payroll</span>
                <span className="text-orange-600">−{fmt(summary.payrollTotal)}</span>
              </div>
              {summary.discount > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Discount</span>
                  <span className="text-red-500">−{fmt(summary.discount)}</span>
                </div>
              )}
              <div className={`flex justify-between pt-2 border-t border-gray-100 font-bold ${summary.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                <span>Profit</span>
                <span>{fmt(summary.profit)}{summary.margin !== null ? ` (${(summary.margin * 100).toFixed(1)}%)` : ''}</span>
              </div>
            </div>
          </Card>
        )}

        {/* ── Job Info ──────────────────────────────────────────────────── */}
        <Card title="Job Info">
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
            return dur > 0 ? <p className="mt-1.5 text-xs text-gray-400">Est. duration: {dur}h</p> : null
          })()}
          {isEdit && (
            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => setField('status', e.target.value as JobStatus)}
                className="w-full sm:w-48 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Customer <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={customerSearch}
                onFocus={() => setShowCustomerDrop(true)}
                onChange={(e) => { setCustomerSearch(e.target.value); setField('customer_id', ''); setShowCustomerDrop(true) }}
                placeholder="Search customers…"
                disabled={isReviewed}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
              {showCustomerDrop && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-44 overflow-y-auto">
                  <button type="button" onClick={() => { setField('customer_id', ''); setCustomerSearch(''); setShowCustomerDrop(false) }} className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-gray-50">
                    No customer
                  </button>
                  {filteredCustomers.map((c) => (
                    <button key={c.id} type="button" onClick={() => { setField('customer_id', c.id); setCustomerSearch(c.name); setShowCustomerDrop(false) }} className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-baseline gap-2">
                      <span className="font-medium">{c.name}</span>
                      {c.phone && <span className="text-gray-400 text-xs">{c.phone}</span>}
                      {!c.phone && c.contact_info && <span className="text-gray-400 text-xs">{c.contact_info}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Pickup Address" value={form.pickup_address ?? ''} onChange={(e) => setField('pickup_address', e.target.value)} placeholder="123 Main St, Sydney" disabled={isReviewed} />
            <Input label="Delivery Address" value={form.delivery_address ?? ''} onChange={(e) => setField('delivery_address', e.target.value)} placeholder="45 Park Ave, Sydney" disabled={isReviewed} />
          </div>
        </Card>

        {/* ── Extra Men (in_progress + completion) ─────────────────────── */}
        {showExtraMen && !isCompletionMode && (
          <Card title="Extra Men">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Extra Men (hrs)" type="number" min="0" step="0.25" value={form.extra_men_hours ?? ''} onChange={(e) => setField('extra_men_hours', e.target.value)} placeholder="0" disabled={isReviewed} />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Extra Man Employee</label>
                <select value={form.extra_man_employee_id ?? ''} onChange={(e) => setField('extra_man_employee_id', e.target.value)} disabled={isReviewed} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500">
                  <option value="">— none —</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
            </div>
          </Card>
        )}

        {/* ── Crew ─────────────────────────────────────────────────────── */}
        {renderCrewCard(!isBooking, isReviewed)}

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
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              rows={3}
              value={form.notes ?? ''}
              onChange={(e) => setField('notes', e.target.value)}
              disabled={isReviewed}
              placeholder="e.g. EASTWOOD › EPPING"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>
        </Card>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
        )}
      </div>

      {/* ── Sticky footer ────────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 lg:left-56 bg-white border-t border-gray-200 shadow-xl z-10">
        <div className="px-4 lg:px-6 py-3 flex items-center justify-between gap-3 max-w-2xl">
          {/* Summary numbers — only when we have data */}
          <div className="flex items-center gap-5 min-w-0">
            {summary && (
              <>
                <SummaryCell label="Revenue" value={fmt(summary.totalRevenue)} color="text-gray-900" />
                <SummaryCell label="Payroll" value={fmt(summary.payrollTotal)} color="text-orange-600" />
                <SummaryCell
                  label="Profit"
                  value={`${fmt(summary.profit)}${summary.margin !== null ? ` (${(summary.margin * 100).toFixed(1)}%)` : ''}`}
                  color={summary.profit >= 0 ? 'text-green-600' : 'text-red-600'}
                />
              </>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 shrink-0">
            {/* New job (draft) */}
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

            {/* Editing draft */}
            {isEdit && form.status === 'draft' && (
              <>
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

            {/* Editing scheduled */}
            {isEdit && form.status === 'scheduled' && (
              <>
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

            {/* Editing confirmed */}
            {isEdit && form.status === 'confirmed' && (
              <>
                <Button onClick={handleSave} disabled={saving} size="md" variant="secondary">
                  {saving ? 'Saving…' : 'Update'}
                </Button>
                <Button onClick={() => handleSaveWithStatus('in_progress')} disabled={saving} size="md">
                  {saving ? 'Saving…' : 'Start Job'}
                </Button>
              </>
            )}

            {/* In progress */}
            {isEdit && form.status === 'in_progress' && (
              <>
                <Button onClick={handleSave} disabled={saving} size="md" variant="secondary">
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                <Button onClick={() => handleSaveWithStatus('completed')} disabled={saving} size="md" className="bg-green-600 hover:bg-green-700 border-green-600">
                  {saving ? 'Saving…' : 'Complete Job'}
                </Button>
              </>
            )}

            {/* Completed */}
            {isEdit && form.status === 'completed' && (
              <Button onClick={handleSave} disabled={saving} size="md" variant="secondary">
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
            )}

            {/* Reviewed — locked */}
            {isEdit && form.status === 'reviewed' && !editAnyway && (
              <>
                <Button onClick={() => setEditAnyway(true)} disabled={saving} size="md" variant="secondary">
                  Edit Job
                </Button>
                <Button onClick={() => handleSaveWithStatus('invoiced')} disabled={saving} size="md" className="bg-purple-600 hover:bg-purple-700 border-purple-600">
                  <FileText size={15} />
                  {saving ? 'Saving…' : 'Send Invoice'}
                </Button>
              </>
            )}

            {/* Reviewed — editing */}
            {isEdit && form.status === 'reviewed' && editAnyway && (
              <Button onClick={handleSave} disabled={saving} size="md">
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Cancel Job modal */}
      <Modal open={cancelModalOpen} onClose={() => setCancelModalOpen(false)} title={`Cancel Job #${form.job_number}`}>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Minimum Charge</p>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer mb-3">
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Cancellation Reason</label>
            <textarea
              rows={3}
              value={form.cancellation_reason ?? ''}
              onChange={(e) => setField('cancellation_reason', e.target.value)}
              placeholder="e.g. Client cancelled last minute"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 pt-2">
            <Button onClick={handleCancelJob} disabled={saving} variant="danger" className="flex-1">
              {saving ? 'Cancelling…' : 'Confirm Cancellation'}
            </Button>
            <Button variant="secondary" onClick={() => setCancelModalOpen(false)} className="flex-1">Keep Job</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ─── Small helpers ────────────────────────────────────────────────────────────
function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

function SummaryCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`text-sm font-bold truncate ${color}`}>{value}</div>
    </div>
  )
}
