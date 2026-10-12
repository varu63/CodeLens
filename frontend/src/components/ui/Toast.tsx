import { useEffect } from 'react'
import { create } from 'zustand'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../../utils/format'

export type ToastVariant = 'success' | 'error' | 'info' | 'warning'

export interface ToastItem {
  id: string
  variant: ToastVariant
  title: string
  description?: string
}

interface ToastState {
  toasts: ToastItem[]
  push: (toast: Omit<ToastItem, 'id'>) => void
  dismiss: (id: string) => void
}

const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (item) =>
    set((state) => ({
      toasts: [...state.toasts, { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }].slice(-4),
    })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))

/** Imperative toast API — callable from anywhere (components, hooks, query client). */
// Fast refresh prefers component-only files, but keeping the tiny toast API
// next to its container avoids a second file for a single store.
// eslint-disable-next-line react-refresh/only-export-components
export const toast = {
  success: (title: string, description?: string) => useToastStore.getState().push({ variant: 'success', title, description }),
  error: (title: string, description?: string) => useToastStore.getState().push({ variant: 'error', title, description }),
  info: (title: string, description?: string) => useToastStore.getState().push({ variant: 'info', title, description }),
  warning: (title: string, description?: string) => useToastStore.getState().push({ variant: 'warning', title, description }),
}

const VARIANT_META: Record<ToastVariant, { icon: LucideIcon; iconClass: string; borderClass: string }> = {
  success: { icon: CheckCircle2, iconClass: 'text-emerald-500', borderClass: 'border-emerald-500/30' },
  error: { icon: XCircle, iconClass: 'text-red-500', borderClass: 'border-red-500/30' },
  info: { icon: Info, iconClass: 'text-blue-500', borderClass: 'border-blue-500/30' },
  warning: { icon: AlertTriangle, iconClass: 'text-amber-500', borderClass: 'border-amber-500/30' },
}

function ToastCard({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((state) => state.dismiss)
  const meta = VARIANT_META[item.variant]
  const Icon = meta.icon

  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(item.id), 5_500)
    return () => window.clearTimeout(timer)
  }, [item.id, dismiss])

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-surface p-4 shadow-lg animate-slide-in-right',
        meta.borderClass,
      )}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 h-4.5 w-4.5 shrink-0', meta.iconClass)} size={18} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{item.title}</p>
        {item.description ? <p className="mt-0.5 text-sm text-muted">{item.description}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label="Dismiss notification"
        className="rounded-md p-1 text-faint transition-colors hover:bg-raised hover:text-fg"
      >
        <X aria-hidden="true" size={14} />
      </button>
    </div>
  )
}

export function ToastContainer() {
  const toasts = useToastStore((state) => state.toasts)
  if (toasts.length === 0) return null
  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5"
    >
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>
  )
}
