'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'

const COLOR_SWATCHES = ['#D4AF37', '#EC4899', '#60A5FA', '#4ADE80', '#F97316', '#A855F7', '#F43F5E', '#22D3EE', '#6B6660']

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {COLOR_SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          title={c}
          onClick={() => onChange(c)}
          className={`w-7 h-7 rounded-full shrink-0 transition-all ${value === c ? 'ring-2 ring-offset-2 ring-offset-surface ring-parchment scale-110' : 'hover:scale-110'}`}
          style={{ background: c }}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title="Custom color"
        className="w-8 h-7 rounded cursor-pointer border border-wire bg-transparent p-0"
      />
    </div>
  )
}

interface EntityRow {
  id: string
  entity_key: string
  color_hex: string
}

const ENTITY_LABELS: Record<string, string> = {
  private: 'Private Jobs',
}

export default function EntityColorsPage() {
  const supabase = createClient()
  const [rows, setRows] = useState<EntityRow[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  async function load() {
    const { data } = await supabase.from('entity_colors').select('*').order('entity_key')
    const loaded = (data ?? []) as EntityRow[]
    setRows(loaded)
    const initial: Record<string, string> = {}
    for (const r of loaded) initial[r.entity_key] = r.color_hex
    setDraft(initial)
  }

  useEffect(() => { load() }, [])

  async function handleSave(entityKey: string) {
    const row = rows.find((r) => r.entity_key === entityKey)
    if (!row) return
    setSaving(entityKey)
    await supabase.from('entity_colors').update({ color_hex: draft[entityKey] }).eq('id', row.id)
    setSaving(null)
    setSaved(entityKey)
    setTimeout(() => setSaved(null), 2000)
    load()
  }

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-parchment">Entity Colors</h1>
        <p className="text-sm text-dim mt-1">Configure the card border color per entity type on the Dashboard.</p>
      </div>

      <div className="space-y-4">
        {rows.length === 0 && (
          <div className="bg-surface rounded-xl border border-wire p-12 text-center text-dim">Loading…</div>
        )}

        {rows.map((row) => {
          const label = ENTITY_LABELS[row.entity_key] ?? row.entity_key
          const color = draft[row.entity_key] ?? row.color_hex
          return (
            <div key={row.entity_key} className="bg-surface rounded-xl border border-wire p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="w-5 h-5 rounded-full border border-wire shrink-0" style={{ background: color }} />
                  <div>
                    <p className="font-semibold text-parchment">{label}</p>
                    <p className="text-xs font-mono text-dim">{color}</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => handleSave(row.entity_key)}
                  disabled={saving === row.entity_key || color === row.color_hex}
                >
                  {saving === row.entity_key ? 'Saving…' : saved === row.entity_key ? 'Saved ✓' : 'Save'}
                </Button>
              </div>
              <ColorPicker
                value={color}
                onChange={(c) => setDraft((d) => ({ ...d, [row.entity_key]: c }))}
              />
              <div className="mt-4 pt-3 border-t border-wire">
                <div
                  className="flex items-center gap-2 px-3 py-1.5 bg-panel rounded-lg border-l-[3px]"
                  style={{ borderLeftColor: color }}
                >
                  <span className="text-xs text-dim">Preview job card border</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
