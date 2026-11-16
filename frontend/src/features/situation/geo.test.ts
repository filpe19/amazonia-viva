import { describe, expect, it } from 'vitest'
import { bearing, countByMunicipality, distanceToGeometryKm, haversineKm, interpretConfidence, parseCoordinate } from './geo'

const square = (w: number, s: number, e: number, n: number): GeoJSON.Polygon => ({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] })

describe('geographic helpers', () => {
  it('computes great-circle distance and compass direction', () => {
    expect(haversineKm(-54.7156, -2.4378, -54.7156, -2.4378)).toBe(0)
    expect(haversineKm(0, 0, 0, 1)).toBeCloseTo(111.2, 0)
    expect(bearing(0, 0, 0, 1).sector).toBe('N')
    expect(bearing(0, 0, 1, -1).sector).toBe('SE')
  })
  it('measures distance to a polygon boundary, zero when inside', () => {
    const g = square(-55, -3, -54, -2)
    expect(distanceToGeometryKm(-54.5, -2.5, g)).toBe(0)
    expect(distanceToGeometryKm(-53.9, -2.5, g)!).toBeCloseTo(11.1, 0)
    expect(distanceToGeometryKm(-53.9, -2.5, null)).toBeNull()
  })
  it('counts points per municipality without mixing ids', () => {
    const munis: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: square(-55, -3, -54, -2), properties: { id: 'a' } },
      { type: 'Feature', geometry: square(-54, -3, -53, -2), properties: { id: 'b' } },
    ] }
    expect(countByMunicipality([{ lon: -54.5, lat: -2.5 }, { lon: -53.5, lat: -2.5 }, { lon: -53.4, lat: -2.2 }, { lon: -50, lat: 0 }], munis)).toEqual({ a: 1, b: 2 })
  })
  it('interprets confidence by product', () => {
    expect(interpretConfidence('VIIRS', 'nominal', null).value).toBe('nominal')
    expect(interpretConfidence('MODIS', null, 72).meaning).toBe('MODIS nominal (30–79%)')
    expect(interpretConfidence('MODIS', null, 85).meaning).toBe('MODIS high (80–100%)')
    expect(interpretConfidence('MODIS', null, null).value).toBe('—')
  })
  it('parses typed coordinates as latitude, longitude', () => {
    expect(parseCoordinate('-2.4378, -54.7156')).toEqual([-54.7156, -2.4378])
    expect(parseCoordinate('-2,44; -54,71')).toEqual([-54.71, -2.44])
    expect(parseCoordinate('95, 10')).toBeNull()
    expect(parseCoordinate('Santarém')).toBeNull()
  })
})
