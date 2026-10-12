import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Zap } from 'lucide-react'
import { useStartRun } from '../../hooks/useRuns'
import { getErrorMessage } from '../../api/client'
import { Button } from '../ui/Button'
import type { ButtonProps } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { toast } from '../ui/Toast'

export interface VerifyButtonProps {
  projectId: string
  projectName: string
  defaultLoadUsers?: number
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
  label?: string
  className?: string
}

/**
 * Starts a verification run. Opens a small dialog to pick the load-test user
 * count, POSTs /projects/:id/runs and navigates to the live run page.
 */
export function VerifyButton({
  projectId,
  projectName,
  defaultLoadUsers = 50,
  size = 'md',
  variant = 'primary',
  label = 'Verify',
  className,
}: VerifyButtonProps) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [loadUsers, setLoadUsers] = useState<number>(defaultLoadUsers)
  const [error, setError] = useState<string | null>(null)
  const startRun = useStartRun(projectId)

  const openDialog = () => {
    setLoadUsers(defaultLoadUsers)
    setError(null)
    setOpen(true)
  }

  const submit = async () => {
    setError(null)
    if (!Number.isFinite(loadUsers) || loadUsers < 1 || loadUsers > 10_000) {
      setError('Enter a number of users between 1 and 10,000.')
      return
    }
    try {
      const result = await startRun.mutateAsync({ loadUsers })
      toast.success('Verification started', `Run ${result.runId} is queued.`)
      setOpen(false)
      navigate(`/runs/${result.runId}`)
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        icon={<Play size={15} fill="currentColor" />}
        onClick={openDialog}
      >
        {label}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        locked={startRun.isPending}
        title={`Verify “${projectName}”`}
        description="ProofLoop will run the full check suite — tests, API, data, DB, load and security baseline."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={startRun.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={<Zap size={15} />}
              loading={startRun.isPending}
              onClick={() => void submit()}
            >
              Start verification
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="verify-load-users" className="label">
              Load test — concurrent users
            </label>
            <input
              id="verify-load-users"
              type="number"
              min={1}
              max={10_000}
              className="input mt-1.5 w-40 tabular-nums"
              value={Number.isFinite(loadUsers) ? loadUsers : ''}
              onChange={(event) => setLoadUsers(Number(event.target.value))}
            />
            <p className="mt-1.5 text-xs text-muted">
              The load stage ramps through 1 / 10 / 50 / 100 users (capped at this budget) and
              records p95 latency, error rate and throughput per route.
            </p>
          </div>

          {error ? (
            <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  )
}
