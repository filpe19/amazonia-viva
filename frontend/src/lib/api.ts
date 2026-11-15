import type { ApiErrorBody } from './types'

export class ApiError extends Error {
  status: number
  code: string
  detail?: unknown
  source?: string | null

  constructor(status: number, code: string, message: string, detail?: unknown, source?: string | null) {
    super(message)
    this.status = status
    this.code = code
    this.detail = detail
    this.source = source
  }
}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1'

export function apiUrl(path: string, params?: Record<string, string | number | boolean | null | undefined>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  }
  const q = qs.toString()
  return `${BASE}${path}${q ? `?${q}` : ''}`
}

export async function getJson<T>(path: string, params?: Record<string, string | number | boolean | null | undefined>, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(apiUrl(path, params), { signal, headers: { Accept: 'application/json' } })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'network_error', "The data service could not be reached. Check the connection and retry.")
  }
  if (!res.ok) {
    let body: ApiErrorBody | null = null
    try {
      body = (await res.json()) as ApiErrorBody
    } catch {
      /* corpo não-JSON */
    }
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'http_error',
      body?.error?.message ?? `The API returned HTTP ${res.status}`,
      body?.error?.detail,
      body?.error?.source,
    )
  }
  return (await res.json()) as T
}
