import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getJson } from './api'
import type {
  CalendarHistory, DayNight, DetectionRecord, DetectionsFC, EvidenceManifest, Health, HistoryStatus, MonthlyHistory,
  OverlapHistory, Region, SourcesInfo, WeatherContext, WindowLabel, BriefV2, Ficha, TerritoryContext, ImpactReport, CoverageReport, HarmonizationExperiment, HarmonizedSeries,
} from './types'

const MIN = 60_000

export function useHealth() {
  return useQuery({ queryKey: ['health'], queryFn: ({ signal }) => getJson<Health>('/health', undefined, signal), staleTime: MIN })
}

export function useRegions() {
  return useQuery({
    queryKey: ['regions'],
    queryFn: ({ signal }) => getJson<{ regions: Region[]; missing: string[] }>('/regions', undefined, signal),
    staleTime: 60 * MIN,
  })
}

export function useBoundary(region: string) {
  return useQuery({
    queryKey: ['boundary', region],
    queryFn: ({ signal }) => getJson<GeoJSON.FeatureCollection>(`/regions/${region}/boundary`, undefined, signal),
    staleTime: 60 * MIN,
  })
}

export function useSources() {
  return useQuery({ queryKey: ['sources'], queryFn: ({ signal }) => getJson<SourcesInfo>('/sources', undefined, signal), staleTime: 10 * MIN })
}

export interface DetectionParams { region: string; window: WindowLabel; products: string[]; daynight: DayNight }

export function useDetections(p: DetectionParams) {
  return useQuery({
    queryKey: ['detections', p.region, p.window, p.products.join(','), p.daynight],
    queryFn: ({ signal }) =>
      getJson<DetectionsFC>('/detections', { region: p.region, window: p.window, products: p.products.join(','), daynight: p.daynight }, signal),
    enabled: p.products.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5 * MIN,
    refetchInterval: 10 * MIN,
  })
}

export function useDetectionDetail(product: string | null, id: string | null) {
  return useQuery({
    queryKey: ['detection', product, id],
    queryFn: ({ signal }) => getJson<DetectionRecord>(`/detections/${product}/${id}`, undefined, signal),
    enabled: Boolean(product && id),
    staleTime: 30 * MIN,
  })
}

export function useWeather(params: { region?: string; lat?: number; lon?: number; days?: number }) {
  return useQuery({
    queryKey: ['weather', params.region, params.lat, params.lon, params.days],
    queryFn: ({ signal }) => getJson<WeatherContext>('/weather/context', params, signal),
    staleTime: 30 * MIN,
    placeholderData: keepPreviousData,
  })
}

export function useHistoryStatus() {
  return useQuery({ queryKey: ['history-status'], queryFn: ({ signal }) => getJson<HistoryStatus>('/history/status', undefined, signal), staleTime: 10 * MIN })
}

export function useMonthly(p: { region: string; product: string; satellites?: string; daynight?: string; vegetation_only?: boolean; enabled?: boolean }) {
  const { enabled = true, ...params } = p
  return useQuery({
    queryKey: ['monthly', params],
    queryFn: ({ signal }) => getJson<MonthlyHistory>('/history/monthly', params, signal),
    enabled,
    staleTime: 30 * MIN,
  })
}

export function useCalendar(p: { region: string; product: string; year: number | null }) {
  return useQuery({
    queryKey: ['calendar', p],
    queryFn: ({ signal }) => getJson<CalendarHistory>('/history/calendar', { region: p.region, product: p.product, year: p.year }, signal),
    enabled: p.year != null,
    staleTime: 30 * MIN,
  })
}

export function useOverlap(region: string, refSatellites: string, other = 'VIIRS_NOAA20_SP') {
  return useQuery({
    queryKey: ['overlap', region, refSatellites, other],
    queryFn: ({ signal }) => getJson<OverlapHistory>('/history/overlap', { region, ref_satellites: refSatellites, other }, signal),
    staleTime: 30 * MIN,
  })
}

export function useMunicipalities(parent = 'para') {
  return useQuery({
    queryKey: ['municipalities', parent],
    queryFn: ({ signal }) => getJson<GeoJSON.FeatureCollection>(`/regions/${parent}/municipalities`, undefined, signal),
    staleTime: 60 * MIN,
  })
}

export function useTerritoryContext(region: string) {
  return useQuery({
    queryKey: ['context', region],
    queryFn: ({ signal }) => getJson<TerritoryContext>(`/territory/${region}/context`, undefined, signal),
    staleTime: 10 * MIN,
  })
}

export function useFicha(region: string) {
  return useQuery({
    queryKey: ['ficha', region],
    queryFn: ({ signal }) => getJson<Ficha>(`/territory/${region}/ficha`, undefined, signal),
    staleTime: 5 * MIN,
  })
}

export function useTerritoryBrief(region: string) {
  return useQuery({
    queryKey: ['brief', region],
    queryFn: ({ signal }) => getJson<BriefV2>(`/territory/${region}/brief`, undefined, signal),
    staleTime: 5 * MIN,
  })
}

export function useEvidence(p: DetectionParams) {
  return useQuery({
    queryKey: ['evidence', p.region, p.window, p.products.join(','), p.daynight],
    queryFn: ({ signal }) =>
      getJson<EvidenceManifest>('/reports/evidence', { region: p.region, window: p.window, products: p.products.join(','), daynight: p.daynight }, signal),
    enabled: p.products.length > 0,
    staleTime: 5 * MIN,
    placeholderData: keepPreviousData,
  })
}

export function useImpact(region: string) {
  return useQuery({
    queryKey: ['impact', region],
    queryFn: ({ signal }) => getJson<ImpactReport>(`/territory/${region}/impact`, undefined, signal),
    staleTime: 10 * MIN,
  })
}

export function useCoverage(region: string) {
  return useQuery({
    queryKey: ['coverage', region],
    queryFn: ({ signal }) => getJson<CoverageReport>('/history/coverage', { region }, signal),
    staleTime: 30 * MIN,
  })
}

export function useHarmonizationExperiment(region: string, other: string, refSatellites = 'Aqua') {
  return useQuery({
    queryKey: ['harm-exp', region, other, refSatellites],
    queryFn: ({ signal }) => getJson<HarmonizationExperiment>('/history/harmonization-experiment', { region, other, ref_satellites: refSatellites }, signal),
    staleTime: 30 * MIN,
  })
}

export function useHarmonized(region: string) {
  return useQuery({
    queryKey: ['harmonized', region],
    queryFn: ({ signal }) => getJson<HarmonizedSeries>('/history/harmonized', { region }, signal),
    staleTime: 30 * MIN,
  })
}
