'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Copy, Check, ClipboardList } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

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
  return `${dd}/${mm}/${d.getFullYear()}`
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
function joinNames(names: string[]): string {
  const list = names.filter((n) => n.trim().length > 0)
  if (list.length === 0) return '—'
  if (list.length === 1) return list[0]
  if (list.length === 2) return `${list[0]} & ${list[1]}`
  return `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}`
}

// ── Same hour-calc rules used by JobForm/Invoices/Dashboard ─────────────────
// Mirrors calcHoursFromTimes/jobRoundUp/jobManualHours in invoices/page.tsx —
// duplicated here rather than shared, following this codebase's existing
// convention of one small self-contained copy per page (see notes in
// billing.ts). Kept deliberately identical so this page's Total always
// matches what the job itself reports.
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
  subcontractor: { name: string; round_up_hours: boolean | null } | null
  customer: { name: string } | null
  contract: { name: string } | null
  contract_client: { name: string } | null
  job_crew: Array<{ employee_id: string; employee: { name: string } | null }>
  job_casual_crew: Array<{ name: string }>
  job_extra_men: Array<{ employee_id: string | null; name: string | null }>
}

interface RecapBlock {
  jobId: string
  jobNumber: string
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
          actual_start_time, actual_finish_time, google_review,
          subcontractor:subcontractors(name, round_up_hours),
          customer:customers(name),
          contract:contracts(name),
          contract_client:contract_clients(name),
          job_crew(employee_id, employee:employees(name)),
          job_casual_crew(name),
          job_extra_men(employee_id, name)
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

  const blocks = useMemo<RecapBlock[]>(() => {
    const out: RecapBlock[] = []
    for (const job of jobs) {
      const names = [
        ...job.job_crew.map((r) => r.employee?.name).filter((n): n is string => !!n?.trim()),
        ...job.job_casual_crew.map((r) => r.name).filter((n) => n.trim()),
        ...job.job_extra_men.map((r) => r.name).filter((n): n is string => !!n?.trim()),
      ]
      if (names.length === 0) continue // no staff on this job — nothing to reconcile

      const isOverride = job.manual_hours_override != null
      const manual = jobManualHours(job)
      const roundToBlock = jobRoundUp(job)
      const rawWorked = manual !== null
        ? manual
        : (job.actual_start_time && job.actual_finish_time
          ? calcHoursFromTimes(job.actual_start_time, job.actual_finish_time, job.break_minutes || 0, roundToBlock)
          : null)
      if (rawWorked === null || rawWorked <= 0) continue // job not completed yet — skip

      const cofVal = isOverride ? 0 : (Number(job.cof_final ?? job.cof) || 0)
      const total = Math.max(2, rawWorked) + cofVal

      const start = fmtTime12(job.actual_start_time)
      const finish = fmtTime12(job.actual_finish_time)

      const lines = [
        `Date: ${fmtDateSlash(job.date)}`,
        `Customer: ${entityLabel(job)}`,
      ]
      const trucks = trucksByJob.get(job.id)
      if (trucks && trucks.length > 0) lines.push(`Truck: ${trucks.join(' + ')}`)
      lines.push(`Team: ${joinNames(names)}`)
      if (start) lines.push(`Start: ${start}`)
      if (finish) lines.push(`Finish: ${finish}`)
      if (cofVal > 0) lines.push(`Call out Fee: ${fmtDuration(cofVal)}`)
      lines.push(`Review: ${job.google_review ? 'Yes' : 'No'}`)
      const totalNote = isOverride ? ' (manual override — final hours)' : (cofVal > 0 ? ' (includes call out fee)' : '')
      lines.push(`Total: ${total % 1 === 0 ? total : total.toFixed(2)} hours${totalNote}`)

      out.push({ jobId: job.id, jobNumber: job.job_number, text: lines.join('\n') })
    }
    return out
  }, [jobs, trucksByJob])

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
    const text = blocks.map((b) => b.text).join('\n\n')
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
      <p className="text-sm text-dim mb-5">
        Copy-paste this into the crew WhatsApp group so everyone can confirm their hours match what&apos;s on file. If something&apos;s off, click into the job below and fix it.
      </p>

      {loading ? (
        <p className="text-warm text-sm py-12 text-center">Loading…</p>
      ) : blocks.length === 0 ? (
        <div className="bg-surface rounded-xl border border-wire p-12 text-center text-dim">
          No completed jobs with staff for this week yet.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={copyAll}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg bg-gold hover:bg-gold-bright text-[#0d0d0d] transition-colors"
            >
              {copiedAll ? <Check size={14} /> : <Copy size={14} />}
              {copiedAll ? 'Copied!' : 'Copy all'}
            </button>
          </div>
          {blocks.map((b) => (
            <div key={b.jobId} className="bg-surface rounded-xl border border-wire p-4">
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => router.push(`/jobs/${b.jobId}/edit`)}
                  className="text-xs font-mono text-dim hover:text-gold transition-colors"
                >
                  #{b.jobNumber}
                </button>
                <button
                  onClick={() => copyText(b.text, b.jobId)}
                  className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-lg border border-wire text-warm hover:text-parchment hover:bg-panel transition-colors"
                >
                  {copiedId === b.jobId ? <Check size={13} /> : <Copy size={13} />}
                  {copiedId === b.jobId ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre className="whitespace-pre-wrap font-mono text-sm text-parchment leading-relaxed">{b.text}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
