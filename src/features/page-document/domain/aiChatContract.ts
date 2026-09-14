// 本模块声明浏览器草稿与 DeepSeek 多轮代理之间的严格 DTO；对话状态由浏览器持有，服务端不另建文档真值。
import type {DocumentDiagnostic, SourceFileName, SourceFileSet} from './contract.ts'
import type {EditImpact} from './kernel/index.ts'
import {
    DEEPSEEK_API_FORMAT,
    DEEPSEEK_PROVIDER,
    ENTRY_AI_PROMPT_MAX_CHARS,
    type EntryAiUsage,
} from './aiWorkflowContract.ts'
import {
    parseDocumentDiagnostics,
    type ContractParseResult,
    type ContractValidationIssue,
} from './validators.ts'

export const ENTRY_AI_CHAT_MAX_MESSAGES = 40
export const ENTRY_AI_CHAT_MAX_TOTAL_CHARS = 64_000

export interface EntryAiChatMessage {
    role: 'user' | 'assistant'
    content: string
}

export interface EntryAiChatDraft {
    baseRevision: number
    baseTemplateVersion: number
    baseProjectRevision: number
    entrySources: SourceFileSet
    projectSources: SourceFileSet
}

export interface EntryAiChatRequest {
    messages: EntryAiChatMessage[]
    draft: EntryAiChatDraft
}

export type EntryAiChatToolScope = 'read' | 'entry' | 'project'
export type EntryAiChatToolStatus = 'read' | 'applied' | 'unchanged' | 'needs-decision' | 'rejected'

export interface EntryAiChatToolEvent {
    callId: string
    name: string
    scope: EntryAiChatToolScope
    status: EntryAiChatToolStatus
    message: string
    changedFiles: SourceFileName[]
    diagnostics: DocumentDiagnostic[]
}

export interface EntryAiChatPendingDecision {
    planId: string
    impacts: EditImpact[]
    draft: {
        entrySources: SourceFileSet
        projectSources: SourceFileSet
    }
    changedScopes: Array<'entry' | 'project'>
    diagnostics: DocumentDiagnostic[]
}

