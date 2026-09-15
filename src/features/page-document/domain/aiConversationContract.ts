// 本模块定义词条级 AI 会话记录契约；记录只保存可见消息和安全工具摘要，不复制文档源码。
import {
    ENTRY_AI_CHAT_MAX_MESSAGES,
    ENTRY_AI_CHAT_MAX_TOTAL_CHARS,
    parseEntryAiChatResult,
    type EntryAiChatMessage,
    type EntryAiChatResult,
} from './aiChatContract.ts'
import {ENTRY_AI_PROMPT_MAX_CHARS} from './aiWorkflowContract.ts'
import type {SourceFileSet} from './contract.ts'
import type {ContractParseResult, ContractValidationIssue} from './validators.ts'
import {RFC_9562_UUID_PATTERN} from './uuidPolicy.ts'

export const ENTRY_AI_CONVERSATION_MAX_COUNT = 100
export const ENTRY_AI_CONVERSATION_TITLE_MAX_CHARS = 80
export const ENTRY_AI_CONVERSATION_PREVIEW_MAX_CHARS = 120

export type EntryAiConversationTurnResult = Pick<
    EntryAiChatResult,
    'model' | 'responseId' | 'changedScopes' | 'tools' | 'diagnostics' | 'usage'
> & {decisionOutcome?: 'confirmed' | 'cancelled' | null}

export interface EntryAiConversationMessage extends EntryAiChatMessage {
    id: string
    result?: EntryAiConversationTurnResult
}

export interface EntryAiConversationSummary {
    id: string
    title: string
    createdAt: string
    updatedAt: string
    messageCount: number
    preview: string
}

export interface EntryAiConversation extends EntryAiConversationSummary {
    entryId: string
    messages: EntryAiConversationMessage[]
}

export interface EntryAiConversationWriteRequest {
    title: string
    messages: EntryAiConversationMessage[]
}

const EMPTY_SOURCES: SourceFileSet = {'article.html': '', 'style.css': ''}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function issue(path: string, code: string, message: string): ContractValidationIssue {
    return {path, code, message}
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

function parseTimestamp(
    value: unknown,
    path: string,
    issues: ContractValidationIssue[],
): string | null {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
        issues.push(issue(path, 'invalid_timestamp', '时间必须是 ISO 日期字符串。'))
        return null
    }
    return value
}

function parseTurnResult(
    value: unknown,
    path: string,
    issues: ContractValidationIssue[],
): EntryAiConversationTurnResult | null {
    if (!isRecord(value)) {
        issues.push(issue(path, 'invalid_ai_turn_result', 'AI 轮次摘要必须是对象。'))
        return null
    }
    issues.push(
        ...exactKeys(
            value,
            [
                'model',
                'responseId',
                'changedScopes',
                'tools',
                'diagnostics',
                'usage',
                'decisionOutcome',
            ],
            path,
        ),
    )
    if (
        value.decisionOutcome !== undefined &&
        value.decisionOutcome !== null &&
        value.decisionOutcome !== 'confirmed' &&
        value.decisionOutcome !== 'cancelled'
    ) {
        issues.push(
            issue(
                `${path}.decisionOutcome`,
                'invalid_decision_outcome',
                '确认结果必须是 confirmed、cancelled 或 null。',
            ),
        )
    }
    const parsed = parseEntryAiChatResult({
        provider: 'deepseek',
        apiFormat: 'openai-responses',
        model: value.model,
        responseId: value.responseId,
        message: 'persisted conversation turn',
        draft: {entrySources: EMPTY_SOURCES, projectSources: EMPTY_SOURCES},
        changedScopes: value.changedScopes,
        tools: value.tools,
        diagnostics: value.diagnostics,
        usage: value.usage,
        pendingDecision: null,
    })
    if (!parsed.ok) {
        issues.push(
            ...parsed.issues.map(item => ({
                ...item,
                path: item.path.replace(/^chat/u, path),
            })),
        )
        return null
    }
    const result = parsed.value
    return {
        model: result.model,
        responseId: result.responseId,
        changedScopes: result.changedScopes,
        tools: result.tools,
        diagnostics: result.diagnostics,
        usage: result.usage,
        ...(value.decisionOutcome !== undefined
            ? {
                  decisionOutcome: value.decisionOutcome as 'confirmed' | 'cancelled' | null,
              }
            : {}),
    }
}

