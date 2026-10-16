import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Eye, EyeOff } from 'lucide-react'
import { googleAuthUrl } from '../api/auth.api'
import { getErrorMessage } from '../api/client'
import { useAuth } from '../hooks/useAuth'
import { useAuthStore } from '../store/authStore'
import { isMockMode } from '../mocks'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { AuthLayout } from '../components/auth/AuthLayout'

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

export function LoginPage() {
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { login, register } = useAuth()
  const status = useAuthStore((state) => state.status)
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [formError, setFormError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
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
    <AuthLayout mode={mode} onSwitchMode={switchMode} expired={expired}>
      <Button
        type="button"
        variant="outline"
        className="mt-6 auth-btn-google"
        onClick={handleGoogle}
        disabled={busy}
      >
        <GoogleIcon className="h-[18px] w-[18px] shrink-0" />
        {mode === 'signin' ? 'Sign in with Google' : 'Sign up with Google'}
      </Button>

      <div className="auth-divider">Or</div>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {mode === 'register' && (
          <div>
            <label htmlFor="name" className="auth-label">
              Name
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              className="auth-input"
              placeholder="Ada Lovelace"
              aria-invalid={Boolean(form.formState.errors.name)}
              {...form.register('name')}
            />
            {form.formState.errors.name && (
              <p className="auth-error">{form.formState.errors.name.message}</p>
            )}
          </div>
        )}

        <div>
          <label htmlFor="email" className="auth-label">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className="auth-input"
            placeholder="you@company.com"
            aria-invalid={Boolean(form.formState.errors.email)}
            {...form.register('email')}
          />
          {form.formState.errors.email && (
            <p className="auth-error">{form.formState.errors.email.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="password" className="auth-label">
            Password
          </label>
          <div className="auth-input-wrap">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              className="auth-input auth-input--with-eye"
              placeholder={mode === 'register' ? 'At least 8 characters' : '••••••••'}
              aria-invalid={Boolean(form.formState.errors.password)}
              {...form.register('password')}
            />
            <button
              type="button"
              className="auth-eye"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((visible) => !visible)}
            >
              {showPassword ? (
                <EyeOff size={17} aria-hidden="true" />
              ) : (
                <Eye size={17} aria-hidden="true" />
              )}
            </button>
          </div>
          {form.formState.errors.password && (
            <p className="auth-error">{form.formState.errors.password.message}</p>
          )}
        </div>

        {formError && (
          <div role="alert" className="auth-alert">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{formError}</span>
          </div>
        )}

        <Button type="submit" variant="primary" className="auth-submit" disabled={busy}>
          {busy ? (
            <Spinner size="sm" className="text-current" />
          ) : mode === 'signin' ? (
            'Sign in'
          ) : (
            'Create account'
          )}
        </Button>
      </form>
    </AuthLayout>
  )
}