export interface EntryAiChatResult {
    provider: typeof DEEPSEEK_PROVIDER
    apiFormat: typeof DEEPSEEK_API_FORMAT
    model: string
    responseId: string
    message: string
    draft: {
        entrySources: SourceFileSet
        projectSources: SourceFileSet
    }
    changedScopes: Array<'entry' | 'project'>
    tools: EntryAiChatToolEvent[]
    diagnostics: DocumentDiagnostic[]
    usage: EntryAiUsage
    pendingDecision: EntryAiChatPendingDecision | null
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

function parseSources(
    value: unknown,
    path: string,
    issues: ContractValidationIssue[],
): SourceFileSet | null {
    if (!isRecord(value)) {
        issues.push(issue(path, 'invalid_source_set', '源码集合必须是对象。'))
        return null
    }
    issues.push(...exactKeys(value, ['article.html', 'style.css'], path))
    for (const file of ['article.html', 'style.css'] as const) {
        if (typeof value[file] !== 'string') {
            issues.push(issue(`${path}.${file}`, 'invalid_string', `${file} 必须是字符串。`))
        }
    }
    return issues.some(item => item.path === path || item.path.startsWith(`${path}.`))
        ? null
        : (value as unknown as SourceFileSet)
}

function parseUsage(
    value: unknown,
    path: string,
    issues: ContractValidationIssue[],
): EntryAiUsage | null {
    if (!isRecord(value)) {
        issues.push(issue(path, 'invalid_usage', 'usage 必须是对象。'))
        return null
    }
    issues.push(...exactKeys(value, ['inputTokens', 'outputTokens', 'totalTokens'], path))
    for (const field of ['inputTokens', 'outputTokens', 'totalTokens'] as const) {
        if (!Number.isInteger(value[field]) || Number(value[field]) < 0) {
            issues.push(
                issue(`${path}.${field}`, 'invalid_token_count', 'token 数必须是非负整数。'),
            )
        }
    }
    return issues.some(item => item.path === path || item.path.startsWith(`${path}.`))
        ? null
        : (value as unknown as EntryAiUsage)
}

function parseChangedScopes(
    value: unknown,
    path: string,
    issues: ContractValidationIssue[],
): Array<'entry' | 'project'> {
    const changedScopes: Array<'entry' | 'project'> = []
    if (!Array.isArray(value)) {
        issues.push(issue(path, 'invalid_array', 'changedScopes 必须是数组。'))
        return changedScopes
    }
    for (const [index, scope] of value.entries()) {
        if ((scope !== 'entry' && scope !== 'project') || changedScopes.includes(scope)) {
            issues.push(
                issue(`${path}[${index}]`, 'invalid_scope', '作用域必须唯一且为 entry/project。'),
            )
        } else changedScopes.push(scope)
    }
    return changedScopes
}

function parsePendingDecision(
    value: unknown,
    path: string,
    issues: ContractValidationIssue[],
): EntryAiChatPendingDecision | null {
    if (value === null) return null
    if (!isRecord(value)) {
        issues.push(issue(path, 'invalid_pending_decision', '待确认计划必须是对象或 null。'))
        return null
    }
    issues.push(
        ...exactKeys(value, ['planId', 'impacts', 'draft', 'changedScopes', 'diagnostics'], path),
    )
    if (
        typeof value.planId !== 'string' ||
        value.planId.length === 0 ||
        value.planId.length > 256
    ) {
        issues.push(issue(`${path}.planId`, 'invalid_plan_id', '确认计划 ID 无效。'))
    }

    const impacts: EditImpact[] = []
    if (!Array.isArray(value.impacts) || value.impacts.length === 0) {
        issues.push(issue(`${path}.impacts`, 'invalid_impacts', '待确认计划必须包含具体影响。'))
    } else {
        value.impacts.forEach((impact, index) => {
            const impactPath = `${path}.impacts[${index}]`
            if (!isRecord(impact)) {
                issues.push(issue(impactPath, 'invalid_impact', '影响必须是对象。'))
                return
            }
            issues.push(...exactKeys(impact, ['code', 'message', 'requiresDecision'], impactPath))
            if (typeof impact.code !== 'string' || impact.code.length === 0) {
                issues.push(issue(`${impactPath}.code`, 'invalid_string', '影响代码不能为空。'))
            }
            if (typeof impact.message !== 'string' || impact.message.length === 0) {
                issues.push(issue(`${impactPath}.message`, 'invalid_string', '影响说明不能为空。'))
            }
            if (impact.requiresDecision !== true) {
                issues.push(
                    issue(
                        `${impactPath}.requiresDecision`,
                        'decision_not_required',
                        '待确认列表只能包含确实需要人工决定的影响。',
                    ),
                )
            }
            if (
                !issues.some(
                    item => item.path === impactPath || item.path.startsWith(`${impactPath}.`),
                )
            ) {
                impacts.push({
                    code: impact.code as string,
                    message: impact.message as string,
                    requiresDecision: true,
                })
            }
        })
    }

    let draft: EntryAiChatPendingDecision['draft'] | null = null
    if (!isRecord(value.draft)) {
        issues.push(issue(`${path}.draft`, 'invalid_draft', '待确认候选源码必须是对象。'))
    } else {
        issues.push(...exactKeys(value.draft, ['entrySources', 'projectSources'], `${path}.draft`))
        const entrySources = parseSources(
            value.draft.entrySources,
            `${path}.draft.entrySources`,
            issues,
        )
        const projectSources = parseSources(
            value.draft.projectSources,
            `${path}.draft.projectSources`,
            issues,
        )
        if (entrySources && projectSources) draft = {entrySources, projectSources}
    }
    const changedScopes = parseChangedScopes(value.changedScopes, `${path}.changedScopes`, issues)
    const diagnostics = parseDocumentDiagnostics(value.diagnostics)
    if (!diagnostics.ok) issues.push(...diagnostics.issues)
    if (
        issues.some(item => item.path === path || item.path.startsWith(`${path}.`)) ||
        !draft ||
        !diagnostics.ok
    ) {
        return null
    }
    return {
        planId: value.planId as string,
        impacts,
        draft,
        changedScopes,
        diagnostics: diagnostics.value,
    }
}

export function parseEntryAiChatRequest(value: unknown): ContractParseResult<EntryAiChatRequest> {
    if (!isRecord(value)) {
        return failed([issue('request', 'invalid_ai_chat_request', 'AI 对话请求必须是对象。')])
    }
    const issues = exactKeys(value, ['messages', 'draft'], 'request')
    const messages: EntryAiChatMessage[] = []
    if (!Array.isArray(value.messages)) {
        issues.push(issue('request.messages', 'invalid_array', 'messages 必须是数组。'))
    } else {
        if (value.messages.length < 1 || value.messages.length > ENTRY_AI_CHAT_MAX_MESSAGES) {
            issues.push(
                issue(
                    'request.messages',
                    'message_limit_exceeded',
                    `对话必须包含 1–${ENTRY_AI_CHAT_MAX_MESSAGES} 条消息。`,
                ),
            )
        }
        let totalChars = 0
        value.messages.forEach((message, index) => {
            const path = `request.messages[${index}]`
            if (!isRecord(message)) {
                issues.push(issue(path, 'invalid_message', '对话消息必须是对象。'))
                return
            }
            issues.push(...exactKeys(message, ['role', 'content'], path))
            const expectedRole = index % 2 === 0 ? 'user' : 'assistant'
            if (message.role !== expectedRole) {
                issues.push(
                    issue(`${path}.role`, 'invalid_message_order', '对话必须从 user 开始并交替。'),
                )
            }
            if (typeof message.content !== 'string' || message.content.trim().length === 0) {
                issues.push(issue(`${path}.content`, 'invalid_message', '消息内容不能为空。'))
                return
            }
            if (expectedRole === 'user' && message.content.length > ENTRY_AI_PROMPT_MAX_CHARS) {
                issues.push(
                    issue(
                        `${path}.content`,
                        'ai_prompt_too_large',
                        `单条用户消息不能超过 ${ENTRY_AI_PROMPT_MAX_CHARS} 个字符。`,
                    ),
                )
            }
            totalChars += message.content.length
            messages.push({role: expectedRole, content: message.content.trim()})
        })
        if (value.messages.length % 2 !== 1) {
            issues.push(
                issue('request.messages', 'user_message_required', '请求必须以 user 消息结束。'),
            )
        }
        if (totalChars > ENTRY_AI_CHAT_MAX_TOTAL_CHARS) {
            issues.push(
                issue(
                    'request.messages',
                    'chat_too_large',
                    `对话文本总长度不能超过 ${ENTRY_AI_CHAT_MAX_TOTAL_CHARS} 个字符。`,
                ),
            )
        }
    }

    let draft: EntryAiChatDraft | null = null
    if (!isRecord(value.draft)) {
        issues.push(issue('request.draft', 'invalid_draft', 'draft 必须是对象。'))
    } else {
        issues.push(
            ...exactKeys(
                value.draft,
                [
                    'baseRevision',
                    'baseTemplateVersion',
                    'baseProjectRevision',
                    'entrySources',
                    'projectSources',
                ],
                'request.draft',
            ),
        )
        for (const field of [
            'baseRevision',
            'baseTemplateVersion',
            'baseProjectRevision',
        ] as const) {
            if (!Number.isInteger(value.draft[field]) || Number(value.draft[field]) < 1) {
                issues.push(
                    issue(`request.draft.${field}`, 'invalid_revision', `${field} 必须是正整数。`),
                )
            }
        }
        const entrySources = parseSources(
            value.draft.entrySources,
            'request.draft.entrySources',
            issues,
        )
        const projectSources = parseSources(
            value.draft.projectSources,
            'request.draft.projectSources',
            issues,
        )
        if (entrySources && projectSources) {
            draft = {
                baseRevision: value.draft.baseRevision as number,
                baseTemplateVersion: value.draft.baseTemplateVersion as number,
                baseProjectRevision: value.draft.baseProjectRevision as number,
                entrySources,
                projectSources,
            }
        }
    }
    return issues.length > 0 || !draft
        ? failed(issues)
        : {ok: true, value: {messages, draft}, issues: []}
}

export function parseEntryAiChatResult(value: unknown): ContractParseResult<EntryAiChatResult> {
    if (!isRecord(value)) {
        return failed([issue('chat', 'invalid_ai_chat_result', 'AI 对话结果必须是对象。')])
    }
    const issues = exactKeys(
        value,
        [
            'provider',
            'apiFormat',
            'model',
            'responseId',
            'message',
            'draft',
            'changedScopes',
            'tools',
            'diagnostics',
            'usage',
            'pendingDecision',
        ],
        'chat',
    )
    if (value.provider !== DEEPSEEK_PROVIDER) {
        issues.push(issue('chat.provider', 'invalid_provider', 'AI 提供方必须是 DeepSeek。'))
    }
    if (value.apiFormat !== DEEPSEEK_API_FORMAT) {
        issues.push(issue('chat.apiFormat', 'invalid_api_format', '必须使用 Responses 兼容格式。'))
    }
    for (const field of ['model', 'responseId', 'message'] as const) {
        if (typeof value[field] !== 'string' || value[field].length === 0) {
            issues.push(issue(`chat.${field}`, 'invalid_string', `${field} 必须是非空字符串。`))
        }
    }

    let draft: EntryAiChatResult['draft'] | null = null
    if (!isRecord(value.draft)) {
        issues.push(issue('chat.draft', 'invalid_draft', 'draft 必须是对象。'))
    } else {
        issues.push(...exactKeys(value.draft, ['entrySources', 'projectSources'], 'chat.draft'))
        const entrySources = parseSources(
            value.draft.entrySources,
            'chat.draft.entrySources',
            issues,
        )
        const projectSources = parseSources(
            value.draft.projectSources,
            'chat.draft.projectSources',
            issues,
        )
        if (entrySources && projectSources) draft = {entrySources, projectSources}
    }

    const changedScopes = parseChangedScopes(value.changedScopes, 'chat.changedScopes', issues)

    const tools: EntryAiChatToolEvent[] = []
    if (!Array.isArray(value.tools)) {
        issues.push(issue('chat.tools', 'invalid_array', 'tools 必须是数组。'))
    } else {
        value.tools.forEach((tool, index) => {
            const path = `chat.tools[${index}]`
            if (!isRecord(tool)) {
                issues.push(issue(path, 'invalid_tool_event', '工具事件必须是对象。'))
                return
            }
            issues.push(
                ...exactKeys(
                    tool,
                    ['callId', 'name', 'scope', 'status', 'message', 'changedFiles', 'diagnostics'],
                    path,
                ),
            )
            for (const field of ['callId', 'name', 'message'] as const) {
                if (typeof tool[field] !== 'string' || tool[field].length === 0) {
                    issues.push(
                        issue(`${path}.${field}`, 'invalid_string', `${field} 必须是非空字符串。`),
                    )
                }
            }
            if (!['read', 'entry', 'project'].includes(String(tool.scope))) {
                issues.push(issue(`${path}.scope`, 'invalid_scope', '工具作用域无效。'))
            }
            if (
                !['read', 'applied', 'unchanged', 'needs-decision', 'rejected'].includes(
                    String(tool.status),
                )
            ) {
                issues.push(issue(`${path}.status`, 'invalid_status', '工具状态无效。'))
            }
            const changedFiles: SourceFileName[] = []
            if (!Array.isArray(tool.changedFiles)) {
                issues.push(
                    issue(`${path}.changedFiles`, 'invalid_array', 'changedFiles 必须是数组。'),
                )
            } else {
                tool.changedFiles.forEach((file, fileIndex) => {
                    if (
                        (file !== 'article.html' && file !== 'style.css') ||
                        changedFiles.includes(file)
                    ) {
                        issues.push(
                            issue(
                                `${path}.changedFiles[${fileIndex}]`,
                                'invalid_source_file',
                                'changedFiles 包含未知或重复文件。',
                            ),
                        )
                    } else changedFiles.push(file)
                })
            }
            const parsedDiagnostics = parseDocumentDiagnostics(tool.diagnostics)
            if (!parsedDiagnostics.ok) issues.push(...parsedDiagnostics.issues)
            if (!issues.some(item => item.path === path || item.path.startsWith(`${path}.`))) {
                tools.push({
                    callId: tool.callId as string,
                    name: tool.name as string,
                    scope: tool.scope as EntryAiChatToolScope,
                    status: tool.status as EntryAiChatToolStatus,
                    message: tool.message as string,
                    changedFiles,
                    diagnostics: parsedDiagnostics.value ?? [],
                })
            }
        })
    }

    const parsedDiagnostics = parseDocumentDiagnostics(value.diagnostics)
    if (!parsedDiagnostics.ok) issues.push(...parsedDiagnostics.issues)
    const usage = parseUsage(value.usage, 'chat.usage', issues)
    const pendingDecision = parsePendingDecision(
        value.pendingDecision,
        'chat.pendingDecision',
        issues,
    )
    if (value.pendingDecision === undefined) {
        issues.push(
            issue(
                'chat.pendingDecision',
                'missing_field',
                'AI 对话结果必须明确声明是否存在待确认计划。',
            ),
        )
    }
    if (issues.length > 0 || !draft || !parsedDiagnostics.ok || !usage) return failed(issues)
    return {
        ok: true,
        value: {
            provider: DEEPSEEK_PROVIDER,
            apiFormat: DEEPSEEK_API_FORMAT,
            model: value.model as string,
            responseId: value.responseId as string,
            message: value.message as string,
            draft,
            changedScopes,
            tools,
            diagnostics: parsedDiagnostics.value,
            usage,
            pendingDecision,
        },
        issues: [],
    }
}
