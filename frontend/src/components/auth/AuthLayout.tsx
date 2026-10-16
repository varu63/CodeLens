import { useRef } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { ThemeToggle } from '../ui/ThemeToggle'
import { AuthIllustration } from './AuthIllustration'
import { LensCursor } from './LensCursor'
import { AuthThemeProvider, useAuthTheme } from '../../theme/ThemeProvider'
import '../../styles/auth.css'

type AuthLayoutProps = {
  mode: 'signin' | 'register'
  onSwitchMode: (next: 'signin' | 'register') => void
  expired?: boolean
  children: ReactNode
}

export function AuthLayout({ mode, onSwitchMode, expired, children }: AuthLayoutProps) {
  return (
    <AuthThemeProvider>
      <AuthLayoutFrame mode={mode} onSwitchMode={onSwitchMode} expired={expired}>
        {children}
      </AuthLayoutFrame>
    </AuthThemeProvider>
  )
}

function AuthLayoutFrame({ mode, onSwitchMode, expired, children }: AuthLayoutProps) {
  const { resolved } = useAuthTheme()
  const artRef = useRef<HTMLElement>(null)
  const figureRef = useRef<HTMLDivElement>(null)

  return (
    <div className="auth-scope" data-auth-theme={resolved}>
      <div className="auth-page">
        <header className="auth-brand">
          <Link to="/" className="auth-brand__link" aria-label="ProofLoop home">
            <span className="auth-brand__mark" aria-hidden="true">
              <ShieldCheck size={19} />
            </span>
            <span className="auth-brand__name">ProofLoop</span>
          </Link>
        </header>

        <div className="auth-theme">
          <ThemeToggle />
        </div>

        <div className="auth-grid">
          <section className="auth-form-col">
            <div className="auth-form-box">
              <h1 className="auth-title">
                {mode === 'signin' ? 'Welcome back' : 'Create Account'}
              </h1>
              <p className="auth-switch">
                {mode === 'signin' ? (
                  <>
                    New here?{' '}
                    <button
                      type="button"
                      className="auth-switch__link"
                      onClick={() => onSwitchMode('register')}
                    >
                      Create account
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{' '}
                    <button
                      type="button"
                      className="auth-switch__link"
                      onClick={() => onSwitchMode('signin')}
                    >
                      Log in
                    </button>
                  </>
                )}
              </p>

              {expired && (
                <div role="status" className="auth-banner">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>Your session expired. Sign in again to continue.</span>
                </div>
              )}

              {children}

              <p className="auth-legal">
                {mode === 'register' ? 'By creating an account' : 'By continuing'}, I agree with
                ProofLoop&rsquo;s{' '}
                <a href="#" className="auth-legal__link">
                  Privacy Policy
                </a>{' '}
                and{' '}
                <a href="#" className="auth-legal__link">
                  Terms of Service
                </a>
                .
              </p>
            </div>
          </section>

          <aside className="auth-art" aria-hidden="true" ref={artRef}>
            <div className="auth-art__figure" ref={figureRef}>
              <AuthIllustration />
            </div>
            <LensCursor
              targetRef={artRef}
              contentRef={figureRef}
              magnifyContent={<AuthIllustration />}
            />
          </aside>
        </div>
      </div>
    </div>
  )
}

