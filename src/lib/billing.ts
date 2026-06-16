import type { Job, JobSource, Subcontractor, Employee, SubcontractorConfig, PercentConfig, RateCardConfig, FormulaConfig } from '@/types/database'

// eslint-disable-next-line no-new-func
function safeEval(expression: string, vars: Record<string, number>): number {
  const names = Object.keys(vars)
  const values = Object.values(vars)
  try {
    const fn = new Function(...names, `"use strict"; return +(${expression})`)
    const result = fn(...values)
    return Number.isFinite(result) ? result : 0
  } catch {
    return 0
  }
}

/** Returns custom variable names in a formula expression (excludes built-ins) */
export function extractFormulaVars(expression: string): string[] {
  const BUILT_IN = new Set(['gst', 'cof', 'additionalHours', 'additionalRate', 'extraMenHours', 'breakHours'])
  const matches = expression.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) ?? []
  return [...new Set(matches.filter((m) => !BUILT_IN.has(m)))]
}

// ─── Shared core ─────────────────────────────────────────────────────────────
function applyBillingConfig(
  cofHours: number,
  additionalHours: number,
  additionalRate: number,
  extraMenHours: number,
  breakHours: number,
  rateCardKey: string | null,
  formulaVars: Record<string, number> | null,
  billingType: string,
  config: SubcontractorConfig
): number {
  if (!config || !billingType) return 0

  if (billingType === 'percent') {
    const { percent } = config as PercentConfig
    return (cofHours + additionalHours - breakHours + extraMenHours) * additionalRate * percent
  }

  if (billingType === 'ratecard') {
    const { gst, rates, extra_men_rate } = config as RateCardConfig
    if (!rates) return 0
    const base = rates[rateCardKey ?? ''] ?? 0
    const rateRevenue = gst ? base * 1.1 : base
    return rateRevenue + (extra_men_rate ? extraMenHours * extra_men_rate : 0)
  }

  if (billingType === 'formula') {
    const { expression, defaults } = config as FormulaConfig
    const vars: Record<string, number> = {
      gst: 1.1,
      cof: cofHours,
      additionalHours,
      additionalRate,
      extraMenHours,
      breakHours,
      ...Object.fromEntries(Object.entries(defaults ?? {}).map(([k, v]) => [k, Number(v)])),
      ...Object.fromEntries(Object.entries(formulaVars ?? {}).map(([k, v]) => [k, Number(v)])),
    }
    return safeEval(expression, vars)
  }

  return 0
}

