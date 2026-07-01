import { useEffect, useState } from 'react'

// Module-level singleton — script is only injected once across all components.
type Status = 'idle' | 'loading' | 'ready'
let status: Status = 'idle'
const listeners: Array<() => void> = []

export function useGoogleMapsPlaces(): boolean {
  const [ready, setReady] = useState(status === 'ready')

  useEffect(() => {
    if (status === 'ready') {
      setReady(true)
      return
    }

    const onReady = () => setReady(true)
    listeners.push(onReady)

    if (status === 'loading') {
      return () => {
        const i = listeners.indexOf(onReady)
        if (i !== -1) listeners.splice(i, 1)
      }
    }

    status = 'loading'

    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!key) {
      console.warn('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set')
      return
    }

    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`
    script.async = true
    script.defer = true
    script.onload = () => {
      status = 'ready'
      listeners.forEach((fn) => fn())
      listeners.length = 0
    }
    document.head.appendChild(script)

    return () => {
      const i = listeners.indexOf(onReady)
      if (i !== -1) listeners.splice(i, 1)
    }
  }, [])

  return ready
}
