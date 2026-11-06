export interface Question { key: string; prompt: string; kind: 'category' | 'text'; section: string; required: boolean; required_when?: { question: string; value: string }; max_length?: number; options: { value: string; label: string; example?: string }[] }
export interface Questionnaire { version: string; title: string; options_basis: string; estimated_minutes?: [number, number]; questions: Question[] }
export interface Participation { accepted: boolean; questionnaire_version?: string; saved: boolean }
export type DataStatus = 'ready' | 'insufficient' | 'unavailable'
export interface ChartDatum { label: string; category?: string; count: number; percentage: number; row_denominator?: number }
export interface ChartData {
  key: string; title: string; status: DataStatus; denominator: number | null; missing: number | null;
  pooled: boolean; message: string | null; kind?: 'distribution' | 'matrix' | 'rates'; definition?: string;
  coverage_percentage?: number | null; filterable?: boolean; rows?: string[]; columns?: string[]; grouping_note?: string | null;
  required_variables?: string[]; variable_types?: Record<string, string>; indicator?: string;
  introduced_in?: string;
  ordered_categories?: string[]; category_catalog?: Record<string, string[]>; reference?: ChartDatum | null; data: ChartDatum[];
  grouping_rules?: Record<string, Record<string, string[]>>;
}
export interface OverviewData {
  status: 'ready' | 'empty' | 'insufficient'; data_mode: 'real' | 'demo'; minimum_group_size: number;
  data_notice?: string;
  eligible_responses: number | null; universities: number | null; message?: string;
  filters: { university: string[]; semester: string[] }; selected: { university: string | null; semester: string | null };
  charts: ChartData[]; method: string; filter_note?: string; composition?: ChartData;
}
export interface IndicatorData { key: string; title: string; type: 'derived'; rule: string; status: DataStatus; count: number | null; denominator: number | null; percentage: number | null; message: string }
export interface QualityData { key: string; title: string; kind: string; status: DataStatus; valid: number | null; missing: number | null; coverage_percentage: number | null; message: string | null; introduced_in?: string }
export interface AnalyticsData extends OverviewData {
  module: string; indicators: IndicatorData[]; quality: QualityData[];
  mobility?: { status: DataStatus; charts: ChartData[]; comparisons: ChartData[]; message: string; flow?: ChartData };
  versions: { version: string; active: boolean; options_complete: boolean; options_basis?: string }[];
  sources?: string[]; received_responses?: number | null; received_message?: string;
  institutions?: { status: DataStatus; message: string } | null;
  institutional_points?: ChartData;
}

export class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try { response = await fetch(`/api${path}`, { ...init, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...init?.headers } }) }
  catch { throw new ApiError(0, 'No pudimos conectar con SAVRA. Revisa tu conexión e inténtalo de nuevo.') }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail = typeof body?.detail === 'string' ? body.detail : response.status === 429 ? 'Espera un momento antes de volver a intentarlo.' : 'No pudimos completar la solicitud. Inténtalo de nuevo.'
    throw new ApiError(response.status, detail)
  }
  return response.json()
}
export function post<T>(path: string, body: unknown) { return api<T>(path, { method: 'POST', body: JSON.stringify(body) }) }
export const SIMULATION_NOTICE = 'DATOS SIMULADOS — DEMOSTRACIÓN TÉCNICA'
