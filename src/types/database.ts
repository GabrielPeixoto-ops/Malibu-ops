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
  invoice_number_prefix: string | null
  next_invoice_number: number | null
  invoice_frequency: string | null
  invoice_due_days: number | null
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
  google_review: boolean
  google_review_employee_ids: string[]
  payment_date: string | null
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
  role: string | null
  start_time: string | null
  end_time: string | null
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
  start_time: string | null
  finish_time: string | null
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
