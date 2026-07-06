'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash2, Upload } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Employee } from '@/types/database'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Modal from '@/components/ui/Modal'

// ─── Staff tab types / helpers ────────────────────────────────────────────────

const EMPLOYMENT_OPTIONS = [
  { value: 'full_time', label: 'Full Time' },
  { value: 'casual', label: 'Casual' },
  { value: 'part_time', label: 'Part Time' },
]
const ENGLISH_OPTIONS = [
  { value: 'basic', label: 'Basic' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
]
const PHONE_OPTIONS = [
  { value: 'android', label: 'Android' },
  { value: 'iphone', label: 'iPhone' },
]

type EmpForm = {
  name: string; hourly_rate: string; active: boolean; age: string
  visa_type: string; english_level: string; phone_type: string
  employment_status: string; email: string; phone: string
  drivers_license: string; drivers_license_expiry: string; passport: string
  emergency_contact_name: string; emergency_contact_phone: string; emergency_contact_relation: string
}

function emptyEmpForm(): EmpForm {
  return {
    name: '', hourly_rate: '', active: true, age: '',
    visa_type: '', english_level: 'intermediate', phone_type: 'android',
    employment_status: 'full_time', email: '', phone: '',
    drivers_license: '', drivers_license_expiry: '', passport: '',
    emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relation: '',
  }
}
function formFromEmp(e: Employee): EmpForm {
  return {
    name: e.name, hourly_rate: String(e.hourly_rate), active: e.active,
    age: e.age != null ? String(e.age) : '',
    visa_type: e.visa_type ?? '', english_level: e.english_level ?? 'intermediate',
    phone_type: e.phone_type ?? 'android', employment_status: e.employment_status ?? 'full_time',
    email: e.email ?? '', phone: e.phone ?? '',
    drivers_license: e.drivers_license ?? '', drivers_license_expiry: e.drivers_license_expiry ?? '',
    passport: e.passport ?? '', emergency_contact_name: e.emergency_contact_name ?? '',
    emergency_contact_phone: e.emergency_contact_phone ?? '',
    emergency_contact_relation: e.emergency_contact_relation ?? '',
  }
}
function statusLabel(s: string | null) {
  return EMPLOYMENT_OPTIONS.find((o) => o.value === s)?.label ?? s ?? '—'
}

// ─── Casual workers types ─────────────────────────────────────────────────────

interface CasualWorker {
  id: string
  name: string
  rate_per_hour: number
  phone: string | null
  notes: string | null
  referrer_id: string | null
  referrer_commission_per_hour: number
  referrer: { id: string; name: string } | null
  created_at: string
}

interface CasualStats {
  totalJobs: number
  totalHours: number
  totalEarned: number
}

interface CasualHistoryEntry {
  job_id: string
  hours: number
  rate_per_hour: number
  job: { job_number: string; date: string } | null
}

type CasualForm = {
  name: string
  rate_per_hour: string
  phone: string
  notes: string
  referrer_id: string
  referrer_commission_per_hour: string
}

function emptyCasualForm(): CasualForm {
  return { name: '', rate_per_hour: '', phone: '', notes: '', referrer_id: '', referrer_commission_per_hour: '0' }
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

const checkboxCls = 'rounded border-wire bg-panel text-gold focus:ring-gold-ring'
const sectionLabel = 'text-xs font-semibold text-dim uppercase tracking-wide mb-3'

function fmtMoney(n: number) {
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 })
}
function fmtHours(n: number) {
  return n % 1 === 0 ? `${n}h` : `${n.toFixed(2)}h`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type PageTab = 'staff' | 'casual'

export default function EmployeesPage() {
  const supabase = createClient()
  const [tab, setTab] = useState<PageTab>('staff')

  // ── Staff state ─────────────────────────────────────────────────────────────
  const [employees, setEmployees] = useState<Employee[]>([])
  const [staffLoading, setStaffLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [empForm, setEmpForm] = useState<EmpForm>(emptyEmpForm())
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [empError, setEmpError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const uploadingFor = useRef<string | null>(null)

  // ── Casual state ────────────────────────────────────────────────────────────
  const [casualWorkers, setCasualWorkers] = useState<CasualWorker[]>([])
  const [casualStats, setCasualStats] = useState<Record<string, CasualStats>>({})
  const [casualLoading, setCasualLoading] = useState(false)
  const [casualLoaded, setCasualLoaded] = useState(false)
  const [expandedCasual, setExpandedCasual] = useState<Set<string>>(new Set())
  const [casualHistory, setCasualHistory] = useState<Record<string, CasualHistoryEntry[]>>({})
  const [loadingHistory, setLoadingHistory] = useState<Set<string>>(new Set())
  const [casualModalOpen, setCasualModalOpen] = useState(false)
  const [editingCasual, setEditingCasual] = useState<CasualWorker | null>(null)
  const [casualForm, setCasualForm] = useState<CasualForm>(emptyCasualForm())
  const [savingCasual, setSavingCasual] = useState(false)
  const [casualError, setCasualError] = useState('')

  // ── Load staff ──────────────────────────────────────────────────────────────
  async function loadStaff() {
    const { data } = await supabase.from('employees').select('*').order('name')
    setEmployees((data ?? []) as unknown as Employee[])
    setStaffLoading(false)
  }
  useEffect(() => { loadStaff() }, [])

  // ── Load casual workers (lazy — on tab switch) ───────────────────────────────
  async function loadCasual() {
    if (casualLoaded) return
    setCasualLoading(true)
    const [cwRes, statsRes] = await Promise.all([
      supabase.from('casual_workers')
        .select('id, name, rate_per_hour, phone, notes, referrer_id, referrer_commission_per_hour, created_at, referrer:employees(id, name)')
        .order('name'),
      supabase.from('job_casual_crew')
        .select('casual_worker_id, hours, rate_per_hour, job_id')
        .not('casual_worker_id', 'is', null),
    ])
    setCasualWorkers((cwRes.data ?? []) as unknown as CasualWorker[])

    const statsMap: Record<string, CasualStats> = {}
    for (const row of (statsRes.data ?? []) as Array<{ casual_worker_id: string; hours: number; rate_per_hour: number; job_id: string }>) {
      if (!row.casual_worker_id) continue
      if (!statsMap[row.casual_worker_id]) statsMap[row.casual_worker_id] = { totalJobs: 0, totalHours: 0, totalEarned: 0 }
      const s = statsMap[row.casual_worker_id]
      s.totalJobs++
      s.totalHours += row.hours ?? 0
      s.totalEarned += (row.hours ?? 0) * (row.rate_per_hour ?? 0)
    }
    setCasualStats(statsMap)
    setCasualLoaded(true)
    setCasualLoading(false)
  }

  useEffect(() => {
    if (tab === 'casual') loadCasual()
  }, [tab])

  async function loadCasualHistory(cwId: string) {
    if (casualHistory[cwId] !== undefined || loadingHistory.has(cwId)) return
    setLoadingHistory((s) => new Set([...s, cwId]))
    const { data } = await supabase
      .from('job_casual_crew')
      .select('job_id, hours, rate_per_hour, job:jobs(job_number, date)')
      .eq('casual_worker_id', cwId)
      .order('job_id')
    setCasualHistory((prev) => ({ ...prev, [cwId]: (data ?? []) as unknown as CasualHistoryEntry[] }))
    setLoadingHistory((s) => { const n = new Set(s); n.delete(cwId); return n })
  }

  function toggleCasual(id: string) {
    setExpandedCasual((s) => {
      const n = new Set(s)
      if (n.has(id)) { n.delete(id) } else { n.add(id); loadCasualHistory(id) }
      return n
    })
  }

  // ── Staff CRUD ───────────────────────────────────────────────────────────────
  function toggle(id: string) {
    setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function setEF<K extends keyof EmpForm>(k: K, v: EmpForm[K]) { setEmpForm((f) => ({ ...f, [k]: v })) }
  function openCreate() { setEditing(null); setEmpForm(emptyEmpForm()); setEmpError(''); setModalOpen(true) }
  function openEdit(emp: Employee) { setEditing(emp); setEmpForm(formFromEmp(emp)); setEmpError(''); setModalOpen(true) }

  async function handleSaveEmp() {
    if (!empForm.name.trim()) { setEmpError('Name is required'); return }
    const rate = parseFloat(empForm.hourly_rate)
    if (isNaN(rate) || rate < 0) { setEmpError('Valid hourly rate is required'); return }
    setSaving(true)
    const payload = {
      name: empForm.name.trim(), hourly_rate: rate, active: empForm.active,
      age: parseInt(empForm.age) || null, visa_type: empForm.visa_type.trim() || null,
      english_level: empForm.english_level || null, phone_type: empForm.phone_type || null,
      employment_status: empForm.employment_status || null,
      email: empForm.email.trim() || null, phone: empForm.phone.trim() || null,
      drivers_license: empForm.drivers_license.trim() || null,
      drivers_license_expiry: empForm.drivers_license_expiry || null,
      passport: empForm.passport.trim() || null,
      emergency_contact_name: empForm.emergency_contact_name.trim() || null,
      emergency_contact_phone: empForm.emergency_contact_phone.trim() || null,
      emergency_contact_relation: empForm.emergency_contact_relation.trim() || null,
    }
    if (editing) {
      await supabase.from('employees').update(payload).eq('id', editing.id)
    } else {
      await supabase.from('employees').insert(payload)
    }
    setSaving(false)
    setModalOpen(false)
    loadStaff()
  }

  async function handleDeleteEmp(emp: Employee) {
    if (!confirm(`Delete ${emp.name}?`)) return
    await supabase.from('employees').delete().eq('id', emp.id)
    setEmployees((prev) => prev.filter((e) => e.id !== emp.id))
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const empId = uploadingFor.current
    if (!file || !empId) return
    setUploading(empId)
    const ext = file.name.split('.').pop()
    const path = `${empId}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('employee-docs').upload(path, file, { upsert: true })
    if (!upErr) {
      const { data: urlData } = supabase.storage.from('employee-docs').getPublicUrl(path)
      await supabase.from('employees').update({ document_url: urlData.publicUrl }).eq('id', empId)
      setEmployees((prev) => prev.map((emp) => emp.id === empId ? { ...emp, document_url: urlData.publicUrl } : emp))
    }
    setUploading(null)
    uploadingFor.current = null
    if (fileRef.current) fileRef.current.value = ''
  }

  function triggerUpload(empId: string) { uploadingFor.current = empId; fileRef.current?.click() }

  // ── Casual CRUD ──────────────────────────────────────────────────────────────
  function setCF<K extends keyof CasualForm>(k: K, v: CasualForm[K]) { setCasualForm((f) => ({ ...f, [k]: v })) }

  function openCreateCasual() {
    setEditingCasual(null)
    setCasualForm(emptyCasualForm())
    setCasualError('')
    setCasualModalOpen(true)
  }

  function openEditCasual(cw: CasualWorker) {
    setEditingCasual(cw)
    setCasualForm({
      name: cw.name,
      rate_per_hour: String(cw.rate_per_hour),
      phone: cw.phone ?? '',
      notes: cw.notes ?? '',
      referrer_id: cw.referrer_id ?? '',
      referrer_commission_per_hour: String(cw.referrer_commission_per_hour),
    })
    setCasualError('')
    setCasualModalOpen(true)
  }

  async function handleSaveCasual() {
    if (!casualForm.name.trim()) { setCasualError('Name is required'); return }
    setSavingCasual(true)
    const payload = {
      name: casualForm.name.trim(),
      rate_per_hour: parseFloat(casualForm.rate_per_hour) || 0,
      phone: casualForm.phone.trim() || null,
      notes: casualForm.notes.trim() || null,
      referrer_id: casualForm.referrer_id || null,
      referrer_commission_per_hour: parseFloat(casualForm.referrer_commission_per_hour) || 0,
    }
    if (editingCasual) {
      await supabase.from('casual_workers').update(payload).eq('id', editingCasual.id)
    } else {
      await supabase.from('casual_workers').insert(payload)
    }
    setSavingCasual(false)
    setCasualModalOpen(false)
    setCasualLoaded(false)
    loadCasual()
  }

  async function handleDeleteCasual(cw: CasualWorker) {
    if (!confirm(`Delete ${cw.name}?`)) return
    await supabase.from('casual_workers').delete().eq('id', cw.id)
    setCasualWorkers((prev) => prev.filter((w) => w.id !== cw.id))
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div>
      <input ref={fileRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={handleUpload} />

      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-display font-bold text-parchment">Employees</h1>
        <Button onClick={tab === 'staff' ? openCreate : openCreateCasual} size="sm">
          <Plus size={16} /> {tab === 'staff' ? 'Add Employee' : 'Add Casual'}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 mb-5 border-b border-wire">
        {(['staff', 'casual'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-gold text-gold' : 'border-transparent text-dim hover:text-warm'
            }`}
          >
            {t === 'staff' ? 'Staff' : 'Casual Workers'}
          </button>
        ))}
      </div>

      {/* ── Staff tab ── */}
      {tab === 'staff' && (
        <>
          {staffLoading ? (
            <p className="text-warm">Loading...</p>
          ) : employees.length === 0 ? (
            <div className="bg-surface rounded-xl border border-wire p-12 text-center text-dim">No employees yet.</div>
          ) : (
            <div className="space-y-2">
              {employees.map((emp) => {
                const open = expanded.has(emp.id)
                return (
                  <div key={emp.id} className="bg-surface rounded-xl border border-wire overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-panel select-none" onClick={() => toggle(emp.id)}>
                      <button className="text-dim shrink-0" tabIndex={-1}>{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                      <span className="font-medium text-parchment flex-1">{emp.name}</span>
                      <span className="text-sm font-mono text-dim hidden sm:block">${emp.hourly_rate}/hr</span>
                      {emp.employment_status && (
                        <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-300">
                          {statusLabel(emp.employment_status)}
                        </span>
                      )}
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${emp.active ? 'bg-success/10 text-success' : 'bg-wire/50 text-dim'}`}>
                        {emp.active ? 'Active' : 'Inactive'}
                      </span>
                      <div className="flex gap-2 ml-2" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => openEdit(emp)} className="text-dim hover:text-gold p-1 transition-colors">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button onClick={() => handleDeleteEmp(emp)} className="text-dim hover:text-danger p-1 transition-colors">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    {open && (
                      <div className="border-t border-wire px-4 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-3 text-sm">
                        <div className="space-y-2">
                          <p className={sectionLabel}>Contact</p>
                          <Field label="Phone" value={emp.phone} />
                          <Field label="Email" value={emp.email} />
                          <Field label="Phone type" value={PHONE_OPTIONS.find((o) => o.value === emp.phone_type)?.label ?? emp.phone_type} />
                        </div>
                        <div className="space-y-2">
                          <p className={sectionLabel}>Personal</p>
                          <Field label="Age" value={emp.age != null ? String(emp.age) : null} />
                          <Field label="Visa type" value={emp.visa_type} />
                          <Field label="English level" value={ENGLISH_OPTIONS.find((o) => o.value === emp.english_level)?.label ?? emp.english_level} />
                        </div>
                        <div className="space-y-2">
                          <p className={sectionLabel}>Documents</p>
                          <Field label="Driver's license" value={emp.drivers_license} />
                          <Field label="License expiry" value={emp.drivers_license_expiry} />
                          <Field label="Passport" value={emp.passport} />
                          <div className="pt-1">
                            {emp.document_url ? (
                              <div className="flex items-center gap-2">
                                <a href={emp.document_url} target="_blank" rel="noopener noreferrer" className="text-gold text-xs underline">View document</a>
                                <button onClick={() => triggerUpload(emp.id)} className="text-xs text-dim hover:text-warm underline transition-colors">
                                  {uploading === emp.id ? 'Uploading…' : 'Replace'}
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => triggerUpload(emp.id)} disabled={uploading === emp.id}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-wire rounded-lg text-warm hover:bg-panel disabled:opacity-50 transition-colors">
                                <Upload size={12} />
                                {uploading === emp.id ? 'Uploading…' : 'Upload Document'}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="space-y-2 sm:col-span-2 lg:col-span-3 border-t border-wire pt-3 mt-1">
                          <p className={sectionLabel}>Emergency Contact</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-2">
                            <Field label="Name" value={emp.emergency_contact_name} />
                            <Field label="Phone" value={emp.emergency_contact_phone} />
                            <Field label="Relation" value={emp.emergency_contact_relation} />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Staff modal */}
          <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Employee' : 'New Employee'}>
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <Input label="Name" value={empForm.name} onChange={(e) => setEF('name', e.target.value)} placeholder="e.g. Juan" />
                <Input label="Hourly Rate ($)" type="number" min="0" step="0.01" value={empForm.hourly_rate} onChange={(e) => setEF('hourly_rate', e.target.value)} placeholder="0.00" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Select label="Employment Status" options={EMPLOYMENT_OPTIONS} value={empForm.employment_status} onChange={(e) => setEF('employment_status', e.target.value)} />
                <Input label="Age" type="number" min="18" max="80" value={empForm.age} onChange={(e) => setEF('age', e.target.value)} placeholder="30" />
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-warm cursor-pointer">
                <input type="checkbox" checked={empForm.active} onChange={(e) => setEF('active', e.target.checked)} className={checkboxCls} />
                Active
              </label>
              <div className="border-t border-wire pt-4">
                <p className={sectionLabel}>Contact</p>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Phone" value={empForm.phone} onChange={(e) => setEF('phone', e.target.value)} placeholder="0412 345 678" />
                  <Select label="Phone Type" options={PHONE_OPTIONS} value={empForm.phone_type} onChange={(e) => setEF('phone_type', e.target.value)} />
                </div>
                <div className="mt-3">
                  <Input label="Email" type="email" value={empForm.email} onChange={(e) => setEF('email', e.target.value)} placeholder="juan@example.com" />
                </div>
              </div>
              <div className="border-t border-wire pt-4">
                <p className={sectionLabel}>Personal</p>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Visa Type" value={empForm.visa_type} onChange={(e) => setEF('visa_type', e.target.value)} placeholder="Tourist / PR / Citizen" />
                  <Select label="English Level" options={ENGLISH_OPTIONS} value={empForm.english_level} onChange={(e) => setEF('english_level', e.target.value)} />
                </div>
              </div>
              <div className="border-t border-wire pt-4">
                <p className={sectionLabel}>Documents</p>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Driver's License #" value={empForm.drivers_license} onChange={(e) => setEF('drivers_license', e.target.value)} placeholder="12345678" />
                  <Input label="License Expiry" type="date" value={empForm.drivers_license_expiry} onChange={(e) => setEF('drivers_license_expiry', e.target.value)} />
                </div>
                <div className="mt-3">
                  <Input label="Passport #" value={empForm.passport} onChange={(e) => setEF('passport', e.target.value)} placeholder="PA1234567" />
                </div>
              </div>
              <div className="border-t border-wire pt-4">
                <p className={sectionLabel}>Emergency Contact</p>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Name" value={empForm.emergency_contact_name} onChange={(e) => setEF('emergency_contact_name', e.target.value)} placeholder="Maria" />
                  <Input label="Relation" value={empForm.emergency_contact_relation} onChange={(e) => setEF('emergency_contact_relation', e.target.value)} placeholder="Wife" />
                </div>
                <div className="mt-3">
                  <Input label="Phone" value={empForm.emergency_contact_phone} onChange={(e) => setEF('emergency_contact_phone', e.target.value)} placeholder="0412 345 679" />
                </div>
              </div>
              {empError && <p className="text-sm text-danger">{empError}</p>}
              <div className="flex gap-2 pt-2">
                <Button onClick={handleSaveEmp} disabled={saving} className="flex-1">{saving ? 'Saving...' : 'Save'}</Button>
                <Button variant="secondary" onClick={() => setModalOpen(false)} className="flex-1">Cancel</Button>
              </div>
            </div>
          </Modal>
        </>
      )}

      {/* ── Casual Workers tab ── */}
      {tab === 'casual' && (
        <>
          {casualLoading ? (
            <p className="text-warm text-sm py-12 text-center">Loading…</p>
          ) : casualWorkers.length === 0 ? (
            <div className="bg-surface rounded-xl border border-wire p-12 text-center text-dim">No casual workers registered yet.</div>
          ) : (
            <div className="space-y-2">
              {casualWorkers.map((cw) => {
                const stats = casualStats[cw.id]
                const open = expandedCasual.has(cw.id)
                const history = casualHistory[cw.id]
                return (
                  <div key={cw.id} className="bg-surface rounded-xl border border-wire overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-panel select-none" onClick={() => toggleCasual(cw.id)}>
                      <button className="text-dim shrink-0" tabIndex={-1}>{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-parchment">{cw.name}</span>
                        {cw.referrer && (
                          <span className="ml-2 text-xs text-dim">
                            ref: <span className="text-warm">{cw.referrer.name}</span>
                            {cw.referrer_commission_per_hour > 0 && <span className="ml-1 font-mono">${cw.referrer_commission_per_hour}/hr</span>}
                          </span>
                        )}
                      </div>
                      <span className="text-sm font-mono text-dim hidden sm:block">${cw.rate_per_hour}/hr</span>
                      {stats && (
                        <div className="hidden sm:flex items-center gap-4 text-xs text-dim font-mono">
                          <span>{stats.totalJobs} job{stats.totalJobs !== 1 ? 's' : ''}</span>
                          <span>{fmtHours(stats.totalHours)}</span>
                          <span className="text-gold">{fmtMoney(stats.totalEarned)}</span>
                        </div>
                      )}
                      <div className="flex gap-2 ml-2" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => openEditCasual(cw)} className="text-dim hover:text-gold p-1 transition-colors">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button onClick={() => handleDeleteCasual(cw)} className="text-dim hover:text-danger p-1 transition-colors">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>

                    {open && (
                      <div className="border-t border-wire px-4 py-4 text-sm">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                          <div>
                            <p className="text-xs text-dim mb-0.5">Rate</p>
                            <p className="font-mono font-semibold text-parchment">${cw.rate_per_hour}/hr</p>
                          </div>
                          {cw.phone && <div><p className="text-xs text-dim mb-0.5">Phone</p><p className="text-warm">{cw.phone}</p></div>}
                          {stats && (
                            <>
                              <div><p className="text-xs text-dim mb-0.5">Total hours</p><p className="font-mono text-parchment">{fmtHours(stats.totalHours)}</p></div>
                              <div><p className="text-xs text-dim mb-0.5">Total earned</p><p className="font-mono text-gold">{fmtMoney(stats.totalEarned)}</p></div>
                            </>
                          )}
                        </div>
                        {cw.notes && <p className="text-xs text-dim mb-4 italic">{cw.notes}</p>}
                        {cw.referrer && (
                          <p className="text-xs text-dim mb-4">
                            Referred by <span className="text-warm font-medium">{cw.referrer.name}</span>
                            {cw.referrer_commission_per_hour > 0 && (
                              <span> · commission <span className="font-mono text-warm">${cw.referrer_commission_per_hour}/hr</span></span>
                            )}
                          </p>
                        )}

                        <p className={sectionLabel}>Job History</p>
                        {loadingHistory.has(cw.id) ? (
                          <p className="text-xs text-dim">Loading…</p>
                        ) : !history || history.length === 0 ? (
                          <p className="text-xs text-dim">No jobs yet.</p>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-wire">
                                <th className="text-left py-1 pr-4 text-dim font-semibold uppercase tracking-wider">Date</th>
                                <th className="text-left py-1 pr-4 text-dim font-semibold uppercase tracking-wider">Job</th>
                                <th className="text-right py-1 pr-4 text-dim font-semibold uppercase tracking-wider">Hours</th>
                                <th className="text-right py-1 text-dim font-semibold uppercase tracking-wider">Earned</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-wire">
                              {history.map((h, i) => (
                                <tr key={i}>
                                  <td className="py-1 pr-4 text-warm">{h.job?.date ?? '—'}</td>
                                  <td className="py-1 pr-4 font-mono text-parchment">#{h.job?.job_number ?? h.job_id.slice(0, 8)}</td>
                                  <td className="py-1 pr-4 text-right font-mono text-warm">{fmtHours(h.hours ?? 0)}</td>
                                  <td className="py-1 text-right font-mono text-gold">{fmtMoney((h.hours ?? 0) * (h.rate_per_hour ?? 0))}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Casual modal */}
          <Modal open={casualModalOpen} onClose={() => setCasualModalOpen(false)} title={editingCasual ? 'Edit Casual Worker' : 'New Casual Worker'}>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Input label="Name" value={casualForm.name} onChange={(e) => setCF('name', e.target.value)} placeholder="e.g. Luciana" />
                <Input label="Rate ($/hr)" type="number" min="0" step="0.50" value={casualForm.rate_per_hour} onChange={(e) => setCF('rate_per_hour', e.target.value)} placeholder="0.00" />
              </div>
              <Input label="Phone (optional)" value={casualForm.phone} onChange={(e) => setCF('phone', e.target.value)} placeholder="0412 345 678" />
              <Input label="Notes (optional)" value={casualForm.notes} onChange={(e) => setCF('notes', e.target.value)} placeholder="Any notes…" />
              <div className="border-t border-wire pt-4">
                <p className={sectionLabel}>Referral Commission</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-warm mb-1">Referred by</label>
                    <select
                      value={casualForm.referrer_id}
                      onChange={(e) => setCF('referrer_id', e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-wire rounded-lg bg-surface text-parchment focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
                    >
                      <option value="">No referrer</option>
                      {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  </div>
                  <Input
                    label="Commission ($/hr)"
                    type="number" min="0" step="0.50"
                    value={casualForm.referrer_commission_per_hour}
                    onChange={(e) => setCF('referrer_commission_per_hour', e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>
              {casualError && <p className="text-sm text-danger">{casualError}</p>}
              <div className="flex gap-2 pt-2">
                <Button onClick={handleSaveCasual} disabled={savingCasual} className="flex-1">{savingCasual ? 'Saving...' : 'Save'}</Button>
                <Button variant="secondary" onClick={() => setCasualModalOpen(false)} className="flex-1">Cancel</Button>
              </div>
            </div>
          </Modal>
        </>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div>
      <span className="text-dim text-xs">{label}</span>
      <p className="text-parchment font-medium">{value}</p>
    </div>
  )
}
