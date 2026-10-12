import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import * as authApi from '../api/auth.api'
import { getErrorMessage } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'

type CallbackState = 'working' | 'error'

export function AuthCallbackPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [state, setState] = useState<CallbackState>('working')
  const [error, setError] = useState<string | null>(null)
  const attempted = useRef(false)

  const oauthError =
    params.get('error') ?? (params.get('error_description') ? 'Google sign-in was cancelled.' : null)

  useEffect(() => {
    // StrictMode mounts effects twice in dev — only exchange the cookie once.
    if (attempted.current) return
    attempted.current = true

    if (oauthError) {
      setError(oauthError)
      setState('error')
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const data = await authApi.refresh()
        const user = data.user ?? (await authApi.me())
        if (cancelled) return
        useAuthStore.getState().setAuth(user, data.accessToken)
        navigate('/', { replace: true })
      } catch (err) {
        if (cancelled) return
        setError(getErrorMessage(err))
        setState('error')
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retry = () => {
    setError(null)
    setState('working')
    attempted.current = true
    void (async () => {
      try {
        const data = await authApi.refresh()
        const user = data.user ?? (await authApi.me())
        useAuthStore.getState().setAuth(user, data.accessToken)
        navigate('/', { replace: true })
      } catch (err) {
        setError(getErrorMessage(err))
        setState('error')
      }
    })()
  }

  return (
    <div className="grid min-h-screen place-items-center bg-bg px-6">
      <div className="w-full max-w-sm text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-accent text-white">
          <ShieldCheck size={26} aria-hidden="true" />
        </span>

        {state === 'working' ? (
          <>
            <h1 className="mt-6 text-lg font-semibold text-fg">Finishing sign-in…</h1>
            <p className="mt-2 text-sm text-muted">
              Exchanging your Google session for an access token.
            </p>
            <div className="mt-8 flex justify-center">
              <Spinner size="lg" />
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-6 flex items-center justify-center gap-2 text-lg font-semibold text-fg">
              <AlertTriangle size={18} className="text-amber-500" aria-hidden="true" />
              Sign-in didn’t complete
            </h1>
            <p role="alert" className="mt-2 text-sm text-muted">
              {error ?? 'We could not verify your session. Please try again.'}
            </p>
            <div className="mt-8 flex justify-center gap-3">
              <Button onClick={retry}>Try again</Button>
              <Button variant="outline" onClick={() => navigate('/login', { replace: true })}>
                Back to sign in
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
