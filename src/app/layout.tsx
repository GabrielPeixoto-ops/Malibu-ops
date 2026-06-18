import type { Metadata } from 'next'
import { Sora, Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

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
      <body className="h-full bg-void text-parchment">
        {children}
      </body>
    </html>
  )
}
