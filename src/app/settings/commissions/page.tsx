'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import { Plus, Trash2, GripVertical } from 'lucide-react'
import type { CommissionType } from '@/types/database'

const INPUT = 'w-full px-2 py-1.5 text-sm border border-wire rounded-lg focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring bg-transparent'

interface Draft {
  id: string | null
  name: string
  rate_per_hour: string
  is_active: boolean
  sort_order: number
  saving: boolean
}

function newDraft(sort_order: number): Draft {
  return { id: null, name: '', rate_per_hour: '', is_active: true, sort_order, saving: false }
}

export default function CommissionsSettingsPage() {
  const supabase = createClient()
  const [types, setTypes] = useState<CommissionType[]>([])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  async function load() {
    const { data } = await supabase
      .from('commission_types')
      .select('*')
      .order('sort_order')
    setTypes((data ?? []) as CommissionType[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function addDraft() {
    const maxSort = Math.max(0, ...types.map((t) => t.sort_order), ...drafts.map((d) => d.sort_order))
    setDrafts((d) => [...d, newDraft(maxSort + 1)])
  }

  function updateDraft(idx: number, field: keyof Draft, value: string | boolean | number) {
    setDrafts((d) => d.map((row, i) => i === idx ? { ...row, [field]: value } : row))
  }

  async function saveDraft(idx: number) {
    const d = drafts[idx]
    if (!d.name.trim() || !d.rate_per_hour) return
    setDrafts((arr) => arr.map((row, i) => i === idx ? { ...row, saving: true } : row))
    await supabase.from('commission_types').insert({
      name: d.name.trim(),
      rate_per_hour: parseFloat(d.rate_per_hour),
      is_active: d.is_active,
      sort_order: d.sort_order,
    })
    setDrafts((arr) => arr.filter((_, i) => i !== idx))
    load()
  }

  async function updateType(type: CommissionType, changes: Partial<CommissionType>) {
    await supabase.from('commission_types').update(changes).eq('id', type.id)
    setTypes((arr) => arr.map((t) => t.id === type.id ? { ...t, ...changes } : t))
  }

  async function deleteType(id: string) {
    setDeleteId(id)
    await supabase.from('commission_types').delete().eq('id', id)
    setDeleteId(null)
    load()
  }

  return (
    <div className="max-w-lg">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-parchment">Commissions</h1>
          <p className="text-sm text-dim mt-1">Configure commission types with default hourly rates.</p>
        </div>
        <Button size="sm" onClick={addDraft} className="shrink-0 flex items-center gap-1">
          <Plus size={14} /> Add Type
        </Button>
      </div>

      {loading ? (
        <div className="bg-surface rounded-xl border border-wire p-12 text-center text-dim">Loading…</div>
      ) : (
        <div className="space-y-2">
          {types.map((t) => (
            <div key={t.id} className="bg-surface rounded-xl border border-wire p-4 flex items-center gap-3">
              <GripVertical size={16} className="text-dim shrink-0" />
              <input
                defaultValue={t.name}
                onBlur={(e) => { if (e.target.value !== t.name) updateType(t, { name: e.target.value }) }}
                className={INPUT + ' flex-1'}
                placeholder="Name"
              />
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-xs text-dim">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.50"
                  defaultValue={t.rate_per_hour}
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value)
                    if (!isNaN(v) && v !== t.rate_per_hour) updateType(t, { rate_per_hour: v })
                  }}
                  className={INPUT + ' w-24'}
                  placeholder="Rate"
                />
                <span className="text-xs text-dim">/hr</span>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-dim shrink-0 cursor-pointer">
                <input
                  type="checkbox"
                  checked={t.is_active}
                  onChange={(e) => updateType(t, { is_active: e.target.checked })}
                  className="accent-gold"
                />
                Active
              </label>
              <button
                type="button"
                disabled={deleteId === t.id}
                onClick={() => deleteType(t.id)}
                className="text-dim hover:text-danger disabled:opacity-40 shrink-0"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}

          {/* New drafts */}
          {drafts.map((d, i) => (
            <div key={i} className="bg-panel rounded-xl border border-gold/30 p-4 flex items-center gap-3">
              <GripVertical size={16} className="text-dim shrink-0 opacity-30" />
              <input
                value={d.name}
                onChange={(e) => updateDraft(i, 'name', e.target.value)}
                className={INPUT + ' flex-1'}
                placeholder="Commission type name…"
                autoFocus
              />
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-xs text-dim">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.50"
                  value={d.rate_per_hour}
                  onChange={(e) => updateDraft(i, 'rate_per_hour', e.target.value)}
                  className={INPUT + ' w-24'}
                  placeholder="0.00"
                />
                <span className="text-xs text-dim">/hr</span>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-dim shrink-0 cursor-pointer">
                <input
                  type="checkbox"
                  checked={d.is_active}
                  onChange={(e) => updateDraft(i, 'is_active', e.target.checked)}
                  className="accent-gold"
                />
                Active
              </label>
              <Button size="sm" onClick={() => saveDraft(i)} disabled={d.saving || !d.name.trim() || !d.rate_per_hour}>
                {d.saving ? '…' : 'Save'}
              </Button>
              <button
                type="button"
                onClick={() => setDrafts((arr) => arr.filter((_, j) => j !== i))}
                className="text-dim hover:text-danger shrink-0"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}

          {types.length === 0 && drafts.length === 0 && (
            <div className="bg-surface rounded-xl border border-wire p-12 text-center text-dim text-sm">
              No commission types yet. Click &ldquo;Add Type&rdquo; to create one.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
