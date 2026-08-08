'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Copy, Check, ClipboardList } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const MIN_CALL = 2
const HEAVY_ITEM_BONUS = 0.5
const REVIEW_BONUS = 0.5

// ── Date helpers (same conventions as Invoices/Dashboard) ───────────────────
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
function fmtDateSlash(iso: string): string {
  const d = parseISODate(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}`
}
function fmtTime12(hhmm: string | null): string | null {
  if (!hhmm || hhmm.length < 4) return null
  const [h, m] = hhmm.split(':').map(Number)
  const period = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, '0')}${period}`
}
// Formats a decimal-hours duration as "30mins" / "1 hour" / "1.5 hours" / "2h 15m".
function fmtDuration(hoursVal: number): string {
  const totalMinutes = Math.round(hoursVal * 60)
  if (totalMinutes % 60 === 0) {
    const h = totalMinutes / 60
    return `${h} hour${h === 1 ? '' : 's'}`
  }
  if (totalMinutes < 60) return `${totalMinutes}mins`
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${h}h ${m}m`
}
function fmtHours(n: number): string {
  return n % 1 === 0 ? `${n}h` : `${n.toFixed(2)}h`
}

// ── Same hour-calc rules used by JobForm/Invoices/Dashboard ─────────────────
// Mirrors calcHoursFromTimes/jobRoundUp/jobManualHours/the per-row payroll
// logic in invoices/page.tsx's employeeData & casualData builders —
// duplicated here rather than shared, following this codebase's existing
// convention of one small self-contained copy per page. Kept deliberately
// identical so each person's Hours here always matches their own Invoices
// tab total for the same period.
function calcHoursFromTimes(start: string, finish: string, breakMinutes = 0, roundToBlock = true): number {
  const [sh, sm] = start.split(':').map(Number)
  const [fh, fm] = finish.split(':').map(Number)
  const mins = (fh * 60 + fm) - (sh * 60 + sm) - breakMinutes
  if (mins <= 0) return 0
  if (!roundToBlock) return Math.round((mins / 60) * 100) / 100
  return Math.ceil(mins / 15) * 15 / 60
}
function jobRoundUp(job: RecapJob): boolean {
  return job.source === 'subcontract' && job.subcontractor ? (job.subcontractor.round_up_hours ?? true) : true
}
function jobManualHours(job: RecapJob): number | null {
  if (job.manual_hours_override == null) return null
  return Math.max(0, job.manual_hours_override - Math.max(0, job.break_minutes ?? 0) / 60)
}
function entityLabel(job: RecapJob): string {
  if (job.source === 'private') return job.customer?.name ?? '—'
  if (job.source === 'contract') {
    const base = job.contract?.name ?? '—'
    return job.contract_client?.name ? `${base} → ${job.contract_client.name}` : base
  }
  return job.subcontractor?.name ?? '—'
}

interface RecapJob {
  id: string
  job_number: string
  date: string
  source: string
  cof: number | null
  cof_final: number | null
  break_minutes: number
  manual_hours_override: number | null
  actual_start_time: string | null
  actual_finish_time: string | null
  google_review: boolean
  google_review_employee_ids: string[]
  subcontractor: { name: string; round_up_hours: boolean | null } | null
  customer: { name: string } | null
  contract: { name: string } | null
  contract_client: { name: string } | null
  job_crew: Array<{ employee_id: string; employee: { name: string } | null; hours_override: number | null; start_time: string | null; end_time: string | null; cof_share: boolean; heavy_item: boolean }>
  job_casual_crew: Array<{ name: string; casual_worker_id: string | null; hours_override: number | null; start_time: string | null; finish_time: string | null; cof_share: boolean; heavy_item: boolean }>
  job_extra_men: Array<{ employee_id: string | null; name: string | null; hours_override: number | null; start_time: string | null; finish_time: string | null; cof_share: boolean; minimum_hours: number | null }>
}

interface PersonJobEntry {
  jobId: string
  jobNumber: string
  date: string
  entity: string
  truck: string | null
  start: string | null
  finish: string | null
  cofHours: number
  isOverride: boolean
  review: boolean
  hours: number
}

interface PersonRecap {
  key: string
  name: string
  entries: PersonJobEntry[]
  totalHours: number
  text: string
}

export default function WeeklyRecapPage() {
  const router = useRouter()
  const supabase = createClient()
  const [weekStart, setWeekStart] = useState<Date>(() => addDays(getMonday(new Date()), -7)) // defaults to LAST week
  const [jobs, setJobs] = useState<RecapJob[]>([])
  const [trucksByJob, setTrucksByJob] = useState<Map<string, string[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copiedAll, setCopiedAll] = useState(false)
  const [search, setSearch] = useState('')

  const weekEnd = addDays(weekStart, 6)
  const from = toISODate(weekStart)
  const to = toISODate(weekEnd)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select(`
          id, job_number, date, source,
          cof, cof_final, break_minutes, manual_hours_override,
          actual_start_time, actual_finish_time, google_review, google_review_employee_ids,
          subcontractor:subcontractors(name, round_up_hours),
          customer:customers(name),
          contract:contracts(name),
          contract_client:contract_clients(name),
          job_crew(employee_id, employee:employees(name), hours_override, start_time, end_time, cof_share, heavy_item),
          job_casual_crew(name, casual_worker_id, hours_override, start_time, finish_time, cof_share, heavy_item),
          job_extra_men(employee_id, name, hours_override, start_time, finish_time, cof_share, minimum_hours)
        `)
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: true })
        .order('job_number', { ascending: true })

      if (cancelled) return
      if (error) {
        console.error(error)
        setJobs([])
        setLoading(false)
        return
      }
      const rows = (data ?? []) as unknown as RecapJob[]
      setJobs(rows)

      // job_trucks is a newer table — fetch it defensively so this page still
      // works (just without the Truck line) on any environment where it
      // hasn't been migrated yet, same pattern Dashboard uses.
      try {
        const ids = rows.map((r) => r.id)
        if (ids.length > 0) {
          const { data: trucks } = await supabase
            .from('job_trucks')
            .select('job_id, fleet:fleet(registration, name)')
            .in('job_id', ids)
          const map = new Map<string, string[]>()
          for (const t of (trucks ?? []) as unknown as Array<{ job_id: string; fleet: { registration: string | null; name: string } | null }>) {
            const label = t.fleet?.registration || t.fleet?.name
            if (!label) continue
            const list = map.get(t.job_id) ?? []
            list.push(label)
            map.set(t.job_id, list)
          }
          if (!cancelled) setTrucksByJob(map)
        } else if (!cancelled) {
          setTrucksByJob(new Map())
        }
      } catch {
        if (!cancelled) setTrucksByJob(new Map())
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [from, to, supabase])

  const people = useMemo<PersonRecap[]>(() => {
    const byKey = new Map<string, { name: string; entries: PersonJobEntry[] }>()

    function addEntry(key: string, name: string, entry: PersonJobEntry) {
      if (!byKey.has(key)) byKey.set(key, { name, entries: [] })
      byKey.get(key)!.entries.push(entry)
    }

    for (const job of jobs) {
      const roundToBlock = jobRoundUp(job)
      const manualHours = jobManualHours(job)
      const jobLevelHours = (() => {
        if (!job.actual_start_time || !job.actual_finish_time) return null
        const raw = calcHoursFromTimes(job.actual_start_time, job.actual_finish_time, Number(job.break_minutes) || 0, roundToBlock)
        return raw > 0 ? raw : null
      })()
      const cofFinalHrs = Number(job.cof_final ?? job.cof) || 0
      const entity = entityLabel(job)
      const truck = trucksByJob.get(job.id)?.join(' + ') ?? null

      // Staff crew
      for (const row of job.job_crew ?? []) {
        if (!row.employee?.name) continue
        const hasTime = row.start_time?.length === 5 && row.end_time?.length === 5
        const rowOverride = row.hours_override
        const workedHours = (rowOverride != null && rowOverride > 0) ? rowOverride : (manualHours ?? (hasTime
          ? calcHoursFromTimes(row.start_time!, row.end_time!, Number(job.break_minutes) || 0, roundToBlock)
          : (jobLevelHours ?? 0)))
        const isOverride = (rowOverride != null && rowOverride > 0) || manualHours !== null
        const cofHours = isOverride ? 0 : (row.cof_share ? cofFinalHrs : 0)
        const reviewBonus = (job.google_review && job.google_review_employee_ids?.includes(row.employee_id)) ? REVIEW_BONUS : 0
        const heavyItemBonus = row.heavy_item ? HEAVY_ITEM_BONUS : 0
        const hours = Math.max(workedHours, MIN_CALL) + cofHours + reviewBonus + heavyItemBonus
        if (hours <= 0) continue
        addEntry(`emp:${row.employee_id}`, row.employee.name, {
          jobId: job.id, jobNumber: job.job_number, date: job.date, entity, truck,
          start: fmtTime12(row.start_time ?? job.actual_start_time),
          finish: fmtTime12(row.end_time ?? job.actual_finish_time),
          cofHours, isOverride, review: reviewBonus > 0, hours,
        })
      }

      // Casual crew
      for (const row of job.job_casual_crew ?? []) {
        const name = row.name?.trim()
        if (!name) continue
        const hasTime = row.start_time?.length === 5 && row.finish_time?.length === 5
        const rowOverride = row.hours_override
        const rawHours = (rowOverride != null && rowOverride > 0) ? rowOverride : (manualHours ?? (hasTime
          ? calcHoursFromTimes(row.start_time!, row.finish_time!, Number(job.break_minutes) || 0, roundToBlock)
          : (jobLevelHours ?? 0)))
        const workedHours = rawHours > 0 ? Math.max(MIN_CALL, rawHours) : 0
        const isOverride = (rowOverride != null && rowOverride > 0) || manualHours !== null
        const cofHours = isOverride ? 0 : (row.cof_share ? cofFinalHrs : 0)
        const reviewBonus = row.casual_worker_id ? ((job.google_review && job.google_review_employee_ids?.includes(row.casual_worker_id)) ? REVIEW_BONUS : 0) : 0
        const heavyItemBonus = row.heavy_item ? HEAVY_ITEM_BONUS : 0
        const hours = workedHours + cofHours + reviewBonus + heavyItemBonus
        if (hours <= 0) continue
        addEntry(`casual:${name.toLowerCase()}`, name, {
          jobId: job.id, jobNumber: job.job_number, date: job.date, entity, truck,
          start: fmtTime12(row.start_time ?? job.actual_start_time),
          finish: fmtTime12(row.finish_time ?? job.actual_finish_time),
          cofHours, isOverride, review: reviewBonus > 0, hours,
        })
      }

      // Extra men — keyed the same way as staff/casual so someone who shows
      // up as an Extra Man on one job and regular crew on another still gets
      // a single combined weekly total.
      for (const em of job.job_extra_men ?? []) {
        const name = em.name?.trim()
        if (!name) continue
        const hasTime = em.start_time?.length === 5 && em.finish_time?.length === 5
        const emOverride = em.hours_override
        const workedHours = (emOverride != null && emOverride > 0) ? emOverride : (manualHours ?? (hasTime
          ? calcHoursFromTimes(em.start_time!, em.finish_time!, Number(job.break_minutes) || 0, roundToBlock)
          : (jobLevelHours ?? 0)))
        if (workedHours <= 0) continue
        const isOverride = (emOverride != null && emOverride > 0) || manualHours !== null
        const cofHours = isOverride ? 0 : (em.cof_share ? cofFinalHrs : 0)
        const minCall = em.minimum_hours && em.minimum_hours > 0 ? em.minimum_hours : MIN_CALL
        const reviewBonus = (em.employee_id && job.google_review && job.google_review_employee_ids?.includes(em.employee_id)) ? REVIEW_BONUS : 0
        const hours = Math.max(workedHours, minCall) + cofHours + reviewBonus
        const key = em.employee_id ? `emp:${em.employee_id}` : `casual:${name.toLowerCase()}`
        addEntry(key, name, {
          jobId: job.id, jobNumber: job.job_number, date: job.date, entity, truck,
          start: fmtTime12(em.start_time ?? job.actual_start_time),
          finish: fmtTime12(em.finish_time ?? job.actual_finish_time),
          cofHours, isOverride, review: reviewBonus > 0, hours,
        })
      }
    }

    return [...byKey.entries()]
      .map(([key, { name, entries }]) => {
        const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date))
        const totalHours = sorted.reduce((s, e) => s + e.hours, 0)
        const lines = [name, '']
        for (const e of sorted) {
          lines.push(`${fmtDateSlash(e.date)} — ${e.entity}${e.truck ? ` (Truck: ${e.truck})` : ''}`)
          if (e.start && e.finish) lines.push(`Start: ${e.start} | Finish: ${e.finish}`)
          else if (e.start) lines.push(`Start: ${e.start}`)
          if (e.cofHours > 0) lines.push(`Call out Fee: ${fmtDuration(e.cofHours)}`)
          lines.push(`Review: ${e.review ? 'Yes' : 'No'}`)
          lines.push(`Hours: ${fmtHours(e.hours)}${e.isOverride ? ' (manual override)' : ''}`)
          lines.push('')
        }
        lines.push(`Total this week: ${fmtHours(totalHours)}`)
        return { key, name, entries: sorted, totalHours, text: lines.join('\n') }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [jobs, trucksByJob])

  const filteredPeople = people.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))

  async function copyText(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500)
    } catch {
      // Clipboard API unavailable — nothing more we can safely do here.
    }
  }

  async function copyAll() {
    const text = filteredPeople.map((p) => p.text).join('\n\n———\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopiedAll(true)
      setTimeout(() => setCopiedAll(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
        <h1 className="text-2xl font-display font-bold text-parchment flex items-center gap-2">
          <ClipboardList size={22} className="text-gold" />
          Weekly Recap
        </h1>
        <div className="flex items-center gap-1">
          <button onClick={() => setWeekStart((w) => addDays(w, -7))} className="p-1.5 rounded-lg hover:bg-panel text-warm hover:text-parchment transition-colors">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-semibold text-parchment min-w-[170px] text-center px-1">
            {fmtWeekRange(weekStart)}
          </span>
          <button onClick={() => setWeekStart((w) => addDays(w, 7))} className="p-1.5 rounded-lg hover:bg-panel text-warm hover:text-parchment transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <p className="text-sm text-dim mb-4">
        One block per person — copy theirs into the WhatsApp group so they can check their own hours against what&apos;s on file. If something&apos;s off, click into the job below and fix it.
      </p>

      {loading ? (
        <p className="text-warm text-sm py-12 text-center">Loading…</p>
      ) : people.length === 0 ? (
        <div className="bg-surface rounded-xl border border-wire p-12 text-center text-dim">
          No completed jobs with staff for this week yet.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <input
              type="text"
              placeholder="Search person…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-1.5 text-sm border border-wire rounded-lg bg-panel text-parchment focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring w-52"
            />
            <button
              onClick={copyAll}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg bg-gold hover:bg-gold-bright text-[#0d0d0d] transition-colors"
            >
              {copiedAll ? <Check size={14} /> : <Copy size={14} />}
              {copiedAll ? 'Copied!' : 'Copy all'}
            </button>
          </div>
          {filteredPeople.map((p) => (
            <div key={p.key} className="bg-surface rounded-xl border border-wire p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-parchment">{p.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-gold font-bold">{fmtHours(p.totalHours)}</span>
                  <button
                    onClick={() => copyText(p.text, p.key)}
                    className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-lg border border-wire text-warm hover:text-parchment hover:bg-panel transition-colors"
                  >
                    {copiedId === p.key ? <Check size={13} /> : <Copy size={13} />}
                    {copiedId === p.key ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
              <div className="space-y-1 mb-2">
                {p.entries.map((e, i) => (
                  <button
                    key={`${e.jobId}-${i}`}
                    onClick={() => router.push(`/jobs/${e.jobId}/edit`)}
                    className="block text-xs font-mono text-dim hover:text-gold transition-colors"
                  >
                    #{e.jobNumber} — {fmtDateSlash(e.date)} — {e.entity} — {fmtHours(e.hours)}
                  </button>
                ))}
              </div>
              <pre className="whitespace-pre-wrap font-mono text-sm text-parchment leading-relaxed border-t border-wire pt-2">{p.text}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
