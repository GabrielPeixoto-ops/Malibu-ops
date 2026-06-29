import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { xeroFetch } from '@/lib/xero'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<Response> {
  let invoiceId: string
  try {
    const body = await request.json()
    invoiceId = body.invoice_id
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!invoiceId) {
    return Response.json({ error: 'invoice_id is required' }, { status: 400 })
  }

  // Use the session-aware server client (user must be authenticated)
  const sb = await createClient()

  // Fetch invoice record
  const { data: invoice, error: invErr } = await sb
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .single()

  if (invErr || !invoice) {
    return Response.json({ error: 'Invoice not found' }, { status: 404 })
  }

  if (invoice.status !== 'draft') {
    return Response.json(
      { error: `Invoice is already ${invoice.status}` },
      { status: 409 }
    )
  }

  // Fetch linked jobs for line items
  const { data: invJobs } = await sb
    .from('invoice_jobs')
    .select('amount, job:jobs(job_number, date, pickup_address, delivery_address)')
    .eq('invoice_id', invoiceId)

  type InvJob = {
    amount: number
    job: { job_number: string; date: string; pickup_address: string | null; delivery_address: string | null } | null
  }

  const lineItems = invJobs && invJobs.length > 0
    ? (invJobs as unknown as InvJob[]).map((ij) => ({
        Description: ij.job
          ? `Job #${ij.job.job_number} — ${ij.job.date}` +
            (ij.job.pickup_address ? ` (${ij.job.pickup_address})` : '')
          : `Invoice period: ${invoice.period_from} – ${invoice.period_to}`,
        Quantity: 1.0,
        UnitAmount: ij.amount,
        AccountCode: '200',
      }))
    : [{
        Description: `Services — ${invoice.period_from} to ${invoice.period_to}`,
        Quantity: 1.0,
        UnitAmount: invoice.total_amount,
        AccountCode: '200',
      }]

  // Due date: period_to + 14 days
  const due = new Date(invoice.period_to)
  due.setDate(due.getDate() + 14)
  const dueDate = due.toISOString().split('T')[0]

  const payload = {
    Invoices: [
      {
        Type: 'ACCREC',
        Contact: { Name: invoice.entity_name },
        Date: invoice.period_from,
        DueDate: dueDate,
        LineItems: lineItems,
        Status: 'AUTHORISED',
        Reference: invoice.invoice_number,
      },
    ],
  }

  let xeroRes: Response
  try {
    xeroRes = await xeroFetch('/Invoices', { method: 'POST', body: payload })
  } catch (err) {
    return Response.json(
      { error: 'Xero not connected or network error', detail: String(err) },
      { status: 502 }
    )
  }

  if (!xeroRes.ok) {
    const detail = await xeroRes.text()
    console.error('Xero create invoice error:', detail)
    return Response.json(
      { error: 'Xero API error', detail },
      { status: 502 }
    )
  }

  const xeroData = await xeroRes.json()
  const xeroInvoice = xeroData.Invoices?.[0]

  if (!xeroInvoice?.InvoiceID) {
    return Response.json({ error: 'No InvoiceID in Xero response' }, { status: 502 })
  }

  const xeroInvoiceId: string = xeroInvoice.InvoiceID
  const xeroInvoiceUrl = `https://go.xero.com/AccountsReceivable/Edit.aspx?InvoiceID=${xeroInvoiceId}`

  const { error: updateErr } = await sb
    .from('invoices')
    .update({
      xero_invoice_id: xeroInvoiceId,
      xero_invoice_url: xeroInvoiceUrl,
      status: 'sent',
    })
    .eq('id', invoiceId)

  if (updateErr) {
    console.error('Failed to update invoice after Xero send:', updateErr.message)
  }

  return Response.json({ xero_invoice_id: xeroInvoiceId, xero_invoice_url: xeroInvoiceUrl })
}
