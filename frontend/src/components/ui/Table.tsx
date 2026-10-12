import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './Button'
import { Skeleton } from './Skeleton'
import { cn, pluralize } from '../../utils/format'

export interface Column<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  className?: string
  headerClassName?: string
  align?: 'left' | 'center' | 'right'
}

export interface TableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  loading?: boolean
  skeletonRows?: number
  empty?: ReactNode
  onRowClick?: (row: T) => void
  className?: string
  caption?: string
}

const ALIGN_CLASSES = { left: 'text-left', center: 'text-center', right: 'text-right' } as const

export function Table<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  skeletonRows = 5,
  empty,
  onRowClick,
  className,
  caption,
}: TableProps<T>) {
  if (loading) {
    return (
      <div className={cn('overflow-hidden rounded-xl border', className)}>
        {caption ? <div className="sr-only">{caption}</div> : null}
        <div className="flex gap-4 border-b bg-raised px-4 py-3">
          {columns.map((column) => (
            <Skeleton key={column.key} className="h-3.5 flex-1" />
          ))}
        </div>
        {Array.from({ length: skeletonRows }).map((_, rowIndex) => (
          <div key={rowIndex} className="flex gap-4 border-b px-4 py-4 last:border-b-0">
            {columns.map((column, colIndex) => (
              <Skeleton key={column.key} className={cn('h-3.5 flex-1', colIndex === 0 && 'max-w-[38%]')} />
            ))}
          </div>
        ))}
      </div>
    )
  }

  if (rows.length === 0 && empty) {
    return <div className={className}>{empty}</div>
  }

  return (
    <div className={cn('overflow-x-auto rounded-xl border', className)}>
      <table className="w-full border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b bg-raised/60">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-faint',
                  ALIGN_CLASSES[column.align ?? 'left'],
                  column.headerClassName,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onRowClick(row)
                      }
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
              aria-label={onRowClick ? 'Open row' : undefined}
              className={cn(
                'border-b last:border-b-0',
                onRowClick && 'cursor-pointer transition-colors hover:bg-raised/50 focus:bg-raised/50',
              )}
            >
              {columns.map((column) => (
                <td key={column.key} className={cn('px-4 py-3.5 align-middle', ALIGN_CLASSES[column.align ?? 'left'], column.className)}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export interface PaginationProps {
  page: number
  totalPages: number
  total?: number
  onPageChange: (page: number) => void
  className?: string
}

export function Pagination({ page, totalPages, total, onPageChange, className }: PaginationProps) {
  if (totalPages <= 1) return null
  return (
    <nav aria-label="Pagination" className={cn('flex items-center justify-between gap-4 pt-4', className)}>
      <p className="text-sm text-muted">
        Page {page} of {totalPages}
        {total != null ? ` · ${pluralize(total, 'item')}` : ''}
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          icon={<ChevronLeft size={14} />}
          aria-label="Previous page"
        >
          Prev
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          iconRight={<ChevronRight size={14} />}
          aria-label="Next page"
        >
          Next
        </Button>
      </div>
    </nav>
  )
}
