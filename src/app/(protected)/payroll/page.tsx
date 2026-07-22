'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Employee, JobSource, JobStatus } from '@/types/database'

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
  actual_start_time: string | null
  actual_finish_time: string | null
  break_minutes: number | null
  subcontractor: { name: string } | null
  customer: { name: string } | null
  contract: { name: string } | null
  contract_client: { name: string } | null
  job_crew: PayrollCrewRow[]
  job_extra_men: Array<{ employee_id: string | null; rate_per_hour: number | null; start_time: string | null; finish_time: string | null; cof_share: boolean }>
}

// Always rounds UP to the next 15-minute block — same rule as the job page,
// Dashboard, and Invoices. breakMinutes (job-level only) is subtracted BEFORE
// rounding, same order as JobForm's workedHoursCalc — subtracting it after
// rounding gives a different (wrong) result since the break may cross a
// 15-min boundary.
function calcHoursFromTimes(start: string, finish: string, breakMinutes = 0): number {
  const [sh, sm] = start.split(':').map(Number)
  const [fh, fm] = finish.split(':').map(Number)
  const mins = (fh * 60 + fm) - (sh * 60 + sm) - breakMinutes
  return Math.max(0, Math.ceil(mins / 15) * 15 / 60)
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
  reviewed: 'bg-cyan-500/10 text-cyan-300',
  invoiced: 'bg-purple-500/10 text-purple-300',
  paid:     'bg-teal-500/10 text-teal-300',
}

