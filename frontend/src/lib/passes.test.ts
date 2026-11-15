// Testes com dados SINTÉTICOS (fixtures construídas aqui; não são observações reais).
import { describe, expect, it } from 'vitest'
import { computePasses, latestPassByProduct, parseFirmsTime } from './passes'

const f = (p: string, t: string) => ({ properties: { p, t } })

describe('computePasses', () => {
  it('agrupa detecções próximas no tempo em uma passagem por produto', () => {
    const passes = computePasses([
      f('A', '2026-01-01T04:00Z'),
      f('A', '2026-01-01T04:02Z'),
      f('A', '2026-01-01T04:05Z'),
      f('A', '2026-01-01T05:45Z'), // nova passagem (>20 min)
      f('B', '2026-01-01T04:01Z'),
    ])
    expect(passes).toHaveLength(3)
    const a = passes.filter((p) => p.product === 'A')
    expect(a.map((p) => p.count)).toEqual([3, 1])
    expect(a[0].end - a[0].start).toBe(5 * 60_000)
  })

  it('ignora horários inválidos e lida com lista vazia', () => {
    expect(computePasses([])).toEqual([])
    expect(computePasses([f('A', 'inválido')])).toEqual([])
  })

  it('retorna a passagem mais recente de cada produto', () => {
    const latest = latestPassByProduct(
      computePasses([f('A', '2026-01-01T01:00Z'), f('A', '2026-01-01T09:00Z'), f('B', '2026-01-01T03:00Z')]),
    )
    expect(new Date(latest.A.end).toISOString()).toBe('2026-01-01T09:00:00.000Z')
    expect(latest.B.count).toBe(1)
  })

  it('interpreta o formato compacto de horário da API', () => {
    expect(parseFirmsTime('2026-11-14T18:32Z')).toBe(Date.UTC(2026, 10, 14, 18, 32))
  })
})
