'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Briefcase, Users, Truck, UserCircle, LayoutDashboard, X, Menu, Plus, DollarSign, Building2, FileText, Tag } from 'lucide-react'
import { useState } from 'react'

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
]

export default function Sidebar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Mobile top bar */}
      <header className="lg:hidden flex items-center justify-between bg-gray-900 text-white px-4 py-3">
        <span className="font-bold text-lg">Malibu Ops</span>
        <button onClick={() => setOpen(true)} aria-label="Open menu">
          <Menu size={24} />
        </button>
      </header>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-30 w-56 bg-gray-900 text-white flex flex-col
          transform transition-transform duration-200
          ${open ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 lg:static lg:flex
        `}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-700">
          <span className="font-bold text-lg">Malibu Ops</span>
          <button onClick={() => setOpen(false)} className="lg:hidden" aria-label="Close menu">
            <X size={20} />
          </button>
        </div>

        <div className="px-3 pt-3 pb-2 border-b border-gray-700">
          <Link
            href="/jobs/new"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold py-2 px-3 rounded-lg transition-colors"
          >
            <Plus size={16} />
            New Job
          </Link>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/' && pathname.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`
                  flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors
                  ${active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}
                `}
              >
                <Icon size={18} />
                {label}
              </Link>
            )
          })}
        </nav>
      </aside>
    </>
  )
}
