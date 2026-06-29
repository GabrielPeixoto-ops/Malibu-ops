import crypto from 'crypto'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// ── Encryption ─────────────────────────────────────────────────────────────────
// AES-256-GCM: 12-byte IV + 16-byte authTag + ciphertext, all base64-encoded.

function encKey(): Buffer {
  const k = process.env.XERO_ENCRYPTION_KEY
  if (!k) throw new Error('XERO_ENCRYPTION_KEY is not set')
  return Buffer.from(k, 'hex')
}

export function encrypt(plain: string): string {
  const key = encKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decrypt(encoded: string): string {
  const key = encKey()
  const buf = Buffer.from(encoded, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const data = buf.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(data).toString('utf8') + decipher.final('utf8')
}

// ── Supabase system client (bypasses session; xero_tokens has no RLS) ──────────
export function sysSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createSupabaseClient(url, key, { auth: { persistSession: false } })
}

// ── Token row type ─────────────────────────────────────────────────────────────
export interface XeroTokenRow {
  id: number
  access_token: string   // encrypted
  refresh_token: string  // encrypted
  expires_at: string     // ISO
  tenant_id: string
  tenant_name: string | null
  updated_at: string
}

// ── Token storage ──────────────────────────────────────────────────────────────
export async function saveTokens(opts: {
  access_token: string
  refresh_token: string
  expires_in: number
  tenant_id: string
  tenant_name?: string | null
}): Promise<void> {
  const sb = sysSupabase()
  const expiresAt = new Date(Date.now() + opts.expires_in * 1000).toISOString()
  const { error } = await sb.from('xero_tokens').upsert({
    id: 1,
    access_token: encrypt(opts.access_token),
    refresh_token: encrypt(opts.refresh_token),
    expires_at: expiresAt,
    tenant_id: opts.tenant_id,
    tenant_name: opts.tenant_name ?? null,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(`saveTokens: ${error.message}`)
}

export async function getTokenRow(): Promise<XeroTokenRow | null> {
  const sb = sysSupabase()
  const { data, error } = await sb
    .from('xero_tokens')
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(`getTokenRow: ${error.message}`)
  return data as XeroTokenRow | null
}

// ── Token refresh ──────────────────────────────────────────────────────────────
export async function doTokenRefresh(refreshTokenPlain: string): Promise<string> {
  const creds = Buffer.from(
    `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
  ).toString('base64')

  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${creds}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshTokenPlain,
    }),
  })

  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Xero token refresh failed (${res.status}): ${txt}`)
  }

  const data = await res.json()
  const existing = await getTokenRow()

  await saveTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    tenant_id: existing?.tenant_id ?? '',
    tenant_name: existing?.tenant_name,
  })

  return data.access_token as string
}

// ── Get a valid (non-expired) access token, refreshing if needed ───────────────
export async function validAccessToken(): Promise<string> {
  const row = await getTokenRow()
  if (!row) throw new Error('Xero not connected')

  const expiresMs = new Date(row.expires_at).getTime()
  if (Date.now() + 60_000 < expiresMs) {
    return decrypt(row.access_token)
  }

  return doTokenRefresh(decrypt(row.refresh_token))
}

// ── Low-level Xero API fetch ───────────────────────────────────────────────────
export async function xeroFetch(
  path: string,
  opts: { method?: string; body?: unknown } = {}
): Promise<Response> {
  const row = await getTokenRow()
  if (!row) throw new Error('Xero not connected')

  const token = await validAccessToken()

  return fetch(`https://api.xero.com/api.xro/2.0${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Xero-Tenant-Id': row.tenant_id,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  })
}
