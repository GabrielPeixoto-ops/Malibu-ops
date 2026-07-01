'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Briefcase, Users, Truck, UserCircle, LayoutDashboard, X, Menu, Plus,
  DollarSign, Building2, FileText, Tag, Palette, BadgeDollarSign, LogOut, Plug,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import MalibuLogo from '@/components/ui/MalibuLogo'
import { createClient } from '@/lib/supabase/client'

const NAV_SECTIONS = [
  {
    label: 'OVERVIEW',
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'OPERATIONS',
    items: [
      { href: '/jobs', label: 'Jobs', icon: Briefcase },
      { href: '/settings/fleet', label: 'Fleet', icon: Truck },
    ],
  },
  {
    label: 'PEOPLE',
    items: [
      { href: '/settings/employees', label: 'Employees', icon: Users },
      { href: '/settings/subcontractors', label: 'Subcontractors', icon: Truck },
      { href: '/settings/contracts', label: 'Contracts', icon: Building2 },
      { href: '/settings/customers', label: 'Customers', icon: UserCircle },
    ],
  },
  {
    label: 'FINANCE',
    items: [
      { href: '/invoices', label: 'Invoices', icon: FileText },
      { href: '/payroll', label: 'Payroll', icon: DollarSign },
    ],
  },
  {
    label: 'SETTINGS',
    items: [
      { href: '/settings/private-pricing', label: 'Private Pricing', icon: Tag },
      { href: '/settings/entity-colors', label: 'Entity Colors', icon: Palette },
      { href: '/settings/commissions', label: 'Commissions', icon: BadgeDollarSign },
      { href: '/settings/xero', label: 'Xero', icon: Plug },
    ],
  },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [userEmail, setUserEmail] = useState('')

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setUserEmail(data.user?.email ?? ''))
  }, [])

  async function handleSignOut() {
    setSigningOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const userInitial = userEmail ? userEmail[0].toUpperCase() : '?'

  function isActive(href: string) {
    return pathname === href || (href !== '/' && pathname.startsWith(href))
  }

  function NavItem({ href, label, icon: Icon }: { href: string; label: string; icon: React.ElementType }) {
    const active = isActive(href)
    return (
      <Link
        href={href}
        onClick={() => setOpen(false)}
        className={`
          flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors
          border-r-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-gold
          ${active
            ? 'text-gold border-gold-ring bg-[rgba(212,175,55,0.07)]'
            : 'text-[#7a7874] hover:text-[#c4c0ba] hover:bg-[#141414] border-transparent'
          }
        `}
      >
        <Icon size={15} className={active ? 'text-gold' : 'text-[#5a5754]'} />
        {label}
      </Link>
    )
  }

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#0d0d0d] border-r border-[#1e1c1a]">
      {/* Logo */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-[#1e1c1a]">
        <Link href="/" onClick={() => setOpen(false)} className="hover:opacity-80 transition-opacity cursor-pointer">
          <MalibuLogo size="sm" />
        </Link>
        <button onClick={() => setOpen(false)} className="lg:hidden text-[#5a5754] hover:text-[#c4c0ba] transition-colors" aria-label="Close menu">
          <X size={18} />
        </button>
      </div>

      {/* New Job button */}
      <div className="px-3 pt-3 pb-3 border-b border-[#1e1c1a]">
        <Link
          href="/jobs/new"
          onClick={() => setOpen(false)}
          className="flex items-center justify-center gap-2 w-full bg-gold hover:bg-gold-bright text-void text-sm font-semibold py-2 px-3 rounded-lg transition-colors font-body focus:outline-none focus:ring-2 focus:ring-gold-ring focus:ring-offset-2 focus:ring-offset-[#0d0d0d]"
        >
          <Plus size={15} />
          New Job
        </Link>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-4">
            <p className="px-3 mb-1 text-[10px] font-semibold text-[#3d3b38] uppercase tracking-widest">
              {section.label}
            </p>
            {section.items.map(({ href, label, icon }) => (
              <NavItem key={href} href={href} label={label} icon={icon} />
            ))}
          </div>
        ))}
      </nav>

      {/* User + sign out */}
      <div className="px-3 py-3 border-t border-[#1e1c1a]">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg">
          <div className="w-7 h-7 rounded-full bg-gold/20 border border-gold-ring/40 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-gold">{userInitial}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[#7a7874] truncate">{userEmail || '…'}</p>
          </div>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            title="Sign out"
            className="text-[#3d3b38] hover:text-danger transition-colors disabled:opacity-50 shrink-0"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* Mobile top bar */}
      <header className="lg:hidden flex items-center justify-between bg-[#0d0d0d] border-b border-[#1e1c1a] px-4 py-3">
        <Link href="/" onClick={() => setOpen(false)} className="hover:opacity-80 transition-opacity">
          <MalibuLogo size="sm" />
        </Link>
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="text-[#7a7874] hover:text-[#c4c0ba] transition-colors">
          <Menu size={24} />
        </button>
      </header>

      {/* Overlay */}
      {open && (
        <div className="fixed inset-0 bg-black/70 z-20 lg:hidden" onClick={() => setOpen(false)} />
      )}

      {/* Sidebar panel — mobile: fixed overlay, desktop: static */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-30 w-56
          transform transition-transform duration-200
          ${open ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 lg:static lg:flex lg:flex-col lg:w-56 lg:shrink-0
        `}
      >
        {sidebarContent}
      </aside>
    </>
  )
}
