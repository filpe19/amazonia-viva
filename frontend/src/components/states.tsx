import { t, useLocale } from '../lib/i18n'
import { sourceCopy } from '../lib/sourceCopy'
import { AlertTriangle, CloudOff, Database, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { ApiError } from '../lib/api'

export function Skeleton({ className = '' }: { className?: string }) {
  useLocale()
  return <div className={`skeleton ${className}`} aria-hidden="true" />
}

export function Loading({ label = t("Loading observations…"), className = '' }: { label?: string; className?: string }) {
  useLocale()
  return (
    <div className={`flex items-center gap-2 text-sm text-ink-3 ${className}`} role="status" aria-live="polite">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      <span>{t(label)}</span>
    </div>
  )
}

function errorCopy(err: unknown): { title: string; body: string; hint?: string } {
  if (err instanceof ApiError) {
    if (err.code === 'network_error') return { title: t("Data service unavailable"), body: err.message, hint: t("Check the connection and retry.") }
    if (err.code === 'data_unavailable') {
      return { title: t("Historical data unavailable"), body: err.message, hint: t("Choose another satellite or period. The requested archive may not yet be available.") }
    }
    if (err.code === 'source_not_configured') return { title: t("Source configuration required"), body: err.message, hint: t("This source is not configured. Other public data may still be available.") }
    if (err.code === 'upstream_unavailable' || err.code === 'upstream_error')
      return { title: t("{0} did not respond", {"0": err.source ?? "External source"}), body: err.message, hint: t("Retry the query. The source may be temporarily unavailable.") }
    return { title: t("Could not load data"), body: err.message }
  }
  return { title: t("Could not load data"), body: (err as Error)?.message ?? 'Unknown error' }
}

export function ErrorState({ error, compact = false, onRetry }: { error: unknown; compact?: boolean; onRetry?: () => void }) {
  useLocale()
  const c = errorCopy(error)
  const unavailable = error instanceof ApiError && error.code === 'data_unavailable'
  const Icon = unavailable ? Database : error instanceof ApiError && error.code === 'network_error' ? CloudOff : AlertTriangle
  return (
    <div
      role="alert"
      className={`flex gap-3 rounded-[var(--radius-control)] ${unavailable ? 'bg-lichen text-ink-2' : 'bg-alert-soft text-ink'} ${compact ? 'p-2.5 text-xs' : 'p-3.5 text-sm'}`}
    >
      <Icon className={`mt-0.5 shrink-0 ${compact ? 'size-3.5' : 'size-4'} ${unavailable ? 'text-ink-3' : 'text-alert'}`} aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className="font-semibold">{t(c.title)}</p>
        <p className="text-ink-2">{sourceCopy(c.body)}</p>
        {c.hint && <p className="text-ink-3 break-words">{c.hint}</p>}
        {onRetry && (
          <button type="button" onClick={onRetry} className="control mt-1 bg-surface px-2 py-1 text-xs font-medium text-ink ring-1 ring-rule hover:bg-lichen">
            {t("Try again")}
          </button>
        )}
      </div>
    </div>
  )
}

export function Unavailable({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  useLocale()
  return (
    <div className="flex gap-3 rounded-[var(--radius-control)] border border-dashed border-rule bg-lichen/60 p-3.5 text-sm text-ink-2">
      <span className="mt-0.5 shrink-0 text-ink-3" aria-hidden="true">{icon ?? <Database className="size-4" />}</span>
      <div className="space-y-1">
        <p className="font-semibold text-ink">{t(title)}</p>
        {children}
      </div>
    </div>
  )
}
