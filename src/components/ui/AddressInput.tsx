'use client'

import { useState, useRef, useCallback } from 'react'
import type { InputHTMLAttributes } from 'react'
import Input from './Input'

interface Suggestion {
  placeId: string
  text: string
  mainText: string
  secondaryText: string
}

interface PlacesResponse {
  suggestions?: Array<{
    placePrediction: {
      placeId: string
      text: { text: string }
      structuredFormat: {
        mainText: { text: string }
        secondaryText?: { text: string }
      }
    }
  }>
  error?: { message: string; status: string }
}

interface AddressInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  label?: string
  value: string
  onValueChange: (value: string) => void
}

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

async function fetchPlaceSuggestions(input: string): Promise<Suggestion[]> {
  if (!input || input.length < 3 || !API_KEY) return []

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask':
          'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat',
      },
      body: JSON.stringify({
        input,
        includedRegionCodes: ['au'],
        languageCode: 'en',
      }),
    })

    const data: PlacesResponse = await res.json()

    if (data.error) {
      console.warn('[AddressInput] Places API error:', data.error.status, data.error.message)
      return []
    }

    return (data.suggestions ?? []).map(({ placePrediction: p }) => ({
      placeId: p.placeId,
      text: p.text.text,
      mainText: p.structuredFormat.mainText.text,
      secondaryText: p.structuredFormat.secondaryText?.text ?? '',
    }))
  } catch (err) {
    console.warn('[AddressInput] fetch error:', err)
    return []
  }
}

export default function AddressInput({
  value,
  onValueChange,
  disabled,
  label,
  ...rest
}: AddressInputProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const query = useCallback(async (input: string) => {
    const results = await fetchPlaceSuggestions(input)
    setSuggestions(results)
    setOpen(results.length > 0)
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    onValueChange(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (v.length >= 3) {
      debounceRef.current = setTimeout(() => query(v), 300)
    } else {
      setSuggestions([])
      setOpen(false)
    }
  }

  function handleSelect(text: string) {
    onValueChange(text)
    setSuggestions([])
    setOpen(false)
  }

  return (
    <div className="relative">
      <Input
        label={label}
        value={value}
        onChange={handleChange}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        disabled={disabled}
        autoComplete="off"
        {...rest}
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-panel border border-wire rounded-lg shadow-xl overflow-hidden">
          {suggestions.map((s) => (
            <li
              key={s.placeId}
              onMouseDown={() => handleSelect(s.text)}
              className="px-3 py-2 text-sm cursor-pointer border-t border-wire first:border-t-0 hover:bg-surface"
            >
              <span className="text-parchment">{s.mainText}</span>
              {s.secondaryText && (
                <span className="text-dim text-xs ml-1">, {s.secondaryText}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
