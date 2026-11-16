import { describe, expect, it } from 'vitest'
import { bulletin } from './IndigenousPanel'
import type { IndigenousItem, IndigenousReport } from '../../lib/types'

const item = {
  id: 'funai:1', code: 1, name: 'TI Teste', country: 'Brasil', peoples: ['Povo A'], phase: 'Regularizada', modality: null, area_ha: 10, ufs: ['PA'],
  municipalities: 'Santarém', border_zone: 'Não', funai_unit: { name: 'CR Teste', sigla: 'CR-T' }, source: 'FUNAI',
  population: { residents: 100, indigenous: 90, census_names: ['TI Teste - PA'], year: 2022, source: 'IBGE', note: '' },
  alert: 'inside_confirmed', recent_24h: true,
  inside: { count: 2, by_satellite: { 'NOAA-20': 1, 'NOAA-21': 1 }, last_utc: '2026-11-15T10:00:00Z', detections: [], overpasses: 2 },
  surroundings: { count: 0, by_satellite: {}, detections: [] }, satellites: ['NOAA-20', 'NOAA-21'], last_utc: '2026-11-15T10:00:00Z',
  bbox: [0, 0, 1, 1], detections_bbox: [0, 0, 1, 1], geometry: null,
  access: { nearest_federal_road: { name: 'BR-163', km: 12.3, note: '' } },
  evidence: { evaluated: true, mining: { available: true, detections_in_mining_areas: 1, detections_in_garimpo_areas: 1 } },
} as unknown as IndigenousItem
const report = { generated_at: '2026-11-15T12:00:00Z', public_channels: [{ name: 'Defesa Civil', contact: '199' }] } as unknown as IndigenousReport

describe('bulletin (boletim de alerta para TI)', () => {
  it('traz fatos por satélite, população do Censo, contexto de garimpo, canais e a ressalva de não oficial', () => {
    const b = bulletin(item, report)
    expect(b).toContain('TI Teste')
    expect(b).toContain('NOAA-20 1, NOAA-21 1')
    expect(b).toMatch(/90/)
    expect(b).toMatch(/garimpo/)
    expect(b).toContain('Defesa Civil 199')
    expect(b).toMatch(/not an official alert/)
    expect(b).not.toMatch(/victim|vítima|risk score/i)
  })
})