function jobEntityName(job: PayrollJob): string {
  if (job.source === 'private') return job.customer?.name ?? '—'
  if (job.source === 'contract') {
    const base = job.contract?.name ?? '—'
    return job.contract_client?.name ? `${base} → ${job.contract_client.name}` : base
  }
  return job.subcontractor?.name ?? '—'
}

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
        actual_start_time, actual_finish_time, break_minutes,
        subcontractor:subcontractors(name),
        customer:customers(name),
        contract:contracts(name),
        contract_client:contract_clients(name),
        job_crew(employee_id, hours, cof_share, cof_hours, start_time, end_time),
        job_extra_men(employee_id, rate_per_hour, start_time, finish_time, cof_share)
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
            // Recompute worked hours live from times (own row times, falling back
            // to job-level actual_start/finish) instead of trusting the stored
            // `hours` column, which can go stale relative to the current rounding
            // rule. Mirrors JobForm's resolveCrewHours/baseHrs and the Invoices fix.
            const hasTime = row.start_time?.length === 5 && row.end_time?.length === 5
            const jobLevelHours = (() => {
              if (!job.actual_start_time || !job.actual_finish_time) return null
              const raw = calcHoursFromTimes(job.actual_start_time, job.actual_finish_time, Number(job.break_minutes) || 0)
              return raw > 0 ? raw : null
            })()
            const workedHours = hasTime
              ? calcHoursFromTimes(row.start_time!, row.end_time!, Number(job.break_minutes) || 0)
              : (jobLevelHours ?? row.hours)
            const cofHours = row.cof_share ? (row.cof_hours > 0 ? row.cof_hours : Number(job.cof_final ?? job.cof ?? 0)) : 0
            const reviewBonus = (job.google_review && job.google_review_employee_ids?.includes(emp.id)) ? 0.5 : 0
            const paidHours = Math.max(workedHours, MIN_CALL) + cofHours + reviewBonus
            const workedTime = (row.start_time && row.end_time)
              ? `${row.start_time.slice(0, 5)}–${row.end_time.slice(0, 5)}`
              : null
            entries.push({ job, workedHours, workedTime, cofHours, paidHours, pay: paidHours * emp.hourly_rate, googleReviewBonus: reviewBonus > 0 })
          }
          for (const em of job.job_extra_men ?? []) {
            if (em.employee_id !== emp.id) continue
            const hasTime = em.start_time?.length === 5 && em.finish_time?.length === 5
            const jobLevelHours = (() => {
              if (!job.actual_start_time || !job.actual_finish_time) return null
              const raw = calcHoursFromTimes(job.actual_start_time, job.actual_finish_time, Number(job.break_minutes) || 0)
              return raw > 0 ? raw : null
            })()
            const workedHours = hasTime ? calcHoursFromTimes(em.start_time!, em.finish_time!, Number(job.break_minutes) || 0) : (jobLevelHours ?? 0)
            if (workedHours <= 0) continue
            const cofHours = em.cof_share ? Number(job.cof_final ?? job.cof ?? 0) : 0
            const reviewBonus = (job.google_review && job.google_review_employee_ids?.includes(emp.id)) ? 0.5 : 0
            const paidHours = Math.max(workedHours, MIN_CALL) + cofHours + reviewBonus
            const workedTime = (em.start_time && em.finish_time)
              ? `${em.start_time.slice(0, 5)}–${em.finish_time.slice(0, 5)}`
              : null
            const rate = em.rate_per_hour || emp.hourly_rate
            entries.push({
              job,
              workedHours,
              workedTime,
              cofHours,
              paidHours,
              pay: paidHours * rate,
              isExtraMan: true,
              googleReviewBonus: reviewBonus > 0,
            })
          }
          // Legacy single-extra-man fields, kept only for any historical jobs
          // saved before the job_extra_men table existed.
          if (job.extra_man_employee_id === emp.id && job.extra_men_hours > 0 && !(job.job_extra_men ?? []).some((em) => em.employee_id === emp.id)) {
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
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-display font-bold text-parchment">Payroll</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekStart((d) => addDays(d, -7))}
            className="p-1.5 rounded-lg hover:bg-panel text-warm hover:text-parchment transition-colors"
            aria-label="Previous week"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => setWeekStart(getMonday(new Date()))}
            className="text-sm font-semibold text-parchment min-w-[180px] text-center hover:text-gold transition-colors"
          >
            {fmtWeekRange(weekStart)}
          </button>
          <button
            onClick={() => setWeekStart((d) => addDays(d, 7))}
            className="p-1.5 rounded-lg hover:bg-panel text-warm hover:text-parchment transition-colors"
            aria-label="Next week"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <p className="text-xs text-dim mb-4">
        Showing jobs with status <span className="font-medium text-warm">Reviewed · Invoiced · Paid</span> only.
      </p>

      {loading ? (
        <p className="text-warm text-sm py-12 text-center">Loading…</p>
      ) : employeeData.length === 0 ? (
        <div className="bg-surface rounded-xl border border-wire p-12 text-center">
          <p className="text-dim">No reviewed jobs in this period.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {employeeData.map(({ emp, entries, totalPaidHours, totalPay }) => {
            const declaredVal = parseFloat(declared[emp.id] ?? '')
            const hasDeclared = !isNaN(declaredVal)
            const diff = hasDeclared ? declaredVal - totalPaidHours : null
            const diffBad = diff !== null && Math.abs(diff) > 0.01

            return (
              <div key={emp.id} className="bg-surface rounded-xl border border-wire overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-panel border-b border-wire">
                  <div>
                    <span className="font-semibold text-parchment">{emp.name}</span>
                    <span className="ml-2 text-xs text-dim font-mono">${emp.hourly_rate}/hr</span>
                  </div>
                  <span className="text-sm font-mono font-bold text-gold">{fmtMoney(totalPay)}</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-wire">
                        <th className="text-left px-4 py-2 text-[10px] font-semibold text-dim uppercase tracking-widest">Date</th>
                        <th className="text-left px-4 py-2 text-[10px] font-semibold text-dim uppercase tracking-widest">Job</th>
                        <th className="text-right px-4 py-2 text-[10px] font-semibold text-dim uppercase tracking-widest">Worked</th>
                        <th className="text-right px-4 py-2 text-[10px] font-semibold text-dim uppercase tracking-widest">Call Out Fee</th>
                        <th className="text-right px-4 py-2 text-[10px] font-semibold text-dim uppercase tracking-widest">Paid hrs</th>
                        <th className="text-right px-4 py-2 text-[10px] font-semibold text-dim uppercase tracking-widest">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-wire">
                      {entries.map(({ job, workedHours, workedTime, cofHours, paidHours, pay, isExtraMan, googleReviewBonus }) => (
                        <tr key={`${job.id}-${isExtraMan ? 'em' : 'crew'}`} className="hover:bg-panel transition-colors">
                          <td className="px-4 py-2 text-warm whitespace-nowrap">{job.date}</td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-parchment">#{job.job_number}</span>
                              {STATUS_PILL[job.status] && (
                                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_PILL[job.status]}`}>
                                  {job.status}
                                </span>
                              )}
                              {googleReviewBonus && (
                                <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-gold/15 text-gold">★ +0.5h</span>
                              )}
                            </div>
                            <div className="text-xs text-dim truncate max-w-[160px]">{jobEntityName(job)}</div>
                          </td>
                          <td className="px-4 py-2 text-right text-warm font-mono">
                            {isExtraMan
                              ? <span className="inline-flex items-center gap-1 text-amber-300 font-medium">+{fmtHours(workedHours)} <span className="text-xs font-normal text-dim">extra</span></span>
                              : fmtHours(workedHours)
                            }
                            {workedTime && <div className="text-xs text-dim tabular-nums">{workedTime}</div>}
                          </td>
                          <td className="px-4 py-2 text-right font-mono">
                            {cofHours > 0 ? <span className="text-blue-300">+{fmtHours(cofHours)}</span> : <span className="text-dim">—</span>}
                          </td>
                          <td className="px-4 py-2 text-right font-mono font-medium text-parchment">{fmtHours(paidHours)}</td>
                          <td className="px-4 py-2 text-right font-mono font-semibold text-gold">{fmtMoney(pay)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="px-4 py-3 border-t border-wire flex items-center justify-between gap-4 flex-wrap bg-panel/50">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="text-sm">
                      <span className="text-dim">Total hrs: </span>
                      <span className="font-mono font-semibold text-parchment">{fmtHours(totalPaidHours)}</span>
                    </div>
                    <div className="text-sm">
                      <span className="text-dim">Total pay: </span>
                      <span className="font-mono font-bold text-gold">{fmtMoney(totalPay)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="text-xs text-dim whitespace-nowrap">Declared hrs:</label>
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      value={declared[emp.id] ?? ''}
                      onChange={(e) => setDeclared((d) => ({ ...d, [emp.id]: e.target.value }))}
                      placeholder={fmtHours(totalPaidHours)}
                      className="w-20 px-2 py-1 text-sm border border-wire rounded-lg bg-surface text-parchment focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring text-right font-mono"
                    />
                    {hasDeclared && diff !== null && (
                      diffBad ? (
                        <div className="flex items-center gap-1 text-amber-300 text-xs font-medium">
                          <AlertTriangle size={13} />
                          {diff > 0 ? `+${fmtHours(Math.abs(diff))} over` : `${fmtHours(Math.abs(diff))} under`}
                        </div>
                      ) : (
                        <span className="text-success text-xs font-medium">✓ Match</span>
                      )
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          <div className="bg-gold/10 border border-gold-ring rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-display font-semibold text-gold">Total payroll this week</span>
            <span className="text-lg font-mono font-bold text-gold">{fmtMoney(grandTotal)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
