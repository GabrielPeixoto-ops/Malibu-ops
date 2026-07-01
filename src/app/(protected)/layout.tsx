import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col lg:flex-row">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 canvas-theme">
          {children}
        </main>
      </div>
    </div>
  )
}
