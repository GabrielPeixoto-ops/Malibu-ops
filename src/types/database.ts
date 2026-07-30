export type JobStatus =
  | 'draft'
  | 'scheduled'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'reviewed'
  | 'invoiced'
  | 'paid'
  | 'cancelled'

export type JobSource = 'private' | 'contract' | 'subcontract'

export type BillingType = 'percent' | 'ratecard' | 'formula'

export interface PercentConfig {
  percent: number
}

export interface RateCardConfig {
  gst: boolean
  rates: Record<string, number>
  extra_note?: string
  extra_men_rate?: number
  rateList?: Array<{ id: string; name: string; rate_per_hour: number }>
}

export interface FormulaConfig {
  expression: string
  defaults: Record<string, number>
}

export type SubcontractorConfig = PercentConfig | RateCardConfig | FormulaConfig

export interface Employee {
  id: string
  name: string
  hourly_rate: number
  active: boolean
  age: number | null
  visa_type: string | null
  english_level: string | null
  phone_type: string | null
  employment_status: string | null
  email: string | null
  phone: string | null
  drivers_license: string | null
  drivers_license_expiry: string | null
  passport: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  emergency_contact_relation: string | null
  document_url: string | null
  created_at?: string
}

export interface Subcontractor {
  id: string
  name: string
  billing_type: BillingType
  config: SubcontractorConfig
  google_review_bonus: boolean
  color_hex: string | null
  // When false, hours for this subcontractor's jobs are NOT rounded up to the
  // next 15-minute block — plain decimal hours are used instead (e.g. 5h48m
  // stays 5.80h rather than becoming 6.00h). Used for TMAAT/TMAAT TT so our
  // reported hours and crew payroll reconcile with TMAAT's own portal, which
  // reports exact decimal hours. Defaults to true (existing round-up behavior)
  // for every other subcontractor.
  round_up_hours: boolean
  created_at?: string
}

export interface PrivateRate {
  id: string
  name: string
  trucks: number
  truck_size: 'small' | 'large'
  men: number
  rate_per_hour: number
  is_active: boolean
  sort_order: number
  created_at?: string
}

export interface MaterialCatalog {
  id: string
  name: string
  sale_price: number
  cost_price: number
  is_active: boolean
  sort_order: number
  created_at?: string
}

export interface Fleet {
  id: string
  name: string
  model: string | null
  registration: string | null
  size: 'small' | 'large' | null
  cargo_capacity_cbm: number | null
  actuals_cbm: number | null
  height_clearance: string | null
  internal_height: string | null
  tailgate: string | null
  default_driver: string | null
  selling_points: string | null
  notes: string | null
  tonnes: number | null
  is_active: boolean
  created_at?: string
}

// One diesel fill-up for a truck (migration_v52). Manual entry for now — lets
// the Fleet page show average spend and, once 2+ logs for a truck have an
// odometer reading, an estimated L/100km consumption figure. A stopgap until
// (if) we get API access from Quik/QuikTrak to pull km driven automatically.
export interface FleetFuelLog {
  id: string
  fleet_id: string
  date: string
  litres: number
  cost: number
  odometer_km: number | null
  filled_by: string | null
  notes: string | null
  created_at?: string
}

export interface JobTruck {
  id: string
  job_id: string
  fleet_id: string
  created_at?: string
}

export interface Customer {
  id: string
  name: string
  contact_info: string | null
  phone: string | null
  secondary_contact_name: string | null
  secondary_contact_phone: string | null
  default_addresses: string[] | null
  notes: string | null
  billing_type: string | null
  billing_config: SubcontractorConfig | null
  google_review_bonus: boolean
  created_at?: string
}

export interface Contract {
  id: string
  name: string
  billing_type: string
  billing_config: SubcontractorConfig
  google_review_bonus: boolean
  color_hex: string | null
  client_company_name: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  start_date: string | null
  end_date: string | null
  payment_terms: string | null
  notes: string | null
  is_active: boolean
  created_at?: string
}

