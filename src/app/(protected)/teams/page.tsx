'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Printer, Truck as TruckIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { JobSource, JobStatus } from '@/types/database'
import Button from '@/components/ui/Button'

// ─── Date utilities (same convention as the Dashboard) ────────────────────────
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
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function fmtDayHeader(d: Date): string {
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' })
}
function fmtWeekRange(start: Date): string {
  const end = addDays(start, 6)
  const s = start.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  const e = end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${s} – ${e}`
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface TeamsJob {
  id: string
  job_number: string
  date: string
  status: JobStatus
  source: JobSource
  scheduled_time: string | null
  pickup_address: string | null
  delivery_address: string | null
  subcontractor: { name: string } | null
  customer: { name: string } | null
  contract: { name: string } | null
  contract_client: { name: string } | null
  job_crew: Array<{ employee: { name: string } | null }>
  job_casual_crew: Array<{ name: string }>
  job_extra_men: Array<{ name: string | null }>
  trucks: Array<{ fleet_id: string; name: string; registration: string | null }>
}

interface TruckGroup {
  fleetId: string | null
  label: string
  registration: string | null
  crewNames: string[]
  jobs: TeamsJob[]
}

// Same "who is this job for" logic used in the Jobs list, plus a TMAAT-style
// prefix so the roster reads like the office's own Excel sheet.
function entityLabel(job: TeamsJob): string {
  if (job.source === 'private') return job.customer?.name ?? '—'
  if (job.source === 'contract') {
    const base = job.contract?.name ?? '—'
    return job.contract_client?.name ? `${base} → ${job.contract_client.name}` : base
  }
  return job.subcontractor?.name ?? '—'
}

function jobPrefix(job: TeamsJob): string {
  if (job.source === 'private') return 'PRIVATE JOB'
  if (job.subcontractor?.name?.toUpperCase().includes('TMAAT')) return 'TMAAT'
  return 'JOB'
}

function routeText(job: TeamsJob): string | null {
  const parts = [job.pickup_address, job.delivery_address].filter((p) => p && p.trim())
  return parts.length > 0 ? parts.join(' → ') : null
}

export default function TeamsPage() {
  const supabase = createClient()
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [jobs, setJobs] = useState<TeamsJob[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    void load()
    async function load() {
      const start = toISO(weekStart)
      const end = toISO(addDays(weekStart, 6))
      const { data, error } = await supabase
        .from('jobs')
        .select(`
          id, job_number, date, status, source, scheduled_time, pickup_address, delivery_address,
          subcontractor:subcontractors(name),
          customer:customers(name),
          contract:contracts(name),
          contract_client:contract_clients(name),
          job_crew(employee:employees(name)),
          job_casual_crew(name),
          job_extra_men(name)
        `)
        .gte('date', start)
        .lte('date', end)
        .neq('status', 'cancelled')
        .order('date')
        .order('scheduled_time')

      if (error) console.error('teams jobs query error:', error.message)
      const baseJobs = (data ?? []) as unknown as Omit<TeamsJob, 'trucks'>[]

      const truckMap = new Map<string, TeamsJob['trucks']>()
      if (baseJobs.length > 0) {
        try {
          const { data: trucks } = await supabase
            .from('job_trucks')
            .select('job_id, fleet_id, fleet:fleet(name, registration)')
            .in('job_id', baseJobs.map((j) => j.id))
          for (const row of (trucks ?? []) as unknown as Array<{ job_id: string; fleet_id: string; fleet: { name: string; registration: string | null } | null }>) {
            const list = truckMap.get(row.job_id) ?? []
            if (row.fleet) list.push({ fleet_id: row.fleet_id, name: row.fleet.name, registration: row.fleet.registration })
            truckMap.set(row.job_id, list)
          }
        } catch { /* fleet / job_trucks not yet migrated */ }
      }

      setJobs(baseJobs.map((j) => ({ ...j, trucks: truckMap.get(j.id) ?? [] })))
      setLoading(false)
    }
  }, [weekStart]) // eslint-disable-line react-hooks/exhaustive-deps

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  const dayGroups = useMemo(() => {
    return days.map((day) => {
      const dayISO = toISO(day)
      const dayJobs = jobs.filter((j) => j.date === dayISO)
      const groups = new Map<string, TruckGroup>()

      for (const job of dayJobs) {
        const crewNames = [
          ...job.job_crew.map((c) => c.employee?.name).filter((n): n is string => !!n),
          ...job.job_casual_crew.map((c) => c.name).filter(Boolean),
          ...job.job_extra_men.map((c) => c.name).filter((n): n is string => !!n),
        ]
        const targets = job.trucks.length > 0 ? job.trucks : [null]
        for (const truck of targets) {
          const key = truck?.fleet_id ?? '__unassigned__'
          const existing = groups.get(key)
          if (existing) {
            existing.jobs.push(job)
            for (const name of crewNames) if (!existing.crewNames.includes(name)) existing.crewNames.push(name)
          } else {
            groups.set(key, {
              fleetId: truck?.fleet_id ?? null,
              label: truck?.name ?? 'No truck assigned',
              registration: truck?.registration ?? null,
              crewNames: [...new Set(crewNames)],
              jobs: [job],
            })
          }
        }
      }

      const list = [...groups.values()].sort((a, b) => {
        if (a.fleetId === null) return 1
        if (b.fleetId === null) return -1
        return a.label.localeCompare(b.label)
      })
      return { day, dayISO, groups: list }
    })
  }, [days, jobs])

  const daysWithJobs = dayGroups.filter((d) => d.groups.length > 0)

  return (
    <div>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #teams-print-area, #teams-print-area * { visibility: visible; }
          #teams-print-area { position: absolute; top: 0; left: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-parchment">Teams</h1>
          <p className="text-sm text-dim mt-0.5">Builds the weekly trucks/drivers/jobs roster, straight from the jobs already on file.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekStart((w) => addDays(w, -7))} className="p-2 text-dim hover:text-parchment rounded-lg hover:bg-panel transition-colors">
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-medium text-parchment min-w-[160px] text-center">{fmtWeekRange(weekStart)}</span>
          <button onClick={() => setWeekStart((w) => addDays(w, 7))} className="p-2 text-dim hover:text-parchment rounded-lg hover:bg-panel transition-colors">
            <ChevronRight size={18} />
          </button>
          <Button variant="secondary" size="sm" onClick={() => setWeekStart(getMonday(new Date()))}>Today</Button>
          <Button onClick={() => window.print()} size="sm">
            <Printer size={14} /> Download / Print
          </Button>
        </div>
      </div>

      <div id="teams-print-area">
        <h2 className="hidden print:block text-lg font-bold mb-4">Malibu Moving Specialists — Teams {fmtWeekRange(weekStart)}</h2>

        {loading ? (
          <p className="text-warm text-sm">Loading…</p>
        ) : daysWithJobs.length === 0 ? (
          <div className="bg-surface rounded-xl border border-wire p-12 text-center text-dim">No jobs scheduled this week.</div>
        ) : (
          <div className="space-y-6">
            {daysWithJobs.map(({ day, dayISO, groups }) => (
              <div key={dayISO} className="bg-surface rounded-xl border border-wire overflow-hidden">
                <div className="bg-panel px-4 py-2 border-b border-wire">
                  <h3 className="font-display font-bold text-parchment text-sm uppercase tracking-wide">{fmtDayHeader(day)}</h3>
                </div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {groups.map((g) => (
                    <div key={g.fleetId ?? 'unassigned'} className="border border-wire rounded-lg overflow-hidden flex flex-col">
                      <div className={`px-3 py-1.5 flex items-center gap-1.5 ${g.fleetId ? 'bg-gold/15' : 'bg-danger/10'}`}>
                        <TruckIcon size={13} className={g.fleetId ? 'text-gold' : 'text-danger'} />
                        <span className={`text-xs font-bold uppercase tracking-wide ${g.fleetId ? 'text-gold' : 'text-danger'}`}>
                          {g.label}{g.registration ? ` · ${g.registration}` : ''}
                        </span>
                      </div>
                      <div className="p-3 flex-1 flex flex-col gap-2">
                        <p className="text-sm font-medium text-parchment">
                          {g.crewNames.length > 0 ? g.crewNames.join(' / ') : <span className="text-dim italic">No crew assigned</span>}
                        </p>
                        <div className="space-y-1.5">
                          {g.jobs.map((job) => (
                            <div key={job.id} className="text-xs text-warm border-t border-wire pt-1.5 first:border-t-0 first:pt-0">
                              <p className="font-semibold text-parchment">{jobPrefix(job)} {job.job_number}{job.scheduled_time ? ` · ${job.scheduled_time.slice(0, 5)}` : ''}</p>
                              {routeText(job) && <p className="text-dim">{routeText(job)}</p>}
                              <p>{entityLabel(job)}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
