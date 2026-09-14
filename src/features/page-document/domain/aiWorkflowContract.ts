// 本模块声明独立 DeepSeek 提供方的公开状态与通用用量；文档对话 DTO 由 aiChatContract 单独承载。
import type {ContractParseResult, ContractValidationIssue} from './validators.ts'

export const DEEPSEEK_PROVIDER = 'deepseek' as const
export const DEEPSEEK_API_FORMAT = 'openai-responses' as const
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash'
export const ENTRY_AI_PROMPT_MAX_CHARS = 8_000

export type DeepSeekReasoningEffort = 'low' | 'high' | 'max'

export interface DeepSeekProviderStatus {
    provider: typeof DEEPSEEK_PROVIDER
    apiFormat: typeof DEEPSEEK_API_FORMAT
    configured: boolean
    model: string
    reasoningEffort: DeepSeekReasoningEffort
}

export interface EntryAiUsage {
    inputTokens: number
    outputTokens: number
    totalTokens: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function issue(path: string, code: string, message: string): ContractValidationIssue {
    return {path, code, message}
}

function failed<T>(issues: ContractValidationIssue[]): ContractParseResult<T> {
    return {ok: false, value: null, issues}
}

function exactKeys(
    value: Record<string, unknown>,
    allowed: readonly string[],
    path: string,
): ContractValidationIssue[] {
    const allowedKeys = new Set(allowed)
    return Object.keys(value)
        .filter(key => !allowedKeys.has(key))
        .map(key => issue(`${path}.${key}`, 'unknown_field', '字段未在当前契约中声明。'))
}

function providerFields(value: Record<string, unknown>, path: string): ContractValidationIssue[] {
    const issues: ContractValidationIssue[] = []
    if (value.provider !== DEEPSEEK_PROVIDER) {
        issues.push(issue(`${path}.provider`, 'invalid_provider', 'AI 提供方必须是 DeepSeek。'))
    }
    if (value.apiFormat !== DEEPSEEK_API_FORMAT) {
        issues.push(
            issue(
                `${path}.apiFormat`,
                'invalid_api_format',
                'DeepSeek 必须使用 OpenAI Responses 兼容格式。',
            ),
        )
    }
    if (typeof value.model !== 'string' || value.model.length === 0) {
        issues.push(issue(`${path}.model`, 'invalid_model', '模型名称必须是非空字符串。'))
    }
    return issues
}

export function parseDeepSeekProviderStatus(
    value: unknown,
): ContractParseResult<DeepSeekProviderStatus> {
    if (!isRecord(value)) {
        return failed([issue('provider', 'invalid_provider_status', '提供方状态必须是对象。')])
    }
    const issues = [
        ...exactKeys(
            value,
            ['provider', 'apiFormat', 'configured', 'model', 'reasoningEffort'],
            'provider',
        ),
        ...providerFields(value, 'provider'),
    ]
    if (typeof value.configured !== 'boolean') {
        issues.push(issue('provider.configured', 'invalid_boolean', 'configured 必须是布尔值。'))
    }
    if (!['low', 'high', 'max'].includes(String(value.reasoningEffort))) {
        issues.push(
            issue(
                'provider.reasoningEffort',
                'invalid_reasoning_effort',
                'reasoningEffort 不受支持。',
            ),
        )
    }
    return issues.length > 0
        ? failed(issues)
        : {ok: true, value: value as unknown as DeepSeekProviderStatus, issues: []}
}
