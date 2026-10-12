import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Github, ShieldCheck, Sparkles } from 'lucide-react'
import { googleAuthUrl } from '../api/auth.api'
import { getErrorMessage } from '../api/client'
import { useAuth } from '../hooks/useAuth'
import { useAuthStore } from '../store/authStore'
import { isMockMode } from '../mocks'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'

const signInSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(80, 'Name is too long'),
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(120, 'Password is too long'),
})

type SignInValues = z.infer<typeof signInSchema>
type RegisterValues = z.infer<typeof registerSchema>
type FormValues = SignInValues & Partial<Pick<RegisterValues, 'name'>>

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.29a7.2 7.2 0 0 1 0-4.58v-3.1H1.27a12 12 0 0 0 0 10.78l4.01-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.35.61 4.6 1.8l3.44-3.44A11.98 11.98 0 0 0 12 0 12 12 0 0 0 1.27 6.61l4.01 3.1C6.22 6.88 8.87 4.77 12 4.77Z"
      />
    </svg>
  )
}

const FEATURES = [
  'Real tests decide PASS / FAIL — AI only explains.',
  'Every finding carries evidence, confidence and what was not tested.',
  'Rerun after a fix and see exactly what changed.',
] as const

export function LoginPage() {
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { login, register } = useAuth()
  const status = useAuthStore((state) => state.status)
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [formError, setFormError] = useState<string | null>(null)
  const expired = params.get('expired') === '1'

  const from =
    (location.state as { from?: string } | null)?.from ??
    (params.get('from') ? decodeURIComponent(params.get('from') as string) : '/')

  useEffect(() => {
    if (status === 'authenticated') navigate(from, { replace: true })
  }, [status, from, navigate])

  const form = useForm<FormValues>({
    resolver: zodResolver(mode === 'register' ? registerSchema : signInSchema),
    defaultValues: { name: '', email: '', password: '' },
  })

  const switchMode = (next: 'signin' | 'register') => {
    setMode(next)
    setFormError(null)
    form.clearErrors()
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      if (mode === 'register') {
        await register.mutateAsync({
          name: values.name ?? '',
          email: values.email,
          password: values.password,
        })
      } else {
        await login.mutateAsync({ email: values.email, password: values.password })
      }
      navigate(from, { replace: true })
    } catch (error) {
      setFormError(getErrorMessage(error))
    }
  })

  const handleGoogle = () => {
    if (isMockMode()) {
      navigate('/auth/callback')
      return
    }
    window.location.href = googleAuthUrl()
  }

  const busy = login.isPending || register.isPending

  return (
    <div className="grid min-h-screen bg-bg lg:grid-cols-2">
      {/* Left: form */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <Link to="/" className="inline-flex items-center gap-2" aria-label="ProofLoop home">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-white">
              <ShieldCheck size={20} aria-hidden="true" />
            </span>
            <span className="text-lg font-semibold tracking-tight text-fg">ProofLoop</span>
          </Link>

          <h1 className="mt-10 text-2xl font-semibold tracking-tight text-fg">
            {mode === 'signin' ? 'Sign in to your workspace' : 'Create your workspace'}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {mode === 'signin'
              ? 'Verify your codebase before your users do.'
              : 'Connect a repo, run verification, ship with proof.'}
          </p>

          {expired && (
            <div
              role="status"
              className="mt-6 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-sm text-amber-600 dark:text-amber-400"
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>Your session expired. Sign in again to continue.</span>
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            className="mt-6 h-10 w-full justify-center gap-2.5 bg-surface text-sm font-medium"
            onClick={handleGoogle}
            disabled={busy}
          >
            <GoogleIcon className="h-4.5 w-4.5" />
            Continue with Google
          </Button>

          <div className="my-6 flex items-center gap-3 text-xs text-faint">
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
            or continue with email
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
          </div>

          <form onSubmit={onSubmit} noValidate className="space-y-4">
            {mode === 'register' && (
              <div>
                <label htmlFor="name" className="label">
                  Name
                </label>
                <input
                  id="name"
                  type="text"
                  autoComplete="name"
                  className="input mt-1.5"
                  placeholder="Ada Lovelace"
                  aria-invalid={Boolean(form.formState.errors.name)}
                  {...form.register('name')}
                />
                {form.formState.errors.name && (
                  <p className="mt-1.5 text-xs text-red-500">{form.formState.errors.name.message}</p>
                )}
              </div>
            )}

            <div>
              <label htmlFor="email" className="label">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className="input mt-1.5"
                placeholder="you@company.com"
                aria-invalid={Boolean(form.formState.errors.email)}
                {...form.register('email')}
              />
              {form.formState.errors.email && (
                <p className="mt-1.5 text-xs text-red-500">{form.formState.errors.email.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="label">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                className="input mt-1.5"
                placeholder={mode === 'register' ? 'At least 8 characters' : '••••••••'}
                aria-invalid={Boolean(form.formState.errors.password)}
                {...form.register('password')}
              />
              {form.formState.errors.password && (
                <p className="mt-1.5 text-xs text-red-500">
                  {form.formState.errors.password.message}
                </p>
              )}
            </div>

            {formError && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-sm text-red-500"
              >
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{formError}</span>
              </div>
            )}

            <Button type="submit" className="h-10 w-full justify-center" disabled={busy}>
              {busy ? (
                <Spinner size="sm" className="text-white" />
              ) : mode === 'signin' ? (
                'Sign in'
              ) : (
                'Create account'
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted">
            {mode === 'signin' ? (
              <>
                New to ProofLoop?{' '}
                <button
                  type="button"
                  className="link font-medium"
                  onClick={() => switchMode('register')}
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  className="link font-medium"
                  onClick={() => switchMode('signin')}
                >
                  Sign in
                </button>
              </>
            )}
          </p>

          <p className="mt-8 text-center text-xs text-faint">
            By continuing you agree to the acceptable-use policy.
          </p>
        </div>
      </div>

      {/* Right: marketing panel */}
      <div className="relative hidden overflow-hidden border-l bg-sunken lg:flex lg:flex-col lg:justify-center lg:px-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-accent/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-40 -left-24 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl"
        />
        <div className="relative max-w-md">
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-surface px-3 py-1 text-xs font-medium text-muted">
            <Sparkles size={13} className="text-accent" aria-hidden="true" />
            AI Codebase Verification
          </span>
          <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-tight text-fg">
            Ship with proof, not hope.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            ProofLoop runs real checks against your codebase — tests, APIs, data, load and security —
            then explains every failure with evidence, confidence and a concrete fix plan.
          </p>
          <ul className="mt-8 space-y-4">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-3 text-sm text-fg">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-500">
                  <ShieldCheck size={12} aria-hidden="true" />
                </span>
                {feature}
              </li>
            ))}
          </ul>
          <p className="mt-10 flex items-center gap-2 text-xs text-faint">
            <Github size={14} aria-hidden="true" />
            Works with your existing CI — no test rewrites.
          </p>
        </div>
      </div>
    </div>
  )
}