function jobVars(job: Pick<Job, 'cof' | 'cof_final' | 'additional_hours' | 'additional_rate' | 'rate_card_key' | 'formula_vars' | 'extra_men_hours' | 'break_minutes'>) {
  return {
    cofHours: Number(job.cof_final ?? job.cof) || 0,
    additionalHours: Number(job.additional_hours) || 0,
    additionalRate: Number(job.additional_rate) || 0,
    extraMenHours: Number(job.extra_men_hours) || 0,
    breakHours: Number(job.break_minutes) / 60,
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Revenue Malibu receives FROM a subcontractor (source = 'subcontract') */
export function calculateJobRevenue(
  job: Pick<Job, 'cof' | 'cof_final' | 'additional_hours' | 'additional_rate' | 'rate_card_key' | 'formula_vars' | 'extra_men_hours' | 'break_minutes' | 'override_revenue'>,
  sub: Subcontractor
): number {
  if (job.override_revenue != null && job.override_revenue > 0) return job.override_revenue
  const { cofHours, additionalHours, additionalRate, extraMenHours, breakHours } = jobVars(job)
  return applyBillingConfig(cofHours, additionalHours, additionalRate, extraMenHours, breakHours, job.rate_card_key, job.formula_vars, sub.billing_type, sub.config)
}

/** Revenue Malibu charges TO a client (source = 'private' or 'contract') */
export function calculateClientRevenue(
  job: Pick<Job, 'cof' | 'cof_final' | 'additional_hours' | 'additional_rate' | 'rate_card_key' | 'formula_vars' | 'extra_men_hours' | 'break_minutes' | 'override_revenue'> & { client_billing_config?: SubcontractorConfig | null },
  entityBillingType: string,
  entityBillingConfig: SubcontractorConfig
): number {
  if (job.override_revenue != null && job.override_revenue > 0) return job.override_revenue
  const { cofHours, additionalHours, additionalRate, extraMenHours, breakHours } = jobVars(job)
  // Per-job override merges over entity config; if override supplies billing_type, it takes precedence
  const override = job.client_billing_config as (SubcontractorConfig & { billing_type?: string }) | null
  const billingType = override?.billing_type ?? entityBillingType
  const config: SubcontractorConfig = override ? { ...entityBillingConfig, ...override } : entityBillingConfig
  return applyBillingConfig(cofHours, additionalHours, additionalRate, extraMenHours, breakHours, job.rate_card_key, job.formula_vars, billingType, config)
}

export interface PayrollEntry {
  employee_id: string
  employee_name: string
  hours: number
  paid_hours: number
  hourly_rate: number
  pay: number
  google_review_bonus?: boolean
}

export interface PayrollResult {
  entries: PayrollEntry[]
  total: number
}

export function calculatePayroll(
  crew: Array<{ employee_id: string; hours: number; cof_share: boolean; cof_hours?: number }>,
  employees: Employee[],
  cofHours = 0,
  googleReviewEmployeeIds: string[] = []
): PayrollResult {
  const MIN_CALL = 2
  const REVIEW_BONUS = 0.5
  const empMap = new Map(employees.map((e) => [e.id, e]))
  const reviewSet = new Set(googleReviewEmployeeIds)
  const entries: PayrollEntry[] = []

  for (const row of crew) {
    const emp = empMap.get(row.employee_id)
    if (!emp) continue
    const hasReviewBonus = reviewSet.has(emp.id)
    // Per-crew cof_hours takes priority over the global cofHours fallback
    const rowCof = row.cof_share ? (row.cof_hours != null ? row.cof_hours : cofHours) : 0
    const paid_hours =
      Math.max(row.hours, MIN_CALL) +
      rowCof +
      (hasReviewBonus ? REVIEW_BONUS : 0)
    entries.push({
      employee_id: emp.id,
      employee_name: emp.name,
      hours: row.hours,
      paid_hours,
      hourly_rate: emp.hourly_rate,
      pay: paid_hours * emp.hourly_rate,
      google_review_bonus: hasReviewBonus || undefined,
    })
  }

  return { entries, total: entries.reduce((s, e) => s + e.pay, 0) }
}

export interface PrivateRateInput {
  rate_per_hour: number
  cofHours: number
}

export interface JobSummary {
  subRevenue: number
  materialsRevenue: number
  materialsCost: number
  discount: number
  totalRevenue: number
  payrollTotal: number
  payrollEntries: PayrollEntry[]
  googleReviewBonuses: Array<{ employee_id: string; employee_name: string }>
  profit: number
  margin: number | null
}

type JobSummaryInput = Pick<Job, 'cof' | 'cof_final' | 'additional_hours' | 'additional_rate' | 'rate_card_key' | 'formula_vars' | 'discount' | 'extra_men_hours' | 'break_minutes'> & {
  source?: JobSource
  client_billing_config?: SubcontractorConfig | null
  google_review?: boolean
  google_review_employee_ids?: string[]
}

export function calculateJobSummary(
  job: JobSummaryInput,
  sub: Subcontractor | null,
  crew: Array<{ employee_id: string; hours: number; cof_share: boolean; cof_hours?: number }>,
  materials: Array<{ quantity: number; cost_price: number; sale_price: number }>,
  employees: Employee[],
  clientEntity?: { billing_type: string; billing_config: SubcontractorConfig } | null,
  privateRate?: PrivateRateInput | null
): JobSummary {
  const source = job.source ?? 'subcontract'

  let subRevenue = 0
  if (source === 'subcontract') {
    subRevenue = sub ? calculateJobRevenue(job, sub) : 0
  } else if (source === 'private' && privateRate) {
    subRevenue = privateRate.rate_per_hour * privateRate.cofHours
  } else if (clientEntity) {
    subRevenue = calculateClientRevenue(
      { ...job, client_billing_config: job.client_billing_config ?? null },
      clientEntity.billing_type,
      clientEntity.billing_config
    )
  }

  const materialsRevenue = materials.reduce((s, m) => s + Number(m.quantity) * Number(m.sale_price), 0)
  const materialsCost = materials.reduce((s, m) => s + Number(m.quantity) * Number(m.cost_price), 0)
  const discount = Number(job.discount) || 0
  const totalRevenue = subRevenue + materialsRevenue - discount
  const cofHours = Number(job.cof_final ?? job.cof) || 0
  const reviewIds = job.google_review ? (job.google_review_employee_ids ?? []) : []
  const { total: payrollTotal, entries: payrollEntries } = calculatePayroll(crew, employees, cofHours, reviewIds)
  const googleReviewBonuses = payrollEntries
    .filter((e) => e.google_review_bonus)
    .map((e) => ({ employee_id: e.employee_id, employee_name: e.employee_name }))
  const profit = totalRevenue - payrollTotal - materialsCost
  const margin = totalRevenue !== 0 ? profit / totalRevenue : null
  return { subRevenue, materialsRevenue, materialsCost, discount, totalRevenue, payrollTotal, payrollEntries, googleReviewBonuses, profit, margin }
}
