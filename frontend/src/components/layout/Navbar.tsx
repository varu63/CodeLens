import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { CircleUserRound, LogOut, Menu, Moon, Settings, ShieldCheck, Sun } from 'lucide-react'
import { toast } from '../ui/Toast'
import { Badge } from '../ui/Badge'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'
import { cn } from '../../utils/format'

export interface NavbarProps {
  onMenuClick: () => void
}

export function Navbar({ onMenuClick }: NavbarProps) {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  function handleLogout() {
    setMenuOpen(false)
    logout(undefined, {
      onSuccess: () => toast.success('Signed out', 'See you next time.'),
      onSettled: () => navigate('/login'),
    })
  }

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((part) => part[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '?'

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b bg-bg/85 px-4 backdrop-blur lg:px-6">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open navigation menu"
          className="rounded-lg p-2 text-muted transition-colors hover:bg-raised hover:text-fg lg:hidden"
        >
          <Menu aria-hidden="true" size={18} />
        </button>
        <Link to="/" className="flex items-center gap-2 lg:hidden">
          <ShieldCheck aria-hidden="true" size={18} className="text-accent" />
          <span className="text-sm font-semibold tracking-tight">ProofLoop</span>
        </Link>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={toggle}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          className="rounded-lg p-2 text-muted transition-colors hover:bg-raised hover:text-fg"
        >
          {theme === 'dark' ? <Sun aria-hidden="true" size={17} /> : <Moon aria-hidden="true" size={17} />}
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Account menu"
            className="flex items-center gap-2 rounded-lg p-1.5 pr-2.5 transition-colors hover:bg-raised"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
              {initials}
            </span>
            <span className="hidden text-sm font-medium sm:block">{user?.name ?? 'Account'}</span>
          </button>

          {menuOpen ? (
            <>
              <div
                aria-hidden="true"
                className="fixed inset-0 z-40"
                onClick={() => setMenuOpen(false)}
              />
              <div
                role="menu"
                aria-label="Account"
                className="absolute right-0 z-50 mt-2 w-64 rounded-xl border bg-surface p-1.5 shadow-xl animate-fade-in"
              >
                <div className="border-b px-3 py-2.5">
                  <p className="truncate text-sm font-medium">{user?.name}</p>
                  <p className="truncate text-xs text-muted">{user?.email}</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <Badge variant={user?.role === 'admin' ? 'accent' : 'default'}>
                      {user?.role === 'admin' ? 'Admin' : 'Member'}
                    </Badge>
                    <Badge variant="muted">
                      <CircleUserRound aria-hidden="true" size={11} /> {user?.id}
                    </Badge>
                  </div>
                </div>
                <NavLink
                  to="/settings"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                      isActive ? 'bg-raised text-fg' : 'text-muted hover:bg-raised hover:text-fg',
                    )
                  }
                >
                  <Settings aria-hidden="true" size={15} /> Settings
                </NavLink>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-fg"
                >
                  <LogOut aria-hidden="true" size={15} /> Sign out
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </header>
  )
}
