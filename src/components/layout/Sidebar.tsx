'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Briefcase, Users, Truck, UserCircle, LayoutDashboard, X, Menu, Plus, DollarSign, Building2, FileText, Tag, Palette, BadgeDollarSign, LogOut, Plug } from 'lucide-react'
import { useState } from 'react'
import MalibuLogo from '@/components/ui/MalibuLogo'
import { createClient } from '@/lib/supabase/client'

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/payroll', label: 'Payroll', icon: DollarSign },
  { href: '/invoices', label: 'Invoices', icon: FileText },
  { href: '/settings/employees', label: 'Employees', icon: Users },
  { href: '/settings/subcontractors', label: 'Subcontractors', icon: Truck },
  { href: '/settings/contracts', label: 'Contracts', icon: Building2 },
  { href: '/settings/customers', label: 'Customers', icon: UserCircle },
  { href: '/settings/private-pricing', label: 'Private Pricing', icon: Tag },
  { href: '/settings/fleet', label: 'Fleet', icon: Truck },
  { href: '/settings/entity-colors', label: 'Entity Colors', icon: Palette },
  { href: '/settings/commissions', label: 'Commissions', icon: BadgeDollarSign },
  { href: '/settings/xero', label: 'Xero', icon: Plug },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <>
      {/* Mobile top bar */}
      <header className="lg:hidden flex items-center justify-between bg-surface border-b border-wire px-4 py-3">
        <Link href="/" onClick={() => setOpen(false)} className="hover:opacity-80 transition-opacity">
          <MalibuLogo size="sm" />
        </Link>
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="text-warm hover:text-parchment transition-colors">
          <Menu size={24} />
        </button>
      </header>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/70 z-20 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-30 w-56 bg-surface border-r border-wire flex flex-col
          transform transition-transform duration-200
          ${open ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 lg:static lg:flex
        `}
      >
        {/* Logo header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-wire">
          <Link href="/" onClick={() => setOpen(false)} className="hover:opacity-80 transition-opacity cursor-pointer">
            <MalibuLogo size="sm" />
          </Link>
          <button onClick={() => setOpen(false)} className="lg:hidden text-warm hover:text-parchment transition-colors" aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        {/* New Job button */}
        <div className="px-3 pt-3 pb-3 border-b border-wire">
          <Link
            href="/jobs/new"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-2 w-full bg-gold hover:bg-gold-bright text-void text-sm font-semibold py-2 px-3 rounded-lg transition-colors font-body focus:outline-none focus:ring-2 focus:ring-gold-ring focus:ring-offset-2 focus:ring-offset-surface"
          >
            <Plus size={15} />
            New Job
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/' && pathname.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`
                  flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors
                  border-l-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-gold
                  ${active
                    ? 'bg-gold/8 text-gold border-gold-ring'
                    : 'text-warm hover:bg-panel hover:text-parchment border-transparent'
                  }
                `}
              >
                <Icon size={16} className={active ? 'text-gold' : 'text-dim'} />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Sign Out */}
        <div className="px-2 py-3 border-t border-wire">
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium text-dim hover:bg-panel hover:text-danger transition-colors disabled:opacity-50"
          >
            <LogOut size={16} />
            {signingOut ? 'Signing out…' : 'Sign Out'}
          </button>
        </div>
      </aside>
    </>
  )
}
