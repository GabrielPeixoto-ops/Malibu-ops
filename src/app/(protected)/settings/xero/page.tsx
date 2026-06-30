'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, RefreshCw, Plug, ExternalLink } from 'lucide-react'
import Button from '@/components/ui/Button'

interface XeroStatus {
  connected: boolean
  tenant_name?: string | null
  expires_at?: string
  token_expired?: boolean
  error?: string
}

export default function XeroSettingsPage() {
  const [status, setStatus] = useState<XeroStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  async function fetchStatus() {
    const res = await fetch('/api/xero/status')
    const data: XeroStatus = await res.json()
    setStatus(data)
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('connected')) {
      setBanner({ type: 'ok', text: 'Xero connected successfully!' })
    } else if (params.get('error')) {
      const code = params.get('error')
      const msgs: Record<string, string> = {
        invalid_state: 'Invalid OAuth state — please try again.',
        token_exchange: 'Failed to exchange code for token — check your credentials.',
        db_save: 'Tokens received but failed to save to the database.',
        network: 'Network error contacting Xero.',
      }
      setBanner({ type: 'err', text: msgs[code ?? ''] ?? `Error: ${code}` })
    }

    fetchStatus().finally(() => setLoading(false))
  }, [])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      const res = await fetch('/api/xero/refresh', { method: 'POST' })
      if (res.ok) {
        setBanner({ type: 'ok', text: 'Token refreshed successfully.' })
        await fetchStatus()
      } else {
        const d = await res.json()
        setBanner({ type: 'err', text: d.error ?? 'Token refresh failed.' })
      }
    } catch {
      setBanner({ type: 'err', text: 'Network error refreshing token.' })
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-display font-bold text-parchment mb-6">Xero Integration</h1>

      {banner && (
        <div
          className={`mb-5 px-4 py-3 rounded-lg text-sm border ${
            banner.type === 'ok'
              ? 'bg-success/10 border-success/30 text-success'
              : 'bg-danger/10 border-danger/30 text-danger'
          }`}
        >
          {banner.text}
        </div>
      )}

      {/* Connection status card */}
      <div className="bg-surface rounded-xl border border-wire p-6 mb-4">
        <h2 className="text-xs font-semibold text-dim uppercase tracking-wide mb-5">
          Connection Status
        </h2>

        {loading ? (
          <p className="text-warm text-sm">Checking…</p>
        ) : status?.connected ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <CheckCircle size={20} className="text-success shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-parchment">Connected</p>
                {status.tenant_name && (
                  <p className="text-xs text-dim mt-0.5">
                    Organisation: <span className="text-warm">{status.tenant_name}</span>
                  </p>
                )}
                {status.expires_at && (
                  <p className="text-xs text-dim mt-0.5">
                    Token expires{' '}
                    {new Date(status.expires_at).toLocaleString('en-AU', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    {status.token_expired && (
                      <span className="ml-1 text-danger font-medium">(expired)</span>
                    )}
                  </p>
                )}
              </div>
            </div>

            {status.token_expired && (
              <Button
                onClick={handleRefresh}
                disabled={refreshing}
                size="sm"
                variant="secondary"
              >
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                {refreshing ? 'Refreshing…' : 'Refresh Token'}
              </Button>
            )}

            <div className="pt-3 border-t border-wire">
              <a
                href="/api/xero/auth"
                className="text-sm text-gold hover:text-gold-bright underline"
              >
                Reconnect / Switch Xero account
              </a>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <XCircle size={20} className="text-dim shrink-0" />
              <p className="text-sm text-warm">Not connected</p>
            </div>
            <a href="/api/xero/auth">
              <Button size="md">
                <Plug size={15} />
                Connect Xero
              </Button>
            </a>
          </div>
        )}
      </div>

      {/* Webhook instructions */}
      <div className="bg-surface rounded-xl border border-wire p-4 text-sm space-y-3">
        <h2 className="text-xs font-semibold text-dim uppercase tracking-wide">
          Webhook (automatic payment updates)
        </h2>
        <div className="space-y-1 text-xs text-dim">
          <p>
            1. In Xero: <span className="text-warm">Settings → Webhooks → New</span>
          </p>
          <p>
            2. URL:{' '}
            <code className="text-gold font-mono bg-panel px-1 py-0.5 rounded text-[11px]">
              https://malibu-ops.vercel.app/api/xero/webhook
            </code>
          </p>
          <p>3. Copy the <span className="text-warm">Webhook Key</span> and add it to Vercel as <code className="font-mono">XERO_WEBHOOK_KEY</code></p>
          <p className="text-dim/70">Events: Invoice — Update</p>
        </div>
        <a
          href="https://developer.xero.com/documentation/guides/webhooks/overview/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-gold hover:text-gold-bright"
        >
          Xero Webhooks Documentation
          <ExternalLink size={11} />
        </a>
      </div>
    </div>
  )
}
