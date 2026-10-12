import { useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Activity, TrendingDown } from 'lucide-react'
import type { LoadTestResult, RouteLoadResult } from '../../types/domain.types'
import { cn, formatNumber } from '../../utils/format'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/EmptyState'

const AXIS_TICK = { fill: 'rgb(var(--c-faint))', fontSize: 11 } as const
const GRID_STROKE = 'rgb(var(--c-border))'

function RoutePanel({ route, result }: { route: RouteLoadResult; result: LoadTestResult }) {
  const breaking = route.breakingPointUsers
  const breakingLevel = route.levels.find((level) => level.users === breaking)
  const lastLevel = route.levels[route.levels.length - 1]

  return (
    <div>
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 pb-3">
        <span className="font-mono text-sm font-semibold text-fg">
          <span className="mr-2 text-accent">{route.method.toUpperCase()}</span>
          {route.route}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <Activity size={13} aria-hidden="true" />
          peak {formatNumber(route.peakRps)} req/s
        </span>
        {breaking != null ? (
          <Badge variant="warning" dot>
            Breaks at {breaking} users
            {breakingLevel ? ` · ${breakingLevel.errorRatePct}% errors` : ''}
          </Badge>
        ) : (
          <Badge variant="success" dot>
            Held every level
          </Badge>
        )}
        {lastLevel ? (
          <span className="text-xs text-faint">
            p95 at {lastLevel.users} users: {lastLevel.p95Ms} ms · {lastLevel.errorRatePct}% errors
          </span>
        ) : null}
      </div>

      {/* Chart */}
      <div className="h-64 w-full sm:h-72" aria-label={`Latency and error rate versus concurrent users for ${route.method} ${route.route}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={route.levels} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="users"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: GRID_STROKE }}
              tickFormatter={(value: number) => `${value}u`}
            />
            <YAxis
              yAxisId="latency"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={(value: number) => `${value}ms`}
            />
            <YAxis
              yAxisId="errors"
              orientation="right"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={40}
              domain={[0, (max: number) => Math.max(20, Math.ceil(max * 1.2))]}
              tickFormatter={(value: number) => `${value}%`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgb(var(--c-raised))',
                border: '1px solid rgb(var(--c-border))',
                borderRadius: 10,
                fontSize: 12,
              }}
              labelStyle={{ color: 'rgb(var(--c-muted))' }}
              labelFormatter={(label) => `${label} concurrent users`}
              formatter={(value, name) => {
                const numeric = typeof value === 'number' ? value : Number(value)
                if (name === 'p95 latency') return [`${numeric} ms`, name]
                if (name === 'Error rate') return [`${numeric}%`, name]
                return [`${numeric}`, name]
              }}
            />
            <ReferenceLine
              yAxisId="latency"
              y={result.thresholdP95Ms}
              stroke="#f59e0b"
              strokeDasharray="6 4"
              strokeWidth={1.5}
            />
            <ReferenceLine
              yAxisId="errors"
              y={result.thresholdErrorRatePct}
              stroke="#ef4444"
              strokeDasharray="6 4"
              strokeWidth={1.5}
            />
            <Line
              yAxisId="latency"
              type="monotone"
              dataKey="p95Ms"
              name="p95 latency"
              stroke="rgb(var(--c-accent))"
              strokeWidth={2.5}
              dot={{ r: 3, strokeWidth: 2 }}
              activeDot={{ r: 5 }}
            />
            <Line
              yAxisId="errors"
              type="monotone"
              dataKey="errorRatePct"
              name="Error rate"
              stroke="#ef4444"
              strokeWidth={2.5}
              dot={{ r: 3, strokeWidth: 2 }}
              activeDot={{ r: 5 }}
            />
            {breaking != null && breakingLevel ? (
              <ReferenceDot
                yAxisId="latency"
                x={breaking}
                y={breakingLevel.p95Ms}
                r={6}
                fill="#ef4444"
                stroke="rgb(var(--c-surface))"
                strokeWidth={2}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1 pt-2 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true" /> p95 latency (left)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" aria-hidden="true" /> Error rate (right)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-5 border-t-2 border-dashed border-amber-500" aria-hidden="true" />
          p95 budget {result.thresholdP95Ms} ms
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-5 border-t-2 border-dashed border-red-500" aria-hidden="true" />
          error budget {result.thresholdErrorRatePct}%
        </span>
        {breaking != null ? (
          <span className="flex items-center gap-1.5 text-red-500">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-surface" aria-hidden="true" />
            breaking point
          </span>
        ) : null}
      </div>

      {/* Per-level table */}
      <div className="mt-4 overflow-x-auto rounded-xl border">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Throughput and latency per load level for {route.method} {route.route}
          </caption>
          <thead>
            <tr className="border-b bg-raised/60 text-xs uppercase tracking-wide text-faint">
              <th scope="col" className="px-4 py-2.5 text-left">Users</th>
              <th scope="col" className="px-4 py-2.5 text-right">Requests/s</th>
              <th scope="col" className="px-4 py-2.5 text-right">p50</th>
              <th scope="col" className="px-4 py-2.5 text-right">p95</th>
              <th scope="col" className="px-4 py-2.5 text-right">p99</th>
              <th scope="col" className="px-4 py-2.5 text-right">Error rate</th>
            </tr>
          </thead>
          <tbody>
            {route.levels.map((level) => {
              const overError = level.errorRatePct > result.thresholdErrorRatePct
              const overP95 = level.p95Ms > result.thresholdP95Ms
              const isBreaking = level.users === breaking
              return (
                <tr
                  key={level.users}
                  className={cn(
                    'border-b last:border-b-0',
                    isBreaking && 'bg-red-500/10',
                    !isBreaking && (overError || overP95) && 'bg-amber-500/5',
                  )}
                >
                  <td className="px-4 py-2.5 font-medium tabular-nums text-fg">
                    {level.users}
                    {isBreaking ? (
                      <span className="ml-2 text-[11px] font-semibold uppercase text-red-500">breaking</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{formatNumber(level.requestsPerSecond)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{level.p50Ms} ms</td>
                  <td className={cn('px-4 py-2.5 text-right tabular-nums', overP95 ? 'font-semibold text-red-500' : 'text-muted')}>
                    {level.p95Ms} ms
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{level.p99Ms} ms</td>
                  <td className={cn('px-4 py-2.5 text-right tabular-nums', overError ? 'font-semibold text-red-500' : 'text-muted')}>
                    {level.errorRatePct}%
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export interface LoadChartProps {
  data: LoadTestResult
  className?: string
}

export function LoadChart({ data, className }: LoadChartProps) {
  const [selectedRoute, setSelectedRoute] = useState(0)

  if (data.routes.length === 0) {
    return (
      <EmptyState
        icon={TrendingDown}
        title="No load test data"
        description="The load stage hasn’t produced results for this run yet."
        className={className}
      />
    )
  }

  const route = data.routes[Math.min(selectedRoute, data.routes.length - 1)]

  return (
    <div className={className}>
      <div role="tablist" aria-label="Routes" className="mb-4 flex flex-wrap gap-1.5">
        {data.routes.map((item, index) => (
          <button
            key={`${item.method} ${item.route}`}
            role="tab"
            aria-selected={index === selectedRoute}
            type="button"
            onClick={() => setSelectedRoute(index)}
            className={cn(
              'rounded-lg border px-3 py-1.5 font-mono text-xs font-medium transition-colors',
              index === selectedRoute
                ? 'border-accent/40 bg-accent/15 text-accent'
                : 'border-border bg-surface text-muted hover:bg-raised hover:text-fg',
            )}
          >
            <span className="mr-1.5 font-semibold">{item.method.toUpperCase()}</span>
            {item.route}
          </button>
        ))}
      </div>
      <RoutePanel route={route} result={data} />
    </div>
  )
}
