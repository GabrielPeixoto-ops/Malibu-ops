import type { Metadata } from 'next'
import './globals.css'
import Sidebar from '@/components/layout/Sidebar'

export const metadata: Metadata = {
  title: 'Malibu Ops',
  description: 'Malibu Moving Specialists — Operations Platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full flex flex-col lg:flex-row bg-gray-50">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </body>
    </html>
  )
}
