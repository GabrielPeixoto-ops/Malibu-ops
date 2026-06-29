import { getTokenRow, decrypt, doTokenRefresh } from '@/lib/xero'

export const dynamic = 'force-dynamic'

export async function POST(): Promise<Response> {
  try {
    const row = await getTokenRow()
    if (!row) {
      return Response.json({ error: 'Xero not connected' }, { status: 401 })
    }

    const plainRefresh = decrypt(row.refresh_token)
    await doTokenRefresh(plainRefresh)

    return Response.json({ ok: true })
  } catch (err) {
    console.error('Xero refresh error:', err)
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
