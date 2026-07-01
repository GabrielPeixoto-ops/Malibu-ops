'use client'

import { useEffect, useState } from 'react'

type Status = 'idle' | 'loading' | 'ready' | 'failed'

// Module-level singletons — script is only injected once per page load.
let status: Status = 'idle'
const listeners: Array<() => void> = []

const CALLBACK_NAME = '__googleMapsPlacesReady__'

function notifyAll() {
  listeners.forEach((fn) => fn())
  listeners.length = 0
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gwin = () => (typeof window !== 'undefined' ? (window as any) : null)

function isAlreadyLoaded() {
  return !!gwin()?.google?.maps?.places
}

export function useGoogleMapsPlaces(): { ready: boolean; failed: boolean } {
  const [st, setSt] = useState<Status>(() => {
    // If a previous render cycle already loaded the API, pick it up immediately.
    if (isAlreadyLoaded()) status = 'ready'
    return status
  })

  useEffect(() => {
    // Re-check after hydration in case the API was already present on the window.
    if (isAlreadyLoaded()) {
      status = 'ready'
      setSt('ready')
      return
    }

    if (status === 'ready' || status === 'failed') {
      setSt(status)
      return
    }

    const onUpdate = () => setSt(status)
    listeners.push(onUpdate)

    // Already loading — just wait for the callback to fire.
    if (status === 'loading') {
      return () => {
        const i = listeners.indexOf(onUpdate)
        if (i !== -1) listeners.splice(i, 1)
      }
    }

    // ── Start loading ─────────────────────────────────────────────────────────
    status = 'loading'

    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    console.log('[Maps] key:', key ? `${key.slice(0, 8)}… (present)` : 'MISSING')

    if (!key) {
      console.warn('[Maps] NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set — autocomplete disabled.')
      status = 'failed'
      setSt('failed')
      return
    }

    // Named callback: Google calls this ONLY after the full API + libraries are
    // initialised. More reliable than script.onload for this purpose.
    gwin()[CALLBACK_NAME] = () => {
      console.info('[Maps] Places API ready ✓')
      status = 'ready'
      notifyAll()
    }

    gwin().gm_authFailure = () => {
      console.warn('[Maps] gm_authFailure — verify Maps JavaScript API and Places API are enabled in Google Cloud, and the key has no restrictions blocking this origin.')
      status = 'failed'
      notifyAll()
    }

    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&callback=${CALLBACK_NAME}`
    script.async = true
    script.onerror = () => {
      console.warn('[Maps] Script failed to load (network error or blocked URL).')
      status = 'failed'
      notifyAll()
    }
    console.log('[Maps] Injecting Maps JS script…')
    document.head.appendChild(script)

    return () => {
      const i = listeners.indexOf(onUpdate)
      if (i !== -1) listeners.splice(i, 1)
    }
  }, [])

  return { ready: st === 'ready', failed: st === 'failed' }
}
