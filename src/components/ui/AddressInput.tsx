'use client'

import { useEffect, useRef } from 'react'
import type { InputHTMLAttributes } from 'react'
import Input from './Input'
import { useGoogleMapsPlaces } from '@/hooks/useGoogleMapsPlaces'

interface AddressInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  label?: string
  value: string
  onValueChange: (value: string) => void
}

export default function AddressInput({
  value,
  onValueChange,
  disabled,
  ...rest
}: AddressInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { ready, failed } = useGoogleMapsPlaces()
  const acRef = useRef<google.maps.places.Autocomplete | null>(null)

  useEffect(() => {
    // Skip autocomplete entirely if Maps failed, not ready yet, or field is disabled.
    if (!ready || failed || !inputRef.current || disabled) return

    try {
      acRef.current = new google.maps.places.Autocomplete(inputRef.current, {
        types: ['address'],
        componentRestrictions: { country: 'au' },
      })

      const listener = acRef.current.addListener('place_changed', () => {
        const place = acRef.current!.getPlace()
        const addr = place.formatted_address ?? inputRef.current?.value ?? ''
        onValueChange(addr)
      })

      return () => {
        google.maps.event.removeListener(listener)
      }
    } catch (err) {
      console.warn('[AddressInput] Failed to initialise Places Autocomplete:', err)
    }
  }, [ready, failed, disabled])

  // Always render a functional Input — autocomplete is progressive enhancement.
  return (
    <Input
      ref={inputRef}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      disabled={disabled}
      {...rest}
    />
  )
}
