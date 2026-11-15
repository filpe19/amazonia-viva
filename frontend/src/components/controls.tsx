import { t, useLocale } from '../lib/i18n'
import { useRegions } from '../lib/hooks'
import { useRegion } from '../lib/region-context'

export interface SegOption<T extends string> { value: T; label: string; title?: string }

export function Segmented<T extends string>({ label, options, value, onChange, size = 'md' }: {
  label: string
  options: SegOption<T>[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  useLocale()
  return (
    <div role="radiogroup" aria-label={t(label)} className="control inline-flex bg-lichen p-0.5 ring-1 ring-rule">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onKeyDown={(e) => {
              const index = options.findIndex(option => option.value === value)
              const next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : ['ArrowRight','ArrowDown'].includes(e.key) ? (index + 1) % options.length : ['ArrowLeft','ArrowUp'].includes(e.key) ? (index - 1 + options.length) % options.length : null
              if (next == null) return
              e.preventDefault(); onChange(options[next].value)
              const buttons = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=radio]')
              buttons?.[next]?.focus()
            }}
            title={o.title ? t(o.title) : undefined}
            onClick={() => onChange(o.value)}
            className={`control whitespace-nowrap ${size === 'sm' ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-[13px]'} font-medium transition-colors ${
              active ? 'bg-surface text-ink shadow-sm ring-1 ring-rule' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {t(o.label)}
          </button>
        )
      })}
    </div>
  )
}

export function RegionSelect({ compact = false, onSelect }: { compact?: boolean; onSelect?: (id: string) => void }) {
  useLocale()
  const { region, setRegion } = useRegion()
  const { data } = useRegions()
  const regions = data?.regions ?? []
  const featured = regions.filter((r) => r.featured || r.pilot).sort((a, b) => Number(b.pilot) - Number(a.pilot) || a.name.localeCompare(b.name, 'pt-BR'))
  const upper = regions.filter((r) => r.level !== 'municipio')
  const municipios = regions.filter((r) => r.level === 'municipio').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  return (
    <label className="flex min-w-0 flex-col gap-1">
      {!compact && <span className="type-label text-xs text-ink-2">{t("Territory")}</span>}
      <select
        value={region}
        onChange={(e) => { setRegion(e.target.value); onSelect?.(e.target.value) }}
        className="control w-full bg-surface px-2.5 py-2 text-sm font-medium text-ink ring-1 ring-rule focus:outline-none focus-visible:ring-2 focus-visible:ring-river"
        aria-label={t("Selected territory")}
      >
        {regions.length === 0 && <option value={region}>{region}</option>}
        {featured.length > 0 && (
          <optgroup label={t("Pilot and featured territories")}>
            {featured.map((r) => <option key={`f-${r.id}`} value={r.id}>{r.name}{r.pilot ? t("— pilot") : ''}</option>)}
          </optgroup>
        )}
        {upper.length > 0 && (
          <optgroup label={t("Country and state")}>
            {upper.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </optgroup>
        )}
        {municipios.length > 0 && (
          <optgroup label={t("Pará municipalities ({0})", {"0": municipios.length})}>
            {municipios.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </optgroup>
        )}
      </select>
    </label>
  )
}

export function Toggle({ checked, onChange, label, swatch, disabled, hint }: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  swatch?: string
  disabled?: boolean
  hint?: string
}) {
  useLocale()
  return (
    <label className={`flex cursor-pointer items-center gap-2.5 py-1 text-[13px] ${disabled ? 'cursor-not-allowed opacity-50' : ''}`} title={hint}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-canopy-700"
      />
      {swatch && <span className="inline-block size-2.5 rounded-full ring-2 ring-white" style={{ background: swatch }} aria-hidden="true" />}
      <span className="text-ink">{t(label)}</span>
    </label>
  )
}
