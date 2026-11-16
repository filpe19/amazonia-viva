import { describe, expect, it } from 'vitest'
import { filterSignal } from './AttentionTab'
import { parseIdentify } from './imagery'
import { pixelFootprints } from '../map/DetectionMap'
import type { AttentionSignal, DetectionsFC } from '../../lib/types'

const signal = (by: Record<string, number>): AttentionSignal => ({
  id: 'x', group: 'protected', category: 'indigenous', relation: 'inside', criterion: 'inside_territory',
  target: { id: 't', name: 'TI', layer_id: 'terras_indigenas', source: 'FUNAI' }, by_satellite: by, first_utc: null, last_utc: null,
  recent_6h: 0, max_frp_mw: null, detections: Object.entries(by).flatMap(([s, n]) => Array.from({ length: n }, (_, i) => ({ p: 'P', id: `${s}${i}`, s, t: '2026-11-15T10:00Z', lon: 0, lat: 0 }))),
  detections_truncated: false, bbox: null, region_ids: [],
})

describe('filterSignal', () => {
  it('recorta contagens e detecções aos satélites visíveis, sem somar sensores', () => {
    const f = filterSignal(signal({ 'NOAA-20': 2, Aqua: 1 }), ['NOAA-20'])
    expect(f?.by_satellite).toEqual({ 'NOAA-20': 2 })
    expect(f?.detections.every((d) => d.s === 'NOAA-20')).toBe(true)
  })
  it('descarta o sinal quando nenhum satélite dele está visível', () => {
    expect(filterSignal(signal({ Aqua: 1 }), ['NOAA-20', 'NOAA-21'])).toBeNull()
  })
})

describe('parseIdentify (metadados Esri World Imagery)', () => {
  it('escolhe a cena de melhor resolução com data', () => {
    const info = parseIdentify({ results: [
      { layerName: '75m Resolution Metadata', attributes: { SRC_DATE: 'Null', SRC_RES: '15' } },
      { layerName: '1.2m Resolution Metadata', attributes: { SRC_DATE: '20251023', SRC_RES: '0.34', NICE_DESC: 'Vantor', SRC_DESC: 'LG03' } },
    ] })
    expect(info).toEqual({ state: 'ready', date: '2025-10-23', resolution_m: 0.34, provider: 'Vantor', sensor: 'LG03' })
  })
  it('sem cena datada indica mosaico de baixa resolução, nunca uma data inventada', () => {
    expect(parseIdentify({ results: [{ layerName: '75m Resolution Metadata', attributes: { SRC_DATE: 'Null', SRC_RES: '15' } }] })).toEqual({ state: 'lowres' })
  })
})

describe('pixelFootprints', () => {
  it('desenha scan × track em km centrado na detecção e ignora registros sem dimensões', () => {
    const fc = { type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-54.9, 0] }, properties: { id: 'a', p: 'P', s: 'NOAA-20', t: '', frp: null, c: null, dn: 'D', sc: 0.4, tr: 0.5 } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-54.9, 0] }, properties: { id: 'b', p: 'P', s: 'Aqua', t: '', frp: null, c: null, dn: 'D' } },
    ], metadata: {} } as unknown as DetectionsFC
    const out = pixelFootprints(fc)
    expect(out.features).toHaveLength(1)
    const ring = (out.features[0].geometry as GeoJSON.Polygon).coordinates[0]
    const widthKm = (ring[1][0] - ring[0][0]) * 111.32
    const heightKm = (ring[2][1] - ring[1][1]) * 110.574
    expect(widthKm).toBeCloseTo(0.4, 3)
    expect(heightKm).toBeCloseTo(0.5, 3)
  })
})
