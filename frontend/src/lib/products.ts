// Identidade visual fixa por produto (a cor segue a entidade, nunca a ordem).
// Paleta validada com o validador de CVD/contraste: NOAA-20, NOAA-21, MODIS em todos os pares;
// S-NPP validado contra MODIS (os dois únicos que coexistem no histórico).

export interface ProductStyle {
  id: string
  label: string
  short: string
  sensor: 'VIIRS' | 'MODIS'
  color: string
  resolution: string
}

export const PRODUCT_STYLES: Record<string, ProductStyle> = {
  VIIRS_NOAA20_NRT: { id: 'VIIRS_NOAA20_NRT', label: 'NOAA-20 (VIIRS)', short: 'NOAA-20', sensor: 'VIIRS', color: '#c27c0e', resolution: '375 m' },
  VIIRS_NOAA21_NRT: { id: 'VIIRS_NOAA21_NRT', label: 'NOAA-21 (VIIRS)', short: 'NOAA-21', sensor: 'VIIRS', color: '#2a78d6', resolution: '375 m' },
  MODIS_NRT: { id: 'MODIS_NRT', label: 'MODIS (Terra & Aqua)', short: 'MODIS', sensor: 'MODIS', color: '#1a9e6e', resolution: '1 km' },
  VIIRS_SNPP_NRT: { id: 'VIIRS_SNPP_NRT', label: 'Suomi NPP (VIIRS)', short: 'S-NPP', sensor: 'VIIRS', color: '#6250d6', resolution: '375 m' },
  MODIS_SP: { id: 'MODIS_SP', label: 'MODIS (archive)', short: 'MODIS', sensor: 'MODIS', color: '#1a9e6e', resolution: '1 km' },
  VIIRS_SNPP_SP: { id: 'VIIRS_SNPP_SP', label: 'VIIRS S-NPP (archive)', short: 'S-NPP', sensor: 'VIIRS', color: '#6250d6', resolution: '375 m' },
  VIIRS_NOAA20_SP: { id: 'VIIRS_NOAA20_SP', label: 'VIIRS NOAA-20 (archive)', short: 'NOAA-20', sensor: 'VIIRS', color: '#c27c0e', resolution: '375 m' },
}

export const NRT_SELECTABLE = ['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'MODIS_NRT'] as const
export const DEFAULT_NRT = ['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT']

export function productStyle(id: string): ProductStyle {
  return PRODUCT_STYLES[id] ?? { id, label: id, short: id, sensor: 'VIIRS', color: '#6b7a72', resolution: '—' }
}

export const REGION_LABEL: Record<string, string> = { brasil: 'Brasil', para: 'Pará', santarem: 'Santarém (PA)' }
