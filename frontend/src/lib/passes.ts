// Agrupa detecções em "passagens": observações consecutivas do mesmo produto
// separadas por no máximo `gapMin` minutos (um sobrevoo de satélite polar sobre
// a região dura poucos minutos; passagens sucessivas distam ~100 min).

export interface Pass {
  product: string
  start: number // epoch ms
  end: number
  count: number
}

export interface DetectionLike {
  properties: { p: string; t: string }
}

export function parseFirmsTime(t: string): number {
  // "2026-11-14T18:32Z" -> epoch ms
  return Date.parse(t.length === 17 ? t.replace('Z', ':00Z') : t)
}

export function computePasses(features: DetectionLike[], gapMin = 20): Pass[] {
  const byProduct = new Map<string, number[]>()
  for (const f of features) {
    const ms = parseFirmsTime(f.properties.t)
    if (Number.isNaN(ms)) continue
    const arr = byProduct.get(f.properties.p) ?? []
    arr.push(ms)
    byProduct.set(f.properties.p, arr)
  }
  const passes: Pass[] = []
  const gap = gapMin * 60_000
  for (const [product, times] of byProduct) {
    times.sort((a, b) => a - b)
    let cur: Pass | null = null
    for (const t of times) {
      if (cur && t - cur.end <= gap) {
        cur.end = t
        cur.count += 1
      } else {
        if (cur) passes.push(cur)
        cur = { product, start: t, end: t, count: 1 }
      }
    }
    if (cur) passes.push(cur)
  }
  return passes.sort((a, b) => a.start - b.start)
}

export function latestPassByProduct(passes: Pass[]): Record<string, Pass> {
  const out: Record<string, Pass> = {}
  for (const p of passes) if (!out[p.product] || p.end > out[p.product].end) out[p.product] = p
  return out
}
