import { NavLink } from 'react-router-dom'
import { FolderKanban, LayoutDashboard, Settings, ShieldCheck, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../../utils/format'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export interface SidebarProps {
  open: boolean
  onClose: () => void
}

export function Sidebar({ open, onClose }: SidebarProps) {
  return (
    <>
      {/* Mobile overlay */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-40 bg-black/60 transition-opacity lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <aside
        aria-label="Main navigation"
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r bg-surface transition-transform lg:sticky lg:top-0 lg:z-20 lg:h-screen lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <NavLink to="/" className="flex items-center gap-2" onClick={onClose}>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15">
              <ShieldCheck aria-hidden="true" size={16} className="text-accent" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">ProofLoop</span>
          </NavLink>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="rounded-lg p-1.5 text-faint transition-colors hover:bg-raised hover:text-fg lg:hidden"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-raised text-fg' : 'text-muted hover:bg-raised/60 hover:text-fg',
                )
              }
            >
              <item.icon aria-hidden="true" size={16} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t p-3">
          <div className="rounded-lg bg-raised/60 px-3 py-2.5">
            <p className="text-xs font-medium text-fg">Tests decide PASS / FAIL</p>
            <p className="mt-0.5 text-xs text-muted">AI only explains — every finding carries its evidence.</p>
          </div>
        </div>
      </aside>
    </>
  )
}
