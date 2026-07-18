'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useRef, useState } from 'react'
import { Plus, Pencil, Trash2, Link as LinkIcon, FileText, Upload } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Modal from '@/components/ui/Modal'

interface Resource {
  id: string
  category: string
  title: string
  description: string | null
  link_url: string | null
  file_url: string | null
  file_name: string | null
  color: string | null
  sort_order: number
  created_at: string
}

const CATEGORIES: { key: string; label: string }[] = [
  { key: 'templates_procedures', label: 'Templates & Procedures' },
  { key: 'job_forms_qr', label: 'Job Forms / QR Codes' },
  { key: 'rates', label: 'Main / Sub-con Rates' },
  { key: 'management_details', label: 'Management Details & Truck Rego' },
  { key: 'time_off_schedule', label: 'Days Off / Time Limitation' },
  { key: 'schedule_last_day', label: 'Schedule / Last Day of Work' },
  { key: 'management_tasks', label: 'Management Tasks' },
]

const COLOR_OPTIONS = [
  { value: '', label: 'No color' },
  { value: '#ef4444', label: 'Red' },
  { value: '#f97316', label: 'Orange' },
  { value: '#eab308', label: 'Yellow' },
  { value: '#22c55e', label: 'Green' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#a855f7', label: 'Purple' },
  { value: '#ec4899', label: 'Pink' },
]

function emptyForm() {
  return {
    title: '',
    description: '',
    link_url: '',
    color: '',
  }
}

export default function ResourcesPage() {
  const supabase = createClient()
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0].key)
  const [resources, setResources] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Resource | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('resources').select('*').order('sort_order').order('created_at')
    setResources((data ?? []) as Resource[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function setField<K extends keyof ReturnType<typeof emptyForm>>(k: K, v: ReturnType<typeof emptyForm>[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setPendingFile(null)
    setError('')
    setModalOpen(true)
  }

  function openEdit(r: Resource) {
    setEditing(r)
    setForm({
      title: r.title,
      description: r.description ?? '',
      link_url: r.link_url ?? '',
      color: r.color ?? '',
    })
    setPendingFile(null)
    setError('')
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.title.trim()) { setError('Title is required'); return }
    setSaving(true)
    setError('')
    try {
      let file_url = editing?.file_url ?? null
      let file_name = editing?.file_name ?? null
      if (pendingFile) {
        const ts = Date.now()
        const safeName = pendingFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `resources/${activeCategory}/${ts}-${safeName}`
        const { error: upErr } = await supabase.storage.from('job-photos').upload(path, pendingFile)
        if (upErr) throw upErr
        const { data: urlData } = supabase.storage.from('job-photos').getPublicUrl(path)
        file_url = urlData.publicUrl
        file_name = pendingFile.name
      }
      const payload = {
        category: activeCategory,
        title: form.title.trim(),
        description: form.description.trim() || null,
        link_url: form.link_url.trim() || null,
        color: form.color || null,
        file_url,
        file_name,
      }
      if (editing) {
        await supabase.from('resources').update(payload).eq('id', editing.id)
      } else {
        const sort_order = resources.filter((r) => r.category === activeCategory).length
        await supabase.from('resources').insert({ ...payload, sort_order })
      }
      setModalOpen(false)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(r: Resource) {
    if (!confirm(`Delete "${r.title}"?`)) return
    await supabase.from('resources').delete().eq('id', r.id)
    load()
  }

  const list = resources.filter((r) => r.category === activeCategory)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-display font-bold text-parchment">Resources</h1>
        <Button onClick={openCreate}><Plus className="w-4 h-4" /> Add</Button>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => setActiveCategory(c.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
              activeCategory === c.key
                ? 'bg-gold/15 text-gold border-gold-ring'
                : 'bg-surface text-dim border-wire hover:text-warm'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-warm text-sm">Loading…</p>
      ) : list.length === 0 ? (
        <div className="bg-surface rounded-xl border border-wire p-12 text-center text-dim">
          Nothing here yet. Click Add to create the first item.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((r) => (
            <div
              key={r.id}
              className="bg-surface rounded-xl border border-wire p-4 flex flex-col gap-2"
              style={r.color ? { borderLeftWidth: 4, borderLeftColor: r.color } : undefined}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium text-parchment">{r.title}</h3>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => openEdit(r)} className="p-1 text-dim hover:text-gold rounded transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(r)} className="p-1 text-dim hover:text-danger rounded transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {r.description && <p className="text-sm text-warm whitespace-pre-wrap break-words">{r.description}</p>}
              <div className="flex flex-wrap gap-3 mt-1">
                {r.link_url && (
                  <a href={r.link_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-gold hover:text-gold-bright underline underline-offset-2">
                    <LinkIcon className="w-3 h-3" /> Open link
                  </a>
                )}
                {r.file_url && (
                  <a href={r.file_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-gold hover:text-gold-bright underline underline-offset-2">
                    <FileText className="w-3 h-3" /> {r.file_name ?? 'View file'}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Item' : 'Add Item'}>
        <div className="space-y-4">
          <Input
            label="Title"
            value={form.title}
            onChange={(e) => setField('title', e.target.value)}
            placeholder="e.g. Fragile Item Waiver"
          />
          <div>
            <label className="text-xs font-medium text-parchment uppercase tracking-wide">Description</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              placeholder="Optional notes…"
              className="w-full mt-1 px-3 py-2 text-sm rounded-lg bg-panel text-parchment border border-wire focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring resize-y"
            />
          </div>
          <Input
            label="Link (optional)"
            value={form.link_url}
            onChange={(e) => setField('link_url', e.target.value)}
            placeholder="https://…"
          />
          <div>
            <label className="text-xs font-medium text-parchment uppercase tracking-wide">File (optional)</label>
            <div className="mt-1 flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="w-3.5 h-3.5" /> {pendingFile ? pendingFile.name : (editing?.file_name ?? 'Choose file')}
              </Button>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          {activeCategory === 'rates' && (
            <div>
              <label className="text-xs font-medium text-parchment uppercase tracking-wide">Color (for color-coding)</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {COLOR_OPTIONS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setField('color', c.value)}
                    className={`w-7 h-7 rounded-full border-2 ${form.color === c.value ? 'border-gold' : 'border-wire'}`}
                    style={{ backgroundColor: c.value || 'transparent' }}
                    title={c.label}
                  />
                ))}
              </div>
            </div>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
