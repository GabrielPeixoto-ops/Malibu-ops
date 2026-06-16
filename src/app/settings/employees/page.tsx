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
  name: string
  hourly_rate: string
  active: boolean
  age: string
  visa_type: string
  english_level: string
  phone_type: string
  employment_status: string
  email: string
  phone: string
  drivers_license: string
  drivers_license_expiry: string
  passport: string
  emergency_contact_name: string
  emergency_contact_phone: string
  emergency_contact_relation: string
}

function emptyForm(): EmpForm {
  return {
    name: '', hourly_rate: '', active: true,
    age: '', visa_type: '', english_level: 'intermediate', phone_type: 'android',
    employment_status: 'full_time', email: '', phone: '',
    drivers_license: '', drivers_license_expiry: '', passport: '',
    emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relation: '',
  }
}

function formFromEmp(e: Employee): EmpForm {
  return {
    name: e.name,
    hourly_rate: String(e.hourly_rate),
    active: e.active,
    age: e.age != null ? String(e.age) : '',
    visa_type: e.visa_type ?? '',
    english_level: e.english_level ?? 'intermediate',
    phone_type: e.phone_type ?? 'android',
    employment_status: e.employment_status ?? 'full_time',
    email: e.email ?? '',
    phone: e.phone ?? '',
    drivers_license: e.drivers_license ?? '',
    drivers_license_expiry: e.drivers_license_expiry ?? '',
    passport: e.passport ?? '',
    emergency_contact_name: e.emergency_contact_name ?? '',
    emergency_contact_phone: e.emergency_contact_phone ?? '',
    emergency_contact_relation: e.emergency_contact_relation ?? '',
  }
}

function statusLabel(s: string | null) {
  return EMPLOYMENT_OPTIONS.find((o) => o.value === s)?.label ?? s ?? '—'
}

