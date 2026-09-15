/**
 * Tauri command 边界统一错误结构。
 *
 * 后端 Result<T, ApiError> 在前端 invoke 拒绝时返回该形状的 JSON 对象。
 * 字段语义与 core_ai_client::ClientError 完全对齐：
 * - code   稳定错误码（SCREAMING_SNAKE_CASE，可用于 i18n 与分支处理）
 * - message 默认中文展示文案
 * - detail 附加结构化字段（plugin_id / session_id / status_code / url 等）
 */
export interface ApiError {
    code: string
    message: string
    detail?: Record<string, unknown>
}

/** 常用错误码常量，避免拼写错误。完整清单见 core_ai_client/src/error.rs */
export const ErrorCode = {
    CoreClientInternalError: 'CORE_CLIENT_INTERNAL_ERROR',
    CoreClientCancelled: 'CORE_CLIENT_CANCELLED',
    AuthApiKeyMissing: 'AUTH_API_KEY_MISSING',
    AuthKeyInvalid: 'AUTH_KEY_INVALID',
    PluginNotFound: 'PLUGIN_NOT_FOUND',
    PluginNotLoaded: 'PLUGIN_NOT_LOADED',
    PluginLoadFailed: 'PLUGIN_LOAD_FAILED',
    PluginUnloadForbidden: 'PLUGIN_UNLOAD_FORBIDDEN',
    PluginAlreadyExists: 'PLUGIN_ALREADY_EXISTS',
    PluginKindMismatch: 'PLUGIN_KIND_MISMATCH',
    PluginVersionMismatch: 'PLUGIN_VERSION_MISMATCH',
    PluginManifestInvalid: 'PLUGIN_MANIFEST_INVALID',
    PluginRuntimeError: 'PLUGIN_RUNTIME_ERROR',
    LlmSessionCreateFailed: 'LLM_SESSION_CREATE_FAILED',
    LlmSessionNotFound: 'LLM_SESSION_NOT_FOUND',
    LlmSessionClosed: 'LLM_SESSION_CLOSED',
    LlmSessionBusy: 'LLM_SESSION_BUSY',
    LlmRequestTimeout: 'LLM_REQUEST_TIMEOUT',
    LlmRequestRateLimited: 'LLM_REQUEST_RATE_LIMITED',
    LlmRequestNetworkError: 'LLM_REQUEST_NETWORK_ERROR',
    LlmResponseBadStatus: 'LLM_RESPONSE_BAD_STATUS',
    LlmResponseParseError: 'LLM_RESPONSE_PARSE_ERROR',
    LlmResponseEmpty: 'LLM_RESPONSE_EMPTY',
    LlmStreamProtocolError: 'LLM_STREAM_PROTOCOL_ERROR',
    LlmToolCallFailed: 'LLM_TOOL_CALL_FAILED',
    LlmToolCallTimeout: 'LLM_TOOL_CALL_TIMEOUT',
    LlmToolCallInvalid: 'LLM_TOOL_CALL_INVALID',
    ContextBudgetExceeded: 'CONTEXT_BUDGET_EXCEEDED',
    HttpBadRequest: 'HTTP_BAD_REQUEST',
    HttpUnauthorized: 'HTTP_UNAUTHORIZED',
    HttpPaymentRequired: 'HTTP_PAYMENT_REQUIRED',
    HttpForbidden: 'HTTP_FORBIDDEN',
    HttpNotFound: 'HTTP_NOT_FOUND',
    HttpTooManyRequests: 'HTTP_TOO_MANY_REQUESTS',
    HttpServerError: 'HTTP_SERVER_ERROR',
    HttpTimeout: 'HTTP_TIMEOUT',
    ValidationMissingField: 'VALIDATION_MISSING_FIELD',
    ValidationFormatError: 'VALIDATION_FORMAT_ERROR',
    DocumentRevisionConflict: 'DOCUMENT_REVISION_CONFLICT',
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

/** 判定 value 是否符合 ApiError 结构。 */
export function isApiError(value: unknown): value is ApiError {
    if (!value || typeof value !== 'object') return false
    const v = value as Record<string, unknown>
    return typeof v.code === 'string' && typeof v.message === 'string'
}

/**
 * 把 invoke / await reject 抛出的任意值统一规范化为 ApiError。
 *
 * 兼容历史：旧的 Result<T, String> command 仍可能产生
 *   1. 形如 '{"code":"...","message":"..."}' 的 JSON 字符串（核心库 ClientError::Display）
 *   2. 普通字符串
 *   3. 已经是 ApiError 对象
 *   4. Error / 其它
 *
 * 始终返回结构化对象，message 至少非空。
 */
export function toApiError(value: unknown): ApiError {
    if (isApiError(value)) return value

    if (typeof value === 'string') {
        const trimmed = value.trim()
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
                const parsed = JSON.parse(trimmed)
                if (isApiError(parsed)) return parsed
            } catch {
                // 不是合法 JSON 就退回到原文
            }
        }
        return { code: ErrorCode.CoreClientInternalError, message: trimmed || '未知错误' }
    }

    if (value instanceof Error) {
        return { code: ErrorCode.CoreClientInternalError, message: value.message || value.name }
    }

    if (value && typeof value === 'object') {
        const message = (value as Record<string, unknown>).message
        if (typeof message === 'string' && message.trim()) {
            return { code: ErrorCode.CoreClientInternalError, message: message.trim() }
        }

        try {
            const serialized = JSON.stringify(value)
            if (serialized && serialized !== '{}') {
                return { code: ErrorCode.CoreClientInternalError, message: serialized }
            }
        } catch {
            // 循环引用等对象无法序列化时，统一回退为可读文案。
        }
        return { code: ErrorCode.CoreClientInternalError, message: '未知错误' }
    }

    const message = String(value).trim()
    return { code: ErrorCode.CoreClientInternalError, message: message || '未知错误' }
}

/** 取 message，用于直接展示；错误码仅留给调用方日志。 */
export function formatApiError(err: ApiError): string {
    return err.message
}
