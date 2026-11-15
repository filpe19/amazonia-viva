// Formatação: horários sempre explícitos em UTC (e local quando útil), números pt-BR.

const nf0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2, minimumFractionDigits: 2 })

export const fmtInt = (n: number | null | undefined) => (n == null ? '—' : nf0.format(n))
export const fmt1 = (n: number | null | undefined) => (n == null ? '—' : nf1.format(n))
/** Até uma casa decimal, sem zeros à direita (40,5; 41). */
const nfUp1 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })
export const fmtNum = (n: number | null | undefined) => (n == null ? '—' : nfUp1.format(n))
export const fmt2 = (n: number | null | undefined) => (n == null ? '—' : nf2.format(n))

const pad = (n: number) => String(n).padStart(2, '0')

/** "14/11/2026 18:32 UTC" */
export function fmtUtc(iso: string | null | undefined, withYear = true): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const date = `${pad(d.getUTCDate())} ${MONTHS_PT[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ''}`
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}

/** Horário local de Brasília (UTC−3, sem horário de verão desde 2019). */
export function fmtBrt(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000)
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} (Brasília, UTC−3)`
}

/** "há 3 h 12 min" */
export function fmtAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—'
  const ms = now.getTime() - new Date(iso).getTime()
  if (ms < 0) return "current"
  const min = Math.floor(ms / 60_000)
  if (min < 1) return "less than 1 min ago"
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h < 48) return m ? `${h} h ${m} min ago` : `${h} h ago`
  return `${Math.floor(h / 24)} days ago`
}

/** "2026-11-08" -> "08/11/2026" */
export function fmtDate(isoDate: string | null | undefined, withYear = true): string {
  if (!isoDate) return '—'
  const [y, m, d] = isoDate.slice(0, 10).split('-')
  return withYear ? `${d} ${MONTHS_PT[Number(m)-1]} ${y}` : `${d} ${MONTHS_PT[Number(m)-1]}`
}

export const MONTHS_PT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTHS_PT_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function fmtYearMonth(ym: string): string {
  const [y, m] = ym.split('-')
  return `${MONTHS_PT[Number(m) - 1]}/${y.slice(2)}`
}

export function fmtCoord(lat: number, lon: number): string {
  const ns = lat < 0 ? 'S' : 'N'
  const ew = lon < 0 ? 'W' : 'E'
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`
}

export function shortHash(h: string | null | undefined, n = 12): string {
  return h ? `${h.slice(0, n)}…` : '—'
}
