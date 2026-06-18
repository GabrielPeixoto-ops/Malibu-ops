'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import MalibuLogo from '@/components/ui/MalibuLogo'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) {
      setError('Invalid email or password.')
      setLoading(false)
      return
    }
    router.push('/')
    router.refresh()
  }

  return (
    <div className="min-h-full flex items-center justify-center bg-void px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-10">
          <MalibuLogo size="lg" />
        </div>

        <div className="bg-surface border border-wire rounded-2xl p-8">
          <h2 className="text-lg font-display font-semibold text-parchment mb-6">Sign In</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-dim mb-1.5" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-wire rounded-lg bg-panel text-parchment placeholder-dim focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-dim mb-1.5" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-wire rounded-lg bg-panel text-parchment placeholder-dim focus:outline-none focus:border-gold-ring focus:ring-1 focus:ring-gold-ring"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-sm text-danger font-medium">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-gold text-void text-sm font-semibold rounded-lg hover:bg-gold-bright transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