function parseMessages(
    value: unknown,
    path: string,
    issues: ContractValidationIssue[],
): EntryAiConversationMessage[] | null {
    if (!Array.isArray(value)) {
        issues.push(issue(path, 'invalid_array', 'messages 必须是数组。'))
        return null
    }
    if (value.length > ENTRY_AI_CHAT_MAX_MESSAGES || value.length % 2 !== 0) {
        issues.push(
            issue(
                path,
                'invalid_conversation_messages',
                `会话必须由至多 ${ENTRY_AI_CHAT_MAX_MESSAGES} 条完整 user/assistant 轮次组成。`,
            ),
        )
    }
    let totalCharacters = 0
    const messages: EntryAiConversationMessage[] = []
    value.forEach((rawMessage, index) => {
        const messagePath = `${path}[${index}]`
        if (!isRecord(rawMessage)) {
            issues.push(issue(messagePath, 'invalid_message', '消息必须是对象。'))
            return
        }
        issues.push(...exactKeys(rawMessage, ['id', 'role', 'content', 'result'], messagePath))
        const expectedRole = index % 2 === 0 ? 'user' : 'assistant'
        if (typeof rawMessage.id !== 'string' || !RFC_9562_UUID_PATTERN.test(rawMessage.id)) {
            issues.push(issue(`${messagePath}.id`, 'invalid_uuid', '消息 ID 必须是 UUID。'))
        }
        if (rawMessage.role !== expectedRole) {
            issues.push(
                issue(
                    `${messagePath}.role`,
                    'invalid_message_order',
                    '消息必须从 user 开始并交替。',
                ),
            )
        }
        if (typeof rawMessage.content !== 'string' || rawMessage.content.trim().length === 0) {
            issues.push(issue(`${messagePath}.content`, 'invalid_message', '消息内容不能为空。'))
        } else {
            totalCharacters += rawMessage.content.length
            if (expectedRole === 'user' && rawMessage.content.length > ENTRY_AI_PROMPT_MAX_CHARS) {
                issues.push(
                    issue(
                        `${messagePath}.content`,
                        'ai_prompt_too_large',
                        `单条用户消息不能超过 ${ENTRY_AI_PROMPT_MAX_CHARS} 个字符。`,
                    ),
                )
            }
        }
        if (expectedRole === 'user' && rawMessage.result !== undefined) {
            issues.push(
                issue(
                    `${messagePath}.result`,
                    'unexpected_turn_result',
                    '用户消息不能携带工具摘要。',
                ),
            )
        }
        const result =
            expectedRole === 'assistant' && rawMessage.result !== undefined
                ? parseTurnResult(rawMessage.result, `${messagePath}.result`, issues)
                : undefined
        if (
            !issues.some(
                item => item.path === messagePath || item.path.startsWith(`${messagePath}.`),
            )
        ) {
            messages.push({
                id: rawMessage.id as string,
                role: expectedRole,
                content: (rawMessage.content as string).trim(),
                ...(result ? {result} : {}),
            })
        }
    })
    if (totalCharacters > ENTRY_AI_CHAT_MAX_TOTAL_CHARS) {
        issues.push(
            issue(
                path,
                'chat_too_large',
                `会话文本总长度不能超过 ${ENTRY_AI_CHAT_MAX_TOTAL_CHARS} 个字符。`,
            ),
        )
    }
    return issues.some(item => item.path === path || item.path.startsWith(`${path}.`))
        ? null
        : messages
}

function parseTitle(
    value: unknown,
    path: string,
    issues: ContractValidationIssue[],
): string | null {
    if (
        typeof value !== 'string' ||
        value.trim().length === 0 ||
        value.trim().length > ENTRY_AI_CONVERSATION_TITLE_MAX_CHARS
    ) {
        issues.push(
            issue(
                path,
                'invalid_conversation_title',
                `标题必须是 1–${ENTRY_AI_CONVERSATION_TITLE_MAX_CHARS} 个字符。`,
            ),
        )
        return null
    }
    return value.trim()
}

export function parseEntryAiConversationWriteRequest(
    value: unknown,
): ContractParseResult<EntryAiConversationWriteRequest> {
    if (!isRecord(value)) {
        return {
            ok: false,
            value: null,
            issues: [issue('conversation', 'invalid_conversation', '会话写入必须是对象。')],
        }
    }
    const issues = exactKeys(value, ['title', 'messages'], 'conversation')
    const title = parseTitle(value.title, 'conversation.title', issues)
    const messages = parseMessages(value.messages, 'conversation.messages', issues)
    return issues.length > 0 || !title || !messages
        ? {ok: false, value: null, issues}
        : {ok: true, value: {title, messages}, issues: []}
}

