import { describe, expect, it } from 'vitest'
import { ageClass, CLUSTER_PROPERTIES, prepareDetections, productsFor, SATELLITES } from './symbology'
import type { DetectionsFC } from '../../lib/types'

const fc: DetectionsFC = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-55, -2.5] }, properties: { id: 'a', p: 'VIIRS_NOAA20_NRT', s: 'NOAA-20', t: '2026-11-15T02:00Z', frp: 3, c: 'nominal', dn: 'N' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-55.1, -2.6] }, properties: { id: 'b', p: 'MODIS_NRT', s: 'Terra', t: '2026-11-14T14:00Z', frp: 9, c: 60, dn: 'D' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-55.2, -2.7] }, properties: { id: 'c', p: 'MODIS_NRT', s: 'Aqua', t: '2026-11-12T17:00Z', frp: 12, c: 80, dn: 'D' } },
  ],
} as unknown as DetectionsFC

describe('detection symbology', () => {
  it('labels MODIS as 1 km and VIIRS as 375 m, with distinct shapes for Terra and Aqua', () => {
    const by = Object.fromEntries(SATELLITES.map((s) => [s.key, s]))
    expect(by['NOAA-20'].resolution).toBe('375 m')
    expect(by['NOAA-21'].resolution).toBe('375 m')
    expect(by.Aqua.resolution).toBe('1 km')
    expect(by.Terra.resolution).toBe('1 km')
    expect(by.Aqua.shape).not.toBe(by.Terra.shape)
    expect(new Set(SATELLITES.map((s) => s.color)).size).toBe(4)
  })
  it('requests only the FIRMS products needed for the satellites shown', () => {
    expect(productsFor(['NOAA-21'])).toEqual(['VIIRS_NOAA21_NRT'])
    expect(productsFor(['Terra', 'Aqua'])).toEqual(['MODIS_NRT'])
    expect(productsFor([])).toEqual([])
  })
  it('filters by satellite on the client without merging detections and adds an age class', () => {
    const now = Date.parse('2026-11-15T05:00:00Z')
    const out = prepareDetections(fc, ['NOAA-20', 'Aqua'], now)!
    expect(out.features.map((f) => f.properties.id)).toEqual(['a', 'c'])
    expect(out.features.map((f) => f.properties.age)).toEqual(['recent', 'older'])
    expect(ageClass('2026-11-14T14:00Z', now)).toBe('day')
    expect(prepareDetections(fc, [], now)!.features).toHaveLength(0)
  })
  it('counts each satellite separately inside a cluster', () => {
    expect(Object.keys(CLUSTER_PROPERTIES).sort()).toEqual(['n_Aqua', 'n_NOAA20', 'n_NOAA21', 'n_Terra'])
  })
})
