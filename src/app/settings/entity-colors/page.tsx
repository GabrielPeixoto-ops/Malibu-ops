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

interface ColorEntity {
  id: string
  name: string
  type: 'private' | 'subcontractor' | 'contract'
  savedColor: string
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-[10px] font-semibold tracking-widest text-dim uppercase">{label}</span>
      <div className="flex-1 h-px bg-wire" />
    </div>
  )
}

function EntityCard({
  entity,
  draft,
  saving,
  saved,
  onChange,
  onSave,
}: {
  entity: ColorEntity
  draft: string
  saving: boolean
  saved: boolean
  onChange: (c: string) => void
  onSave: () => void
}) {
  const isDirty = draft !== entity.savedColor

  return (
    <div className="bg-surface rounded-xl border border-wire p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="w-5 h-5 rounded-full border border-wire shrink-0" style={{ background: draft }} />
          <div>
            <p className="font-semibold text-parchment">{entity.name}</p>
            <p className="text-xs font-mono text-dim">{draft}</p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={onSave}
          disabled={saving || !isDirty}
        >
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </Button>
      </div>
      <ColorPicker value={draft} onChange={onChange} />
      <div className="mt-4 pt-3 border-t border-wire">
        <div
          className="flex items-center gap-2 px-3 py-1.5 bg-panel rounded-lg border-l-[3px]"
          style={{ borderLeftColor: draft }}
        >
          <span className="text-xs text-dim">Preview job card border</span>
        </div>
      </div>
    </div>
  )
}

export default function EntityColorsPage() {
  const supabase = createClient()
  const [entities, setEntities] = useState<ColorEntity[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    const [{ data: ec }, { data: subs }, { data: contracts }] = await Promise.all([
      supabase.from('entity_colors').select('id, entity_key, color_hex').order('entity_key'),
      supabase.from('subcontractors').select('id, name, color_hex').order('name'),
      supabase.from('contracts').select('id, name, color_hex').order('name'),
    ])

    const built: ColorEntity[] = [
      ...((ec ?? []) as { id: string; entity_key: string; color_hex: string }[]).map((r) => ({
        id: r.id,
        name: r.entity_key === 'private' ? 'Private Jobs' : r.entity_key,
        type: 'private' as const,
        savedColor: r.color_hex ?? '#D4AF37',
      })),
      ...((subs ?? []) as { id: string; name: string; color_hex: string | null }[]).map((r) => ({
        id: r.id,
        name: r.name,
        type: 'subcontractor' as const,
        savedColor: r.color_hex ?? '#6B6660',
      })),
      ...((contracts ?? []) as { id: string; name: string; color_hex: string | null }[]).map((r) => ({
        id: r.id,
        name: r.name,
        type: 'contract' as const,
        savedColor: r.color_hex ?? '#6B6660',
      })),
    ]

    setEntities(built)
    const d: Record<string, string> = {}
    for (const e of built) d[e.id] = e.savedColor
    setDrafts(d)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleSave(entity: ColorEntity) {
    const color = drafts[entity.id]
    setSaving(entity.id)

    if (entity.type === 'private') {
      await supabase.from('entity_colors').update({ color_hex: color }).eq('id', entity.id)
    } else if (entity.type === 'subcontractor') {
      await supabase.from('subcontractors').update({ color_hex: color }).eq('id', entity.id)
    } else {
      await supabase.from('contracts').update({ color_hex: color }).eq('id', entity.id)
    }

    setSaving(null)
    setSaved(entity.id)
    setTimeout(() => setSaved(null), 2000)
    load()
  }

  const privateEntities = entities.filter((e) => e.type === 'private')
  const subEntities = entities.filter((e) => e.type === 'subcontractor')
  const contractEntities = entities.filter((e) => e.type === 'contract')

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-parchment">Entity Colors</h1>
        <p className="text-sm text-dim mt-1">Configure the Dashboard job card border color per entity.</p>
      </div>

      {loading ? (
        <div className="bg-surface rounded-xl border border-wire p-12 text-center text-dim">Loading…</div>
      ) : (
        <div className="space-y-8">

          {/* PRIVATE */}
          <section>
            <SectionHeader label="Private" />
            <div className="space-y-4">
              {privateEntities.map((e) => (
                <EntityCard
                  key={e.id}
                  entity={e}
                  draft={drafts[e.id] ?? e.savedColor}
                  saving={saving === e.id}
                  saved={saved === e.id}
                  onChange={(c) => setDrafts((d) => ({ ...d, [e.id]: c }))}
                  onSave={() => handleSave(e)}
                />
              ))}
              {privateEntities.length === 0 && (
                <p className="text-sm text-dim px-1">No private entity found.</p>
              )}
            </div>
          </section>

          {/* SUBCONTRACTORS */}
          <section>
            <SectionHeader label="Subcontractors" />
            <div className="space-y-4">
              {subEntities.map((e) => (
                <EntityCard
                  key={e.id}
                  entity={e}
                  draft={drafts[e.id] ?? e.savedColor}
                  saving={saving === e.id}
                  saved={saved === e.id}
                  onChange={(c) => setDrafts((d) => ({ ...d, [e.id]: c }))}
                  onSave={() => handleSave(e)}
                />
              ))}
              {subEntities.length === 0 && (
                <p className="text-sm text-dim px-1">No subcontractors found.</p>
              )}
            </div>
          </section>

          {/* CONTRACTS */}
          <section>
            <SectionHeader label="Contracts" />
            <div className="space-y-4">
              {contractEntities.map((e) => (
                <EntityCard
                  key={e.id}
                  entity={e}
                  draft={drafts[e.id] ?? e.savedColor}
                  saving={saving === e.id}
                  saved={saved === e.id}
                  onChange={(c) => setDrafts((d) => ({ ...d, [e.id]: c }))}
                  onSave={() => handleSave(e)}
                />
              ))}
              {contractEntities.length === 0 && (
                <p className="text-sm text-dim px-1">No contracts found.</p>
              )}
            </div>
          </section>

        </div>
      )}
    </div>
  )
}
