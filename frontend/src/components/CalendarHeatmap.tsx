import { t, useLocale } from '../lib/i18n'
import { useMemo, useState } from 'react'
import { monthNames, fmtDate, fmtInt } from '../lib/format'
import type { CalendarHistory } from '../lib/types'

// Rampa sequencial de um só tom (ocre), clara -> escura. Zero = cinza neutro (sem detecção).
const RAMP = ['#f6e6c6', '#ecc98a', '#dca552', '#c27c0e', '#955d08', '#633c03']
const ZERO = '#e6ebe5'

export function CalendarHeatmap({ data, color = '#c27c0e' }: { data: CalendarHistory; color?: string }) {
  useLocale()
  const [hover, setHover] = useState<{ date: string; n: number; x: number; y: number } | null>(null)
  const cell = 13
  const gap = 2
  const { weeks, monthStarts } = useMemo(() => {
    const first = new Date(`${data.year}-01-01T00:00:00Z`)
    const offset = first.getUTCDay() // 0 = domingo
    const weeks: { date: string; n: number; dow: number; week: number }[] = []
    const monthStarts: { m: number; week: number }[] = []
    data.days.forEach((d, i) => {
      const idx = i + offset
      const week = Math.floor(idx / 7)
      const dow = idx % 7
      if (d.date.endsWith('-01')) monthStarts.push({ m: Number(d.date.slice(5, 7)) - 1, week })
      weeks.push({ ...d, dow, week })
    })
    return { weeks, monthStarts }
  }, [data])

  const max = Math.max(1, data.max)
  const colorFor = (n: number) => {
    if (n <= 0) return ZERO
    const t = Math.sqrt(n / max)
    return RAMP[Math.min(RAMP.length - 1, Math.floor(t * RAMP.length))]
  }
  const nWeeks = (weeks.at(-1)?.week ?? 52) + 1
  const W = 28 + nWeeks * (cell + gap)
  const H = 18 + 7 * (cell + gap)

  return (
    <div className="relative overflow-x-auto">
      <svg width={W} height={H} role="img" aria-label={t("Detection calendar {0}: total {1}", {"0": data.year, "1": data.total})} style={{ ['--c' as string]: color }}>
        {monthStarts.map(({ m, week }) => (
          <text key={m} x={28 + week * (cell + gap)} y={11} fontSize={10.5} fill="#6b7a72">{monthNames()[m]}</text>
        ))}
        {[t("Sun"), t("Mon"), t("Tue"), t("Wed"), t("Thu"), t("Fri"), t("Sat")].map((l, i) => (i % 2 === 1 ? (
          <text key={i} x={0} y={18 + i * (cell + gap) + cell - 2} fontSize={10} fill="#6b7a72">{l}</text>
        ) : null))}
        {weeks.map((d) => (
          <rect key={d.date} x={28 + d.week * (cell + gap)} y={18 + d.dow * (cell + gap)} width={cell} height={cell} rx={2.5}
            fill={colorFor(d.n)}
            stroke={hover?.date === d.date ? '#14231d' : 'none'} strokeWidth={1.5}
            onMouseEnter={() => setHover({ date: d.date, n: d.n, x: 28 + d.week * (cell + gap), y: 18 + d.dow * (cell + gap) })}
            onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-ink px-2 py-1 text-xs text-white shadow"
          style={{ left: hover.x + cell / 2, top: hover.y - 4 }}>
          <span className="num">{fmtDate(hover.date)}: {fmtInt(hover.n)} {t("detections")}</span>
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-3">
        <span>{t("no detections")}</span>
        <span className="inline-block size-3 rounded-sm" style={{ background: ZERO }} />
        <span className="ml-2">{t("fewer")}</span>
        {RAMP.map((c) => <span key={c} className="inline-block size-3 rounded-sm" style={{ background: c }} />)}
        <span>{t("more (max.")} {fmtInt(data.max)}{t("/day)")}</span>
      </div>
    </div>
  )
}
