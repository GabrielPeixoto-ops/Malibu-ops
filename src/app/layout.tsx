import type { Metadata } from 'next'
import { Sora, Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import Sidebar from '@/components/layout/Sidebar'

const sora = Sora({ subsets: ['latin'], variable: '--font-sora', weight: ['600', '700'] })
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', weight: ['400', '500'] })

export const metadata: Metadata = {
  title: 'Malibu Ops',
  description: 'Malibu Moving Specialists — Operations Platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${sora.variable} ${inter.variable} ${jetbrains.variable}`}>
      <body className="h-full flex flex-col lg:flex-row bg-void text-parchment">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </body>
    </html>
  )
}
