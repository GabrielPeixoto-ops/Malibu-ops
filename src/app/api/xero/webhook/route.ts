import crypto from 'crypto'
import type { NextRequest } from 'next/server'
import { sysSupabase, getTokenRow, validAccessToken } from '@/lib/xero'

export const dynamic = 'force-dynamic'

interface XeroEvent {
  resourceId: string
  eventType: string
  eventCategory: string
}

interface XeroWebhookPayload {
  events: XeroEvent[]
}

export async function POST(request: NextRequest): Promise<Response> {
  const body = await request.text()

  // Verify webhook signature when the key is configured
  const webhookKey = process.env.XERO_WEBHOOK_KEY
  if (webhookKey) {
    const expected = crypto
      .createHmac('sha256', webhookKey)
      .update(body)
      .digest('base64')
    const received = request.headers.get('x-xero-signature')

    if (received !== expected) {
      return new Response(null, { status: 401 })
    }
  }

  let payload: XeroWebhookPayload
  try {
    payload = JSON.parse(body)
  } catch {
    return new Response(null, { status: 400 })
  }

  const events: XeroEvent[] = payload.events ?? []

  for (const event of events) {
    if (event.eventCategory !== 'INVOICE' || event.eventType !== 'UPDATE') {
      continue
    }

    try {
      const row = await getTokenRow()
      if (!row) break

      const token = await validAccessToken()
      const xeroRes = await fetch(
        `https://api.xero.com/api.xro/2.0/Invoices/${event.resourceId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Xero-Tenant-Id': row.tenant_id,
            Accept: 'application/json',
          },
        }
      )

      if (!xeroRes.ok) continue

      const data = await xeroRes.json()
      const xeroInvoice = data.Invoices?.[0]

      if (xeroInvoice?.Status === 'PAID') {
        const sb = sysSupabase()
        await sb
          .from('invoices')
          .update({ status: 'paid' })
          .eq('xero_invoice_id', event.resourceId)
      }
    } catch (err) {
      console.error('Xero webhook event error:', err)
    }
  }

  return new Response(null, { status: 200 })
}
