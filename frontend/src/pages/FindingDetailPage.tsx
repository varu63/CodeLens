import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Bot,
  CircleHelp,
  FileCode2,
  Globe,
  Layers,
  Lightbulb,
  MessageSquareText,
  ShieldCheck,
  Table2,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  Wrench,
  XCircle,
} from 'lucide-react'
import { useFinding, useSubmitFeedback } from '../hooks/useFindings'
import { getErrorMessage } from '../api/client'
import { EvidenceViewer } from '../components/findings/EvidenceViewer'
import { SendToAgentModal } from '../components/findings/SendToAgentModal'
import { Badge, SeverityBadge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { ErrorState } from '../components/ui/EmptyState'
import { Skeleton, SkeletonText } from '../components/ui/Skeleton'
import { toast } from '../components/ui/Toast'
import { cn, confidenceLabel, formatDateTime, formatPercent } from '../utils/format'
import { CATEGORY_LABELS, SEVERITY_META } from '../utils/severity'

const CONFIDENCE_CLASSES = {
  High: 'text-emerald-600 dark:text-emerald-400',
  Medium: 'text-amber-600 dark:text-amber-400',
  Low: 'text-red-600 dark:text-red-400',
} as const

export function FindingDetailPage() {
  const { findingId } = useParams<{ findingId: string }>()
  const findingQuery = useFinding(findingId)
  const [agentOpen, setAgentOpen] = useState(false)

  /* Feedback form state */
  const [useful, setUseful] = useState<boolean | null>(null)
  const [fixCorrect, setFixCorrect] = useState<boolean | null>(null)
  const [comment, setComment] = useState('')
  const [feedbackError, setFeedbackError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const feedback = useSubmitFeedback(findingId ?? '')

  if (findingQuery.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <SkeletonText lines={4} />
      </div>
    )
  }

  if (findingQuery.isError || !findingQuery.data) {
    return (
      <ErrorState
        className="mt-12"
        title="We couldn’t load this finding"
        message={getErrorMessage(findingQuery.error)}
        onRetry={() => void findingQuery.refetch()}
      />
    )
  }

  const finding = findingQuery.data
  const severity = SEVERITY_META[finding.severity]
  const confidence = confidenceLabel(finding.confidence)

  const submitFeedback = async () => {
    setFeedbackError(null)
    if (useful == null || fixCorrect == null) {
      setFeedbackError('Answer both questions before submitting.')
      return
    }
    try {
      await feedback.mutateAsync({
        useful,
        fixCorrect,
        comment: comment.trim() ? comment.trim() : undefined,
      })
      setSubmitted(true)
      toast.success('Feedback recorded', 'Thanks — this calibrates future findings.')
    } catch (error) {
      setFeedbackError(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            to={`/runs/${finding.runId}`}
            className="inline-flex items-center gap-1.5 text-muted transition-colors hover:text-fg"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Back to run
          </Link>
          <span aria-hidden="true" className="text-faint">/</span>
          <Link to={`/projects/${finding.projectId}`} className="text-muted transition-colors hover:text-fg">
            Project
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <SeverityBadge severity={finding.severity} />
          <Badge variant="muted">{CATEGORY_LABELS[finding.category]}</Badge>
          {!finding.evidenceValidated ? (
            <Badge variant="warning" dot title="The attached evidence could not be validated by a re-run">
              Unexplained
            </Badge>
          ) : (
            <Badge variant="success" dot title="Re-run validated the evidence">
              Evidence validated
            </Badge>
          )}
          {finding.comparisonStatus ? (
            <Badge
              variant={finding.comparisonStatus === 'fixed' ? 'success' : finding.comparisonStatus === 'new' ? 'warning' : 'danger'}
            >
              {finding.comparisonStatus === 'still_failing' ? 'Still failing' : finding.comparisonStatus === 'fixed' ? 'Fixed' : 'New'}
            </Badge>
          ) : null}
          {finding.clusterId && finding.clusterSize && finding.clusterSize > 1 ? (
            <Badge variant="info">
              <Layers size={11} aria-hidden="true" />
              {finding.clusterSize} failures, 1 root cause
            </Badge>
          ) : null}
        </div>

        <h1 className="mt-3 max-w-3xl text-xl font-semibold leading-snug tracking-tight text-fg">
          {finding.title}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{finding.description}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* Main column */}
        <div className="min-w-0 space-y-6">
          {/* Where */}
          <section className="card card-pad">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <FileCode2 size={15} className="text-faint" aria-hidden="true" />
              Where
            </h2>
            <dl className="mt-3 space-y-2.5">
              {finding.filePath ? (
                <div className="flex flex-wrap items-baseline gap-3">
                  <dt className="w-20 shrink-0 text-xs uppercase tracking-wide text-faint">File</dt>
                  <dd className="font-mono text-sm text-fg">
                    {finding.filePath}
                    {finding.line ? <span className="text-accent">:{finding.line}</span> : null}
                  </dd>
                </div>
              ) : null}
              {finding.endpoint ? (
                <div className="flex flex-wrap items-baseline gap-3">
                  <dt className="w-20 shrink-0 text-xs uppercase tracking-wide text-faint">Endpoint</dt>
                  <dd className="flex items-center gap-1.5 font-mono text-sm text-fg">
                    <Globe size={13} className="text-faint" aria-hidden="true" />
                    {finding.endpoint}
                  </dd>
                </div>
              ) : null}
              {finding.table ? (
                <div className="flex flex-wrap items-baseline gap-3">
                  <dt className="w-20 shrink-0 text-xs uppercase tracking-wide text-faint">Table</dt>
                  <dd className="flex items-center gap-1.5 font-mono text-sm text-fg">
                    <Table2 size={13} className="text-faint" aria-hidden="true" />
                    {finding.table}
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>

          {/* Evidence */}
          <section className="card card-pad">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-fg">Evidence</h2>
              <span className="text-xs text-faint">Raw output captured by the checks — not generated text</span>
            </div>
            <EvidenceViewer
              evidence={finding.evidence}
              evidenceValidated={finding.evidenceValidated}
            />
          </section>

          {/* Why it matters */}
          <section className="card card-pad">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <TrendingUp size={15} className="text-faint" aria-hidden="true" />
              Why it matters
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">{finding.whyItMatters}</p>
          </section>

          {/* How to fix */}
          <section className="card card-pad">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <Wrench size={15} className="text-faint" aria-hidden="true" />
              How to fix
            </h2>
            <ol className="mt-3 space-y-3">
              {finding.howToFix.map((step, index) => (
                <li key={index} className="flex gap-3 text-sm leading-relaxed">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">
                    {index + 1}
                  </span>
                  <span className="text-muted">{step}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* Not tested */}
          <section className="card card-pad">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <CircleHelp size={15} className="text-faint" aria-hidden="true" />
              What was not tested
            </h2>
            <ul className="mt-3 space-y-2">
              {finding.notTested.map((item, index) => (
                <li key={index} className="flex gap-2.5 text-sm leading-relaxed text-muted">
                  <XCircle size={14} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
                  {item}
                </li>
              ))}
              {finding.notTested.length === 0 ? (
                <li className="text-sm text-muted">No known coverage gaps for this finding.</li>
              ) : null}
            </ul>
          </section>
        </div>

        {/* Sidebar */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {/* Confidence + verdict */}
          <section className="card card-pad">
            <h2 className="text-sm font-semibold text-fg">Confidence</h2>
            <p className="mt-3 flex items-baseline gap-2">
              <span className={cn('text-2xl font-semibold tabular-nums', CONFIDENCE_CLASSES[confidence])}>
                {formatPercent(finding.confidence * 100, 0)}
              </span>
              <span className="text-xs text-muted">{confidence} confidence</span>
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised">
              <div
                className={cn('h-full rounded-full', severity.barClass)}
                style={{ width: `${Math.round(finding.confidence * 100)}%` }}
              />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-faint">
              {finding.evidenceValidated
                ? 'A re-run reproduced this failure — the verdict comes from tests, not from the model.'
                : 'Evidence could not be validated. Treat this finding as unexplained until a re-run reproduces it.'}
            </p>
            <dl className="mt-4 space-y-1.5 border-t pt-3 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-faint">Found</dt>
                <dd className="text-muted">{formatDateTime(finding.createdAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-faint">Fingerprint</dt>
                <dd className="truncate font-mono text-muted" title={finding.fingerprint}>
                  {finding.fingerprint}
                </dd>
              </div>
              {finding.clusterId ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-faint">Cluster</dt>
                  <dd className="truncate font-mono text-muted" title={finding.clusterId}>
                    {finding.clusterId}
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>

          {/* Send to agent */}
          <section className="card card-pad">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <Bot size={15} className="text-faint" aria-hidden="true" />
              Send to coding agent
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Hand this finding — with evidence and fix steps — to an agent that can open a PR, then
              rerun verification to prove the fix.
            </p>
            <Button
              variant="primary"
              className="mt-3 w-full justify-center"
              icon={<Bot size={15} />}
              onClick={() => setAgentOpen(true)}
            >
              Send to agent
            </Button>
          </section>

          {/* Feedback */}
          <section className="card card-pad">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <MessageSquareText size={15} className="text-faint" aria-hidden="true" />
              Was this finding useful?
            </h2>

            {submitted ? (
              <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  <BadgeCheck size={15} aria-hidden="true" />
                  Thanks — feedback recorded.
                </p>
                <p className="mt-1 text-xs text-muted">
                  It trains the ranking so future runs surface the right findings first.
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2"
                  onClick={() => {
                    setSubmitted(false)
                    setFeedbackError(null)
                  }}
                >
                  Edit feedback
                </Button>
              </div>
            ) : (
              <form
                className="mt-3 space-y-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  void submitFeedback()
                }}
              >
                <fieldset>
                  <legend className="text-xs font-medium uppercase tracking-wide text-faint">
                    Useful?
                  </legend>
                  <div className="mt-1.5 flex gap-2">
                    {(
                      [
                        { value: true, label: 'Yes', icon: ThumbsUp },
                        { value: false, label: 'No', icon: ThumbsDown },
                      ] as const
                    ).map((option) => (
                      <button
                        key={option.label}
                        type="button"
                        aria-pressed={useful === option.value}
                        onClick={() => setUseful(option.value)}
                        className={cn(
                          'inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                          useful === option.value
                            ? 'border-accent/50 bg-accent/10 text-accent'
                            : 'text-muted hover:bg-raised hover:text-fg',
                        )}
                      >
                        <option.icon size={14} aria-hidden="true" />
                        {option.label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="text-xs font-medium uppercase tracking-wide text-faint">
                    Was the suggested fix correct?
                  </legend>
                  <div className="mt-1.5 flex gap-2">
                    {(
                      [
                        { value: true, label: 'Yes', icon: ShieldCheck },
                        { value: false, label: 'No', icon: XCircle },
                      ] as const
                    ).map((option) => (
                      <button
                        key={option.label}
                        type="button"
                        aria-pressed={fixCorrect === option.value}
                        onClick={() => setFixCorrect(option.value)}
                        className={cn(
                          'inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                          fixCorrect === option.value
                            ? 'border-accent/50 bg-accent/10 text-accent'
                            : 'text-muted hover:bg-raised hover:text-fg',
                        )}
                      >
                        <option.icon size={14} aria-hidden="true" />
                        {option.label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div>
                  <label htmlFor="feedback-comment" className="text-xs font-medium uppercase tracking-wide text-faint">
                    Comment <span className="normal-case">(optional)</span>
                  </label>
                  <textarea
                    id="feedback-comment"
                    rows={3}
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder="Anything off about this finding?"
                    className="input mt-1.5 resize-y"
                  />
                </div>

                {feedbackError ? (
                  <p role="alert" className="text-xs text-red-500">
                    {feedbackError}
                  </p>
                ) : null}

                <Button type="submit" variant="secondary" loading={feedback.isPending} className="w-full justify-center">
                  Submit feedback
                </Button>
              </form>
            )}
          </section>

          {/* Related */}
          <section className="card card-pad text-xs">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <Lightbulb size={15} className="text-faint" aria-hidden="true" />
              Fix loop
            </h2>
            <p className="mt-2 leading-relaxed text-muted">
              Apply the fix, push, then{' '}
              <Link to={`/runs/${finding.runId}`} className="link">
                rerun this verification
              </Link>
              . Reruns compare by fingerprint and mark this finding as fixed automatically.
            </p>
            {!finding.evidenceValidated ? (
              <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-amber-700 dark:text-amber-400">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                This finding is flagged <strong>Unexplained</strong> — verify it manually before acting.
              </p>
            ) : null}
          </section>
        </aside>
      </div>

      {finding.id ? (
        <SendToAgentModal
          open={agentOpen}
          onClose={() => setAgentOpen(false)}
          runId={finding.runId}
          preselectedFindingId={finding.id}
        />
      ) : null}
    </div>
  )
}
