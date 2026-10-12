import type { ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { FullPageLoader } from '../ui/Spinner'
import { EmptyState } from '../ui/EmptyState'

export interface ProtectedRouteProps {
  children: ReactNode
  /** When true, only users with role === 'admin' may pass. */
  requireAdmin?: boolean
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const status = useAuthStore((state) => state.status)
  const user = useAuthStore((state) => state.user)
  const location = useLocation()

  if (status === 'idle' || status === 'initializing') {
    return <FullPageLoader label="Checking your session…" />
  }

  if (status === 'unauthenticated' || !user) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  }

  if (requireAdmin && user.role !== 'admin') {
    return (
      <EmptyState
        className="mt-16"
        icon={ShieldAlert}
        title="Admins only"
        description="Your account does not have permission to view this page. Ask an admin if you need access."
        action={
          <Link
            to="/"
            className="inline-flex h-9 items-center rounded-lg border px-3.5 text-sm font-medium text-fg transition-colors hover:bg-raised"
          >
            Back to dashboard
          </Link>
        }
      />
    )
  }

  return <>{children}</>
}