export interface ContractClient {
  id: string
  contract_id: string
  name: string
  created_at?: string
}

export interface SubcontractorRate {
  id: string
  subcontractor_id: string
  name: string
  rate_per_hour: number
  is_active: boolean
  sort_order: number
  created_at?: string
}

export interface ContractRate {
  id: string
  contract_id: string
  name: string
  rate_per_hour: number
  is_active: boolean
  sort_order: number
  created_at?: string
}

export interface Job {
  id: string
  job_number: string
  date: string
  subcontractor_id: string
  customer_id: string | null
  pickup_address: string | null
  delivery_address: string | null
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
  // Manual override for total worked hours, applied uniformly to every crew
  // member / casual crew / extra man on this job — used for TMAAT/TMAAT TT
  // jobs (round_up_hours=false subcontractors) where TMAAT's own portal
  // rounds hours in a way we can't reliably reverse-engineer from start/
  // finish times (see migration_v50). NULL means no override — hours are
  // computed live from times as usual.
  manual_hours_override: number | null
  discount: number
  notes: string | null
  completion_notes: string | null
  actual_start_time: string | null
  actual_finish_time: string | null
  contract_id: string | null
  contract_client_id: string | null
  client_billing_config: SubcontractorConfig | null
  scheduled_time: string | null
  scheduled_finish_time: string | null
  reference_number: string | null
  private_rate_id: string | null
  private_rate_custom: boolean
  private_rate_custom_desc: string | null
  private_rate_custom_price: number | null
  private_rate_custom_gst_exclusive: boolean
  // Fixed Rate mode (migration_v56): a single flat $ amount billed to the
  // client for the whole job (e.g. "2 Packers, 4hr minimum"), independent of
  // hours worked. Mutually exclusive with private_rate_id/private_rate_custom.
  // Never affects crew payroll — see calculatePayroll in billing.ts.
  private_rate_fixed: boolean
  private_rate_fixed_desc: string | null
  private_rate_fixed_price: number | null
  private_rate_fixed_gst_exclusive: boolean
  google_review: boolean
  google_review_employee_ids: string[]
  payment_date: string | null
  paid_at: string | null
  payment_methods: string[]
  payment_cash_amount: number
  payment_transfer_amount: number
  payment_card_amount: number
  payment_collected_by: string | null
  cancellation_reason: string | null
  minimum_charge_applied: boolean
  minimum_charge_amount: number
  override_revenue: number | null
  subcontractor_service_type: string | null
  subcontractor_trucks: string | null
  subcontractor_crew_size: number | null
  subcontractor_rate_id: string | null
  contract_rate_id: string | null
  contractor_job_id: string | null
  gross_job_value: number | null
  deposit: number | null
  contract_rate_custom_price: number | null
  contract_client_name: string | null
  heavy_item_charge: number | null
  // Optional flat $ override for the client-facing Call Out charge — used
  // when the amount charged isn't a clean multiple of the rate (migration_v54).
  // Added on top of revenue exactly like heavy_item_charge, never folded into
  // the hours-based client_cof_hours field.
  client_cof_manual_charge: number | null
  malibu_revenue: number | null
  created_at?: string
  subcontractor?: Subcontractor
  customer?: Customer
  job_crew?: JobCrew[]
  job_materials?: JobMaterial[]
  job_photos?: JobPhoto[]
}

export interface JobCrew {
  id: string
  job_id: string
  employee_id: string
  hours: number
  cof_share: boolean
  cof_hours: number
  heavy_item: boolean
  role: string | null
  start_time: string | null
  end_time: string | null
  // Per-person manual hours override (migration_v55) — takes priority over
  // both this row's own start/end time AND the job-level manual_hours_override,
  // letting the office correct one crew member's hours without affecting
  // everyone else on the job. NULL = no override, use computed hours as usual.
  hours_override: number | null
  employee?: Employee
}

