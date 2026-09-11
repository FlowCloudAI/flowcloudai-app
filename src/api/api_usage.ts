import {command} from './base'

export interface ApiUsageCost {
    currency: string
    amount: number
}

export interface ApiUsageRecordStats {
    request_count: number
    legacy_turn_count: number
    cached_prompt_tokens: number | null
    cache_usage_known_count: number
    cache_usage_unknown_count: number
    cache_creation_prompt_tokens: number | null
    cache_creation_usage_known_count: number
    cache_creation_usage_unknown_count: number
}

export interface ApiUsageSummary extends ApiUsageRecordStats {
    total_prompt_tokens: number
    total_completion_tokens: number
    total_tokens: number
    call_count: number
    costs: ApiUsageCost[]
    unknown_price_count: number
}

export interface ApiUsageByModel extends ApiUsageRecordStats {
    model: string
    provider: string
    modality: string
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    call_count: number
    costs: ApiUsageCost[]
    unknown_price_count: number
}

export interface ApiUsageDaily extends ApiUsageRecordStats {
    date: string
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    call_count: number
    costs: ApiUsageCost[]
    unknown_price_count: number
}

export const ai_get_usage_summary = () =>
    command<ApiUsageSummary>('ai_get_usage_summary')

export const ai_get_usage_by_model = () =>
    command<ApiUsageByModel[]>('ai_get_usage_by_model')

export const ai_get_usage_daily = () =>
    command<ApiUsageDaily[]>('ai_get_usage_daily')
