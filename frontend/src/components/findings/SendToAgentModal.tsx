import { useEffect, useState } from 'react'
import { Bot, Send } from 'lucide-react'
import { useRunFindingsForAgent, useSendToAgent } from '../../hooks/useFindings'
import { getErrorMessage } from '../../api/client'
import type { AgentKind } from '../../types/api.types'
import { cn } from '../../utils/format'
import { SEVERITY_META, CATEGORY_LABELS, compareSeverity } from '../../utils/severity'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Skeleton } from '../ui/Skeleton'
import { toast } from '../ui/Toast'

const AGENTS: { id: AgentKind; name: string; description: string }[] = [
  { id: 'claude_code', name: 'Claude Code', description: 'Runs in your terminal with full repo access' },
  { id: 'codex', name: 'OpenAI Codex', description: 'Cloud sandbox, opens a pull request with the fix' },
  { id: 'cursor', name: 'Cursor', description: 'Applies the fix through the editor agent panel' },
  { id: 'aider', name: 'Aider', description: 'Edits files locally and commits the changes' },
]

export interface SendToAgentModalProps {
  open: boolean
  onClose: () => void
  runId: string
  preselectedFindingId: string
}

/**
 * Sends one or more findings — with their evidence and fix plan — to a coding
 * agent. The backend queues the agent run; the UI reports the queue id.
 */
export function SendToAgentModal({ open, onClose, runId, preselectedFindingId }: SendToAgentModalProps) {
  const [agent, setAgent] = useState<AgentKind>('claude_code')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set([preselectedFindingId]))
  const [error, setError] = useState<string | null>(null)

  const findingsQuery = useRunFindingsForAgent(open ? runId : undefined)
  const sendToAgent = useSendToAgent(runId)

  useEffect(() => {
    if (open) {
      setSelectedIds(new Set([preselectedFindingId]))
      setError(null)
    }
  }, [open, preselectedFindingId])

  const toggle = (findingId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(findingId)) next.delete(findingId)
      else next.add(findingId)
      return next
    })
  }

  const findings = [...(findingsQuery.data?.items ?? [])].sort((a, b) =>
    compareSeverity(a.severity, b.severity),
  )

  const submit = async () => {
    setError(null)
    if (selectedIds.size === 0) {
      setError('Select at least one finding to send.')
      return
    }
    try {
      const result = await sendToAgent.mutateAsync({ agent, findingIds: [...selectedIds] })
      const agentName = AGENTS.find((item) => item.id === result.agent)?.name ?? result.agent
      toast.success(
        `Sent to ${agentName}`,
        `${result.findingCount} ${result.findingCount === 1 ? 'finding' : 'findings'} queued · agent run ${result.agentRunId}`,
      )
      onClose()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={sendToAgent.isPending}
      size="lg"
      title="Send to coding agent"
      description="The agent receives each finding with its evidence, fix steps and confidence — and can rerun verification via CLI."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={sendToAgent.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<Send size={14} />}
            loading={sendToAgent.isPending}
            onClick={() => void submit()}
          >
            Send {selectedIds.size > 0 ? `${selectedIds.size} ` : ''}
            {selectedIds.size === 1 ? 'finding' : 'findings'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Agent picker */}
        <fieldset>
          <legend className="label">Agent</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {AGENTS.map((item) => (
              <label
                key={item.id}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                  agent === item.id ? 'border-accent/50 bg-accent/5' : 'hover:bg-raised/50',
                )}
              >
                <input
                  type="radio"
                  name="agent"
                  value={item.id}
                  checked={agent === item.id}
                  onChange={() => setAgent(item.id)}
                  className="mt-1 accent-[rgb(var(--c-accent))]"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
                    <Bot size={13} className="text-faint" aria-hidden="true" />
                    {item.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">{item.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Findings picker */}
        <fieldset>
          <legend className="label">
            Findings{' '}
            <span className="font-normal text-faint">
              ({selectedIds.size} of {findings.length || '…'} selected)
            </span>
          </legend>
          <div className="max-h-60 overflow-y-auto rounded-xl border">
            {findingsQuery.isPending ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-12 w-full" />
                ))}
              </div>
            ) : findingsQuery.isError ? (
              <div className="p-4 text-sm text-red-500">
                Could not load findings.{' '}
                <button type="button" className="link" onClick={() => void findingsQuery.refetch()}>
                  Retry
                </button>
              </div>
            ) : (
              findings.map((finding) => (
                <label
                  key={finding.id}
                  className="flex cursor-pointer items-start gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-raised/40"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(finding.id)}
                    onChange={() => toggle(finding.id)}
                    className="mt-1 accent-[rgb(var(--c-accent))]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{finding.title}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge className={SEVERITY_META[finding.severity].badgeClass}>
                        {SEVERITY_META[finding.severity].label}
                      </Badge>
                      <Badge variant="muted">{CATEGORY_LABELS[finding.category]}</Badge>
                      {finding.clusterSize && finding.clusterSize > 1 ? (
                        <span className="text-[11px] text-faint">
                          {finding.clusterSize} failures, 1 root cause
                        </span>
                      ) : null}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>
        </fieldset>

        {error ? (
          <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
