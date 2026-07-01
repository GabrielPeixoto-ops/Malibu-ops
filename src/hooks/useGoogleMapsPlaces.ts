import { useEffect, useState } from 'react'

type Status = 'idle' | 'loading' | 'ready' | 'failed'

// Module-level singletons — script is only injected once.
let status: Status = 'idle'
const listeners: Array<() => void> = []

function notifyAll() {
  listeners.forEach((fn) => fn())
  listeners.length = 0
}

export function useGoogleMapsPlaces(): { ready: boolean; failed: boolean } {
  const [st, setSt] = useState<Status>(status)

  useEffect(() => {
    if (status === 'ready' || status === 'failed') {
      setSt(status)
      return
    }

    const onUpdate = () => setSt(status)
    listeners.push(onUpdate)

    // Already loading — just wait for the listener to fire.
    if (status === 'loading') {
      return () => {
        const i = listeners.indexOf(onUpdate)
        if (i !== -1) listeners.splice(i, 1)
      }
    }

    // ── Start loading ─────────────────────────────────────────────────────────
    status = 'loading'

    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!key) {
      console.warn('[AddressInput] NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set — address autocomplete disabled.')
      status = 'failed'
      setSt('failed')
      return
    }

    // Google calls this global when the key is invalid / API not enabled.
    ;(window as Window & { gm_authFailure?: () => void }).gm_authFailure = () => {
      console.warn('[AddressInput] Google Maps auth failure — check that Places API is enabled and the key has no domain restrictions blocking this origin.')
      status = 'failed'
      notifyAll()
    }

    const script = document.createElement('script')
    script.id = 'google-maps-places-script'
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`
    script.async = true
    script.defer = true
    script.onload = () => {
      console.info('[AddressInput] Google Maps Places API loaded successfully.')
      status = 'ready'
      notifyAll()
    }
    script.onerror = () => {
      console.warn('[AddressInput] Google Maps script failed to load (network error or blocked).')
      status = 'failed'
      notifyAll()
    }
    document.head.appendChild(script)

    return () => {
      const i = listeners.indexOf(onUpdate)
      if (i !== -1) listeners.splice(i, 1)
    }
  }, [])

  return { ready: st === 'ready', failed: st === 'failed' }
}
