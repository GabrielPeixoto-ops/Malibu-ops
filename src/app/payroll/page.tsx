'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Employee, JobSource, JobStatus } from '@/types/database'

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

function fmtWeekRange(start: Date): string {
  const end = addDays(start, 6)
  const s = start.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  const e = end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${s} – ${e}`
}

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 })
}

function fmtHours(n: number) {
  return n % 1 === 0 ? `${n}h` : `${n.toFixed(2)}h`
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface PayrollCrewRow {
  employee_id: string
  hours: number
  cof_share: boolean
  cof_hours: number
  start_time: string | null
  end_time: string | null
}

interface PayrollJob {
  id: string
  job_number: string
  date: string
  status: JobStatus
  source: JobSource
  cof: number | null
  cof_final: number | null
  extra_men_hours: number
  extra_man_employee_id: string | null
  google_review: boolean
  google_review_employee_ids: string[]
  subcontractor: { name: string } | null
  customer: { name: string } | null
  contract: { name: string } | null
  contract_client: { name: string } | null
  job_crew: PayrollCrewRow[]
}

interface EmployeeEntry {
  job: PayrollJob
  workedHours: number
  workedTime: string | null
  cofHours: number
  paidHours: number
  pay: number
  isExtraMan?: boolean
  googleReviewBonus?: boolean
}

const MIN_CALL = 2

const STATUS_PILL: Partial<Record<JobStatus, string>> = {
  reviewed: 'bg-cyan-100 text-cyan-700',
  invoiced: 'bg-purple-100 text-purple-700',
  paid: 'bg-teal-100 text-teal-700',
}

function jobEntityName(job: PayrollJob): string {
  if (job.source === 'private') return job.customer?.name ?? '—'
  if (job.source === 'contract') {
    const base = job.contract?.name ?? '—'
    return job.contract_client?.name ? `${base} → ${job.contract_client.name}` : base
  }
  return job.subcontractor?.name ?? '—'
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function PayrollPage() {
  const supabase = createClient()

  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()))
  const [employees, setEmployees] = useState<Employee[]>([])
  const [jobs, setJobs] = useState<PayrollJob[]>([])
  const [loading, setLoading] = useState(true)
  const [declared, setDeclared] = useState<Record<string, string>>({})

  useEffect(() => {
    supabase.from('employees').select('*').eq('active', true).order('name').then(({ data }) => {
      setEmployees((data ?? []) as Employee[])
    })
  }, [])

  useEffect(() => {
    setLoading(true)
    const start = toISO(weekStart)
    const end = toISO(addDays(weekStart, 6))
    supabase
      .from('jobs')
      .select(`
        id, job_number, date, status, source,
        cof, cof_final, extra_men_hours, extra_man_employee_id,
        google_review, google_review_employee_ids,
        subcontractor:subcontractors(name),
        customer:customers(name),
        contract:contracts(name),
        contract_client:contract_clients(name),
        job_crew(employee_id, hours, cof_share, cof_hours, start_time, end_time)
      `)
      .in('status', ['reviewed', 'invoiced', 'paid'])
      .gte('date', start)
      .lte('date', end)
      .order('date')
      .then(({ data }) => {
        setJobs((data ?? []) as unknown as PayrollJob[])
        setLoading(false)
      })
  }, [weekStart])

  const employeeData = useMemo(() => {
    return employees
      .map((emp) => {
        const entries: EmployeeEntry[] = []
        for (const job of jobs) {
          const row = job.job_crew.find((c) => c.employee_id === emp.id)
          if (row) {
            const cofHours = row.cof_share ? (row.cof_hours > 0 ? row.cof_hours : Number(job.cof_final ?? job.cof ?? 0)) : 0
            const reviewBonus = (job.google_review && job.google_review_employee_ids?.includes(emp.id)) ? 0.5 : 0
            const paidHours = Math.max(row.hours, MIN_CALL) + cofHours + reviewBonus
            const workedTime = (row.start_time && row.end_time)
              ? `${row.start_time.slice(0, 5)}–${row.end_time.slice(0, 5)}`
              : null
            entries.push({ job, workedHours: row.hours, workedTime, cofHours, paidHours, pay: paidHours * emp.hourly_rate, googleReviewBonus: reviewBonus > 0 })
          }
          if (job.extra_man_employee_id === emp.id && job.extra_men_hours > 0) {
            entries.push({
              job,
              workedHours: job.extra_men_hours,
              workedTime: null,
              cofHours: 0,
              paidHours: job.extra_men_hours,
              pay: job.extra_men_hours * emp.hourly_rate,
              isExtraMan: true,
            })
          }
        }
        const totalPaidHours = entries.reduce((s, e) => s + e.paidHours, 0)
        const totalPay = entries.reduce((s, e) => s + e.pay, 0)
        return { emp, entries, totalPaidHours, totalPay }
      })
      .filter((d) => d.entries.length > 0)
  }, [employees, jobs])

  const grandTotal = useMemo(
    () => employeeData.reduce((s, d) => s + d.totalPay, 0),
    [employeeData]
  )

  return (
    <div className="max-w-3xl">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Payroll</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekStart((d) => addDays(d, -7))}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
            aria-label="Previous week"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => setWeekStart(getMonday(new Date()))}
            className="text-sm font-semibold text-gray-700 min-w-[180px] text-center hover:text-blue-600"
          >
            {fmtWeekRange(weekStart)}
          </button>
          <button
            onClick={() => setWeekStart((d) => addDays(d, 7))}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
            aria-label="Next week"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-400 mb-4">
        Showing jobs with status <span className="font-medium">Reviewed · Invoiced · Paid</span> only.
      </p>

      {loading ? (
        <p className="text-gray-400 text-sm py-12 text-center">Loading…</p>
      ) : employeeData.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-400">No reviewed jobs in this period.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {employeeData.map(({ emp, entries, totalPaidHours, totalPay }) => {
            const declaredVal = parseFloat(declared[emp.id] ?? '')
            const hasDeclared = !isNaN(declaredVal)
            const diff = hasDeclared ? declaredVal - totalPaidHours : null
            const diffBad = diff !== null && Math.abs(diff) > 0.01

            return (
              <div key={emp.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Employee header */}
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
                  <div>
                    <span className="font-semibold text-gray-900">{emp.name}</span>
                    <span className="ml-2 text-xs text-gray-400">${emp.hourly_rate}/hr</span>
                  </div>
                  <span className="text-sm font-bold text-gray-800">{fmtMoney(totalPay)}</span>
                </div>

                {/* Jobs table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left px-4 py-2 text-xs font-medium text-gray-400">Date</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-gray-400">Job</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-gray-400">Worked</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-gray-400">COF</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-gray-400">Paid hrs</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-gray-400">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {entries.map(({ job, workedHours, workedTime, cofHours, paidHours, pay, isExtraMan, googleReviewBonus }) => (
                        <tr key={`${job.id}-${isExtraMan ? 'em' : 'crew'}`} className="hover:bg-gray-50/50">
                          <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{job.date}</td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-gray-900">#{job.job_number}</span>
                              {STATUS_PILL[job.status] && (
                                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_PILL[job.status]}`}>
                                  {job.status}
                                </span>
                              )}
                              {googleReviewBonus && (
                                <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">★ +0.5h</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 truncate max-w-[160px]">{jobEntityName(job)}</div>
                          </td>
                          <td className="px-4 py-2 text-right text-gray-600">
                            {isExtraMan
                              ? <span className="inline-flex items-center gap-1 text-orange-600 font-medium">+{fmtHours(workedHours)} <span className="text-xs font-normal text-orange-400">extra man</span></span>
                              : fmtHours(workedHours)
                            }
                            {workedTime && <div className="text-xs text-gray-400 tabular-nums">{workedTime}</div>}
                          </td>
                          <td className="px-4 py-2 text-right text-gray-500">
                            {cofHours > 0 ? <span className="text-blue-600">+{fmtHours(cofHours)}</span> : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2 text-right font-medium text-gray-800">{fmtHours(paidHours)}</td>
                          <td className="px-4 py-2 text-right font-semibold text-gray-900">{fmtMoney(pay)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Footer */}
                <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="text-sm">
                      <span className="text-gray-500">Total hrs: </span>
                      <span className="font-semibold text-gray-900">{fmtHours(totalPaidHours)}</span>
                    </div>
                    <div className="text-sm">
                      <span className="text-gray-500">Total pay: </span>
                      <span className="font-bold text-gray-900">{fmtMoney(totalPay)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-400 whitespace-nowrap">Declared hrs:</label>
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      value={declared[emp.id] ?? ''}
                      onChange={(e) => setDeclared((d) => ({ ...d, [emp.id]: e.target.value }))}
                      placeholder={fmtHours(totalPaidHours)}
                      className="w-20 px-2 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-right"
                    />
                    {hasDeclared && diff !== null && (
                      diffBad ? (
                        <div className="flex items-center gap-1 text-orange-600 text-xs font-medium">
                          <AlertTriangle size={13} />
                          {diff > 0 ? `+${fmtHours(Math.abs(diff))} over` : `${fmtHours(Math.abs(diff))} under`}
                        </div>
                      ) : (
                        <span className="text-green-600 text-xs font-medium">✓ Match</span>
                      )
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {/* Grand total */}
          <div className="bg-gray-900 text-white rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-semibold">Total payroll this week</span>
            <span className="text-lg font-bold">{fmtMoney(grandTotal)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