export default function EmployeesPage() {
  const supabase = createClient()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [form, setForm] = useState<EmpForm>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const uploadingFor = useRef<string | null>(null)

  async function fetch() {
    const { data } = await supabase.from('employees').select('*').order('name')
    setEmployees((data ?? []) as unknown as Employee[])
    setLoading(false)
  }

  useEffect(() => { fetch() }, [])

  function toggle(id: string) {
    setExpanded((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function setF<K extends keyof EmpForm>(k: K, v: EmpForm[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setError('')
    setModalOpen(true)
  }

  function openEdit(emp: Employee) {
    setEditing(emp)
    setForm(formFromEmp(emp))
    setError('')
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required'); return }
    const rate = parseFloat(form.hourly_rate)
    if (isNaN(rate) || rate < 0) { setError('Valid hourly rate is required'); return }
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      hourly_rate: rate,
      active: form.active,
      age: parseInt(form.age) || null,
      visa_type: form.visa_type.trim() || null,
      english_level: form.english_level || null,
      phone_type: form.phone_type || null,
      employment_status: form.employment_status || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      drivers_license: form.drivers_license.trim() || null,
      drivers_license_expiry: form.drivers_license_expiry || null,
      passport: form.passport.trim() || null,
      emergency_contact_name: form.emergency_contact_name.trim() || null,
      emergency_contact_phone: form.emergency_contact_phone.trim() || null,
      emergency_contact_relation: form.emergency_contact_relation.trim() || null,
    }
    if (editing) {
      await supabase.from('employees').update(payload).eq('id', editing.id)
    } else {
      await supabase.from('employees').insert(payload)
    }
    setSaving(false)
    setModalOpen(false)
    fetch()
  }

  async function handleDelete(emp: Employee) {
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

  function triggerUpload(empId: string) {
    uploadingFor.current = empId
    fileRef.current?.click()
  }

  return (
    <div>
      <input ref={fileRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={handleUpload} />

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
        <Button onClick={openCreate} size="sm">
          <Plus size={16} /> Add Employee
        </Button>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : employees.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          No employees yet.
        </div>
      ) : (
        <div className="space-y-2">
          {employees.map((emp) => {
            const open = expanded.has(emp.id)
            return (
              <div key={emp.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Row header */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 select-none"
                  onClick={() => toggle(emp.id)}
                >
                  <button className="text-gray-400 shrink-0" tabIndex={-1}>
                    {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  <span className="font-medium text-gray-900 flex-1">{emp.name}</span>
                  <span className="text-sm text-gray-500 hidden sm:block">${emp.hourly_rate}/hr</span>
                  {emp.employment_status && (
                    <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                      {statusLabel(emp.employment_status)}
                    </span>
                  )}
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${emp.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {emp.active ? 'Active' : 'Inactive'}
                  </span>
                  <div className="flex gap-2 ml-2" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => openEdit(emp)} className="text-gray-400 hover:text-blue-600 p-1">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button onClick={() => handleDelete(emp)} className="text-gray-400 hover:text-red-600 p-1">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* Expanded details */}
                {open && (
                  <div className="border-t border-gray-100 px-4 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-3 text-sm">
                    {/* Contact */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Contact</p>
                      <Field label="Phone" value={emp.phone} />
                      <Field label="Email" value={emp.email} />
                      <Field label="Phone type" value={PHONE_OPTIONS.find((o) => o.value === emp.phone_type)?.label ?? emp.phone_type} />
                    </div>

                    {/* Personal */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Personal</p>
                      <Field label="Age" value={emp.age != null ? String(emp.age) : null} />
                      <Field label="Visa type" value={emp.visa_type} />
                      <Field label="English level" value={ENGLISH_OPTIONS.find((o) => o.value === emp.english_level)?.label ?? emp.english_level} />
                    </div>

                    {/* Documents */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Documents</p>
                      <Field label="Driver's license" value={emp.drivers_license} />
                      <Field label="License expiry" value={emp.drivers_license_expiry} />
                      <Field label="Passport" value={emp.passport} />
                      <div className="pt-1">
                        {emp.document_url ? (
                          <div className="flex items-center gap-2">
                            <a href={emp.document_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 text-xs underline">View document</a>
                            <button onClick={() => triggerUpload(emp.id)} className="text-xs text-gray-400 hover:text-gray-600 underline">
                              {uploading === emp.id ? 'Uploading…' : 'Replace'}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => triggerUpload(emp.id)}
                            disabled={uploading === emp.id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                          >
                            <Upload size={12} />
                            {uploading === emp.id ? 'Uploading…' : 'Upload Document'}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Emergency */}
                    <div className="space-y-2 sm:col-span-2 lg:col-span-3 border-t border-gray-50 pt-3 mt-1">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Emergency Contact</p>
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Employee' : 'New Employee'}>
        <div className="space-y-5">
          {/* Basic */}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Name" value={form.name} onChange={(e) => setF('name', e.target.value)} placeholder="e.g. Juan" />
            <Input label="Hourly Rate ($)" type="number" min="0" step="0.01" value={form.hourly_rate} onChange={(e) => setF('hourly_rate', e.target.value)} placeholder="0.00" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Employment Status" options={EMPLOYMENT_OPTIONS} value={form.employment_status} onChange={(e) => setF('employment_status', e.target.value)} />
            <Input label="Age" type="number" min="18" max="80" value={form.age} onChange={(e) => setF('age', e.target.value)} placeholder="30" />
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
            <input type="checkbox" checked={form.active} onChange={(e) => setF('active', e.target.checked)} className="rounded" />
            Active
          </label>

          {/* Contact */}
          <div className="border-t border-gray-200 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Contact</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Phone" value={form.phone} onChange={(e) => setF('phone', e.target.value)} placeholder="0412 345 678" />
              <Select label="Phone Type" options={PHONE_OPTIONS} value={form.phone_type} onChange={(e) => setF('phone_type', e.target.value)} />
            </div>
            <div className="mt-3">
              <Input label="Email" type="email" value={form.email} onChange={(e) => setF('email', e.target.value)} placeholder="juan@example.com" />
            </div>
          </div>

          {/* Personal */}
          <div className="border-t border-gray-200 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Personal</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Visa Type" value={form.visa_type} onChange={(e) => setF('visa_type', e.target.value)} placeholder="Tourist / PR / Citizen" />
              <Select label="English Level" options={ENGLISH_OPTIONS} value={form.english_level} onChange={(e) => setF('english_level', e.target.value)} />
            </div>
          </div>

          {/* Documents */}
          <div className="border-t border-gray-200 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Documents</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Driver's License #" value={form.drivers_license} onChange={(e) => setF('drivers_license', e.target.value)} placeholder="12345678" />
              <Input label="License Expiry" type="date" value={form.drivers_license_expiry} onChange={(e) => setF('drivers_license_expiry', e.target.value)} />
            </div>
            <div className="mt-3">
              <Input label="Passport #" value={form.passport} onChange={(e) => setF('passport', e.target.value)} placeholder="PA1234567" />
            </div>
          </div>

          {/* Emergency */}
          <div className="border-t border-gray-200 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Emergency Contact</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Name" value={form.emergency_contact_name} onChange={(e) => setF('emergency_contact_name', e.target.value)} placeholder="Maria" />
              <Input label="Relation" value={form.emergency_contact_relation} onChange={(e) => setF('emergency_contact_relation', e.target.value)} placeholder="Wife" />
            </div>
            <div className="mt-3">
              <Input label="Phone" value={form.emergency_contact_phone} onChange={(e) => setF('emergency_contact_phone', e.target.value)} placeholder="0412 345 679" />
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving} className="flex-1">{saving ? 'Saving...' : 'Save'}</Button>
            <Button variant="secondary" onClick={() => setModalOpen(false)} className="flex-1">Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div>
      <span className="text-gray-400 text-xs">{label}</span>
      <p className="text-gray-800 font-medium">{value}</p>
    </div>
  )
}
