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
      setBanner({ type: 'ok', text: 'Xero conectado com sucesso!' })
    } else if (params.get('error')) {
      const code = params.get('error')
      const msgs: Record<string, string> = {
        invalid_state: 'Estado OAuth inválido — tenta novamente.',
        token_exchange: 'Erro ao trocar o código por token — verifica as credenciais.',
        db_save: 'Tokens obtidos mas falhou a guardar na base de dados.',
        network: 'Erro de rede ao contactar o Xero.',
      }
      setBanner({ type: 'err', text: msgs[code ?? ''] ?? `Erro: ${code}` })
    }

    fetchStatus().finally(() => setLoading(false))
  }, [])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      const res = await fetch('/api/xero/refresh', { method: 'POST' })
      if (res.ok) {
        setBanner({ type: 'ok', text: 'Token renovado com sucesso.' })
        await fetchStatus()
      } else {
        const d = await res.json()
        setBanner({ type: 'err', text: d.error ?? 'Falhou a renovação.' })
      }
    } catch {
      setBanner({ type: 'err', text: 'Erro de rede ao renovar token.' })
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
          Estado da Conexão
        </h2>

        {loading ? (
          <p className="text-warm text-sm">A verificar…</p>
        ) : status?.connected ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <CheckCircle size={20} className="text-success shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-parchment">Conectado</p>
                {status.tenant_name && (
                  <p className="text-xs text-dim mt-0.5">
                    Organização: <span className="text-warm">{status.tenant_name}</span>
                  </p>
                )}
                {status.expires_at && (
                  <p className="text-xs text-dim mt-0.5">
                    Token expira em{' '}
                    {new Date(status.expires_at).toLocaleString('pt-AU', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    {status.token_expired && (
                      <span className="ml-1 text-danger font-medium">(expirado)</span>
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
                {refreshing ? 'A renovar…' : 'Renovar Token'}
              </Button>
            )}

            <div className="pt-3 border-t border-wire">
              <a
                href="/api/xero/auth"
                className="text-sm text-gold hover:text-gold-bright underline"
              >
                Reconectar / Trocar conta Xero
              </a>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <XCircle size={20} className="text-dim shrink-0" />
              <p className="text-sm text-warm">Não conectado</p>
            </div>
            <a href="/api/xero/auth">
              <Button size="md">
                <Plug size={15} />
                Conectar Xero
              </Button>
            </a>
          </div>
        )}
      </div>

      {/* Webhook instructions */}
      <div className="bg-surface rounded-xl border border-wire p-4 text-sm space-y-3">
        <h2 className="text-xs font-semibold text-dim uppercase tracking-wide">
          Webhook (para pagamentos automáticos)
        </h2>
        <div className="space-y-1 text-xs text-dim">
          <p>
            1. No Xero: <span className="text-warm">Settings → Webhooks → New</span>
          </p>
          <p>
            2. URL:{' '}
            <code className="text-gold font-mono bg-panel px-1 py-0.5 rounded text-[11px]">
              https://malibu-ops.vercel.app/api/xero/webhook
            </code>
          </p>
          <p>3. Copia a <span className="text-warm">Webhook Key</span> e adiciona ao Vercel como <code className="font-mono">XERO_WEBHOOK_KEY</code></p>
          <p className="text-dim/70">Eventos: Invoice — Update</p>
        </div>
        <a
          href="https://developer.xero.com/documentation/guides/webhooks/overview/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-gold hover:text-gold-bright"
        >
          Documentação Xero Webhooks
          <ExternalLink size={11} />
        </a>
      </div>
    </div>
  )
}
