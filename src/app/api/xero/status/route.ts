import { getTokenRow } from '@/lib/xero'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  try {
    const row = await getTokenRow()
    if (!row) {
      return Response.json({ connected: false })
    }

    const expiresAt = new Date(row.expires_at).getTime()
    const tokenExpired = Date.now() > expiresAt

    return Response.json({
      connected: true,
      tenant_name: row.tenant_name,
      expires_at: row.expires_at,
      token_expired: tokenExpired,
    })
  } catch (err) {
    return Response.json({ connected: false, error: String(err) })
  }
}
