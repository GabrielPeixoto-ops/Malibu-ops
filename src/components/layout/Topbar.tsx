'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Plus } from 'lucide-react'

const PAGE_TITLES: Record<string, string> = {
  '/':                          'Dashboard',
  '/jobs':                      'Jobs',
  '/jobs/new':                  'New Job',
  '/payroll':                   'Payroll',
  '/invoices':                  'Invoices',
  '/settings/employees':        'Employees',
  '/settings/subcontractors':   'Subcontractors',
  '/settings/contracts':        'Contracts',
  '/settings/customers':        'Customers',
  '/settings/private-pricing':  'Private Pricing',
  '/settings/fleet':            'Fleet',
  '/settings/entity-colors':    'Entity Colors',
  '/settings/commissions':      'Commissions',
  '/settings/xero':             'Xero',
}

function getTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname]
  if (/^\/jobs\/.+\/edit$/.test(pathname)) return 'Edit Job'
  return 'Malibu Ops'
}

export default function Topbar() {
  const pathname = usePathname()
  const title = getTitle(pathname)
  const isJobList = pathname === '/jobs'
  const showNewJob = pathname !== '/jobs/new' && !/^\/jobs\/.+\/edit$/.test(pathname)

  return (
    <header className="hidden lg:flex items-center justify-between px-6 py-3.5 bg-white border-b border-[#e5e4e0] shrink-0">
      <h1 className="text-[15px] font-semibold text-[#18181a] tracking-[-0.01em]">{title}</h1>
      <div className="flex items-center gap-2">
        {isJobList && (
          <span className="px-3 py-1.5 text-sm font-medium border border-[#e5e4e0] rounded-lg text-[#52504c] bg-white select-none">
            Filter
          </span>
        )}
        {showNewJob && (
          <Link
            href="/jobs/new"
            className="flex items-center gap-1.5 bg-[#D4AF37] hover:bg-[#E8C158] text-[#0d0d0d] text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus size={14} /> New Job
          </Link>
        )}
      </div>
    </header>
  )
}
