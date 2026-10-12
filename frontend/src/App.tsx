import { useEffect } from 'react'
import { AppRoutes } from './routes'
import { ToastContainer } from './components/ui/Toast'
import { bootstrapSession } from './hooks/useAuth'

export default function App() {
  useEffect(() => {
    // Silent refresh on load so a page reload keeps the user signed in.
    void bootstrapSession()
  }, [])

  return (
    <>
      <AppRoutes />
      <ToastContainer />
    </>
  )
}
