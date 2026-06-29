import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { saveTokens } from '@/lib/xero'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const storedState = request.cookies.get('xero_oauth_state')?.value

  if (!code || !state || state !== storedState) {
    return NextResponse.redirect(
      new URL('/settings/xero?error=invalid_state', request.url)
    )
  }

  // Exchange auth code for tokens
  const creds = Buffer.from(
    `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
  ).toString('base64')

  let tokens: {
    access_token: string
    refresh_token: string
    expires_in: number
  }

  try {
    const tokenRes = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${creds}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.XERO_REDIRECT_URI!,
      }),
    })

    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      console.error('Xero token exchange error:', err)
      return NextResponse.redirect(
        new URL('/settings/xero?error=token_exchange', request.url)
      )
    }

    tokens = await tokenRes.json()
  } catch (err) {
    console.error('Xero callback fetch error:', err)
    return NextResponse.redirect(
      new URL('/settings/xero?error=network', request.url)
    )
  }

  // Fetch tenant info from Xero connections API
  let tenantId = ''
  let tenantName: string | undefined

  try {
    const connRes = await fetch('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (connRes.ok) {
      const conns: Array<{ tenantId: string; tenantName: string }> =
        await connRes.json()
      if (conns.length > 0) {
        tenantId = conns[0].tenantId
        tenantName = conns[0].tenantName
      }
    }
  } catch {
    // Non-fatal — tokens are still saved, tenant info can be fetched later
  }

  try {
    await saveTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      tenant_id: tenantId,
      tenant_name: tenantName,
    })
  } catch (err) {
    console.error('Xero saveTokens error:', err)
    return NextResponse.redirect(
      new URL('/settings/xero?error=db_save', request.url)
    )
  }

  const response = NextResponse.redirect(
    new URL('/settings/xero?connected=1', request.url)
  )
  response.cookies.delete('xero_oauth_state')
  return response
}