export function parseEntryAiConversation(value: unknown): ContractParseResult<EntryAiConversation> {
    if (!isRecord(value)) {
        return {
            ok: false,
            value: null,
            issues: [issue('conversation', 'invalid_conversation', '会话必须是对象。')],
        }
    }
    const issues = exactKeys(
        value,
        ['id', 'entryId', 'title', 'createdAt', 'updatedAt', 'messageCount', 'preview', 'messages'],
        'conversation',
    )
    if (typeof value.id !== 'string' || !RFC_9562_UUID_PATTERN.test(value.id))
        issues.push(issue('conversation.id', 'invalid_uuid', '会话 ID 必须是 UUID。'))
    if (typeof value.entryId !== 'string' || !RFC_9562_UUID_PATTERN.test(value.entryId))
        issues.push(issue('conversation.entryId', 'invalid_uuid', '词条 ID 必须是 UUID。'))
    const title = parseTitle(value.title, 'conversation.title', issues)
    const createdAt = parseTimestamp(value.createdAt, 'conversation.createdAt', issues)
    const updatedAt = parseTimestamp(value.updatedAt, 'conversation.updatedAt', issues)
    const messages = parseMessages(value.messages, 'conversation.messages', issues)
    if (!Number.isInteger(value.messageCount) || Number(value.messageCount) < 0)
        issues.push(issue('conversation.messageCount', 'invalid_count', '消息数必须是非负整数。'))
    if (
        typeof value.preview !== 'string' ||
        value.preview.length > ENTRY_AI_CONVERSATION_PREVIEW_MAX_CHARS
    )
        issues.push(issue('conversation.preview', 'invalid_preview', '会话摘要无效。'))
    if (messages && value.messageCount !== messages.length)
        issues.push(issue('conversation.messageCount', 'count_mismatch', '消息数与记录不一致。'))
    if (issues.length > 0 || !title || !createdAt || !updatedAt || !messages)
        return {ok: false, value: null, issues}
    return {
        ok: true,
        value: {
            id: value.id as string,
            entryId: value.entryId as string,
            title,
            createdAt,
            updatedAt,
            messageCount: value.messageCount as number,
            preview: value.preview as string,
            messages,
        },
        issues: [],
    }
}

export function parseEntryAiConversationList(
    value: unknown,
): ContractParseResult<EntryAiConversationSummary[]> {
    if (!isRecord(value) || !Array.isArray(value.conversations)) {
        return {
            ok: false,
            value: null,
            issues: [issue('conversations', 'invalid_conversation_list', '会话列表无效。')],
        }
    }
    const issues = exactKeys(value, ['conversations'], 'response')
    const summaries: EntryAiConversationSummary[] = []
    value.conversations.forEach((rawSummary, index) => {
        const path = `conversations[${index}]`
        if (!isRecord(rawSummary)) {
            issues.push(issue(path, 'invalid_conversation_summary', '会话摘要必须是对象。'))
            return
        }
        issues.push(
            ...exactKeys(
                rawSummary,
                ['id', 'title', 'createdAt', 'updatedAt', 'messageCount', 'preview'],
                path,
            ),
        )
        if (typeof rawSummary.id !== 'string' || !RFC_9562_UUID_PATTERN.test(rawSummary.id))
            issues.push(issue(`${path}.id`, 'invalid_uuid', '会话 ID 必须是 UUID。'))
        const title = parseTitle(rawSummary.title, `${path}.title`, issues)
        const createdAt = parseTimestamp(rawSummary.createdAt, `${path}.createdAt`, issues)
        const updatedAt = parseTimestamp(rawSummary.updatedAt, `${path}.updatedAt`, issues)
        if (!Number.isInteger(rawSummary.messageCount) || Number(rawSummary.messageCount) < 0)
            issues.push(issue(`${path}.messageCount`, 'invalid_count', '消息数必须是非负整数。'))
        if (
            typeof rawSummary.preview !== 'string' ||
            rawSummary.preview.length > ENTRY_AI_CONVERSATION_PREVIEW_MAX_CHARS
        )
            issues.push(issue(`${path}.preview`, 'invalid_preview', '会话摘要无效。'))
        if (!issues.some(item => item.path === path || item.path.startsWith(`${path}.`))) {
            summaries.push({
                id: rawSummary.id as string,
                title: title as string,
                createdAt: createdAt as string,
                updatedAt: updatedAt as string,
                messageCount: rawSummary.messageCount as number,
                preview: rawSummary.preview as string,
            })
        }
    })
    return issues.length > 0
        ? {ok: false, value: null, issues}
        : {ok: true, value: summaries, issues: []}
}
