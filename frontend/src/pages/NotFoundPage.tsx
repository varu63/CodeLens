import { Link } from 'react-router-dom'
import { Compass, Home } from 'lucide-react'

export function NotFoundPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-bg px-6">
      <div className="text-center">
        <p className="font-mono text-6xl font-semibold tracking-tight text-accent">404</p>
        <h1 className="mt-4 flex items-center justify-center gap-2 text-lg font-semibold text-fg">
          <Compass size={18} className="text-faint" aria-hidden="true" />
          This page doesn’t exist
        </h1>
        <p className="mt-2 text-sm text-muted">
          The page you’re looking for was moved, removed or never existed.
        </p>
        <Link
          to="/"
          className="mt-8 inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover dark:text-bg"
        >
          <Home size={15} aria-hidden="true" />
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