export interface JobMaterial {
  id: string
  job_id: string
  material_name: string
  quantity: number
  cost_price: number
  sale_price: number
}

export interface JobExtraMan {
  id: string
  job_id: string
  employee_id: string | null
  start_time: string | null
  finish_time: string | null
  // Per-person minimum call-out hours (migration_v51). Extra men are often
  // brought on as a one-off "sweetener" for a far/late job — the office
  // promises a guaranteed minimum payout (e.g. 4h) even if they end up
  // working less. NULL falls back to the standard 2h minimum.
  minimum_hours: number | null
  // Per-person manual hours override (migration_v55) — see JobCrew.hours_override.
  hours_override: number | null
  created_at?: string
}

export interface JobPhoto {
  id: string
  job_id: string
  url: string
  caption: string | null
  category: string
  created_at?: string
}

export interface JobCasualCrew {
  id: string
  job_id: string
  name: string
  rate_per_hour: number
  heavy_item: boolean
  start_time: string | null
  finish_time: string | null
  // Per-person manual hours override (migration_v55) — see JobCrew.hours_override.
  hours_override: number | null
  created_at?: string
}

export interface CommissionType {
  id: string
  name: string
  rate_per_hour: number
  is_active: boolean
  sort_order: number
  created_at?: string
}

export interface CasualWorker {
  id: string
  name: string
  rate_per_hour: number
  phone: string | null
  notes: string | null
  referrer_id: string | null
  referrer_commission_per_hour: number
  role: string | null
  created_at?: string
}

export interface JobCommission {
  id: string
  job_id: string
  commission_type_id: string | null
  employee_id: string | null
  rate_per_hour: number
  hours: number
  created_at?: string
  commission_type?: CommissionType
  employee?: Employee
}

type TableDef<Row, Insert, Update> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export interface Database {
  public: {
    Tables: {
      employees: TableDef<
        Employee,
        Omit<Employee, 'id' | 'created_at'>,
        Partial<Omit<Employee, 'id' | 'created_at'>>
      >
      subcontractors: TableDef<
        Subcontractor,
        Omit<Subcontractor, 'id' | 'created_at'>,
        Partial<Omit<Subcontractor, 'id' | 'created_at'>>
      >
      customers: TableDef<
        Customer,
        Omit<Customer, 'id' | 'created_at'>,
        Partial<Omit<Customer, 'id' | 'created_at'>>
      >
      contracts: TableDef<
        Contract,
        Omit<Contract, 'id' | 'created_at'>,
        Partial<Omit<Contract, 'id' | 'created_at'>>
      >
      contract_clients: TableDef<
        ContractClient,
        Omit<ContractClient, 'id' | 'created_at'>,
        Partial<Omit<ContractClient, 'id' | 'created_at'>>
      >
      jobs: TableDef<
        Job,
        Omit<Job, 'id' | 'created_at' | 'subcontractor' | 'customer' | 'job_crew' | 'job_materials' | 'job_photos'>,
        Partial<Omit<Job, 'id' | 'created_at' | 'subcontractor' | 'customer' | 'job_crew' | 'job_materials' | 'job_photos'>>
      >
      job_crew: TableDef<
        JobCrew,
        Omit<JobCrew, 'id' | 'employee'>,
        Partial<Omit<JobCrew, 'id' | 'employee'>>
      >
      job_materials: TableDef<
        JobMaterial,
        Omit<JobMaterial, 'id'>,
        Partial<Omit<JobMaterial, 'id'>>
      >
      job_photos: TableDef<
        JobPhoto,
        Omit<JobPhoto, 'id' | 'created_at'>,
        Partial<Omit<JobPhoto, 'id' | 'created_at'>>
      >
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      billing_type_enum: BillingType
      job_source_enum: JobSource
      job_status_enum: JobStatus
    }
    CompositeTypes: Record<string, never>
  }
}
