/**
 * AI 用户提交的上下文分层与版本计算。
 *
 * 这里不访问页面状态或 Tauri：调用方先解析项目、词条与文档，再用纯函数生成一次
 * 提交载荷。参考材料进入 attributes，可信对话策略进入 instructionAttributes。
 */
import type {TaskContextPayload} from '../../../api'
import type {AiToolAccessMode} from '../model/AiControllerTypes'

export const CONVERSATION_SYSTEM_PROMPT_ATTRIBUTE = 'conversation_system_prompt'
export const DOCUMENT_CONTEXT_ATTRIBUTE = 'attached_documents'

interface BuildTaskContextPayloadInput {
    projectId: string | null
    projectName: string | null
    entryId: string | null
    entrySnippet: string | null
    systemPrompt: string
    toolAccessMode: AiToolAccessMode
    webSearchEnabled: boolean
    editModeEnabled: boolean
}

export function buildTaskContextPayload({
    projectId,
    projectName,
    entryId,
    entrySnippet,
    systemPrompt,
    toolAccessMode,
    webSearchEnabled,
    editModeEnabled,
}: BuildTaskContextPayloadInput): TaskContextPayload {
    const attributes: Record<string, string> = {}
    const instructionAttributes: Record<string, string> = {}
    if (projectId) {
        attributes.project_id = projectId
        if (projectName) attributes.project_name = projectName
    }
    if (entryId) {
        attributes.entry_id = entryId
        if (entrySnippet) attributes.entry_snippet = entrySnippet
    }
    if (systemPrompt) {
        instructionAttributes[CONVERSATION_SYSTEM_PROMPT_ATTRIBUTE] = [
            '当前对话独有提示词如下。它只作用于当前对话，不代表全局设置。',
            systemPrompt,
        ].join('\n')
    }

    const modeLabel = toolAccessMode === 'reader'
        ? 'reader（读者模式）'
        : toolAccessMode === 'writer'
            ? 'writer（作家模式）'
            : 'assistant（助手模式）'
    const hints = [
        `当前工具权限模式：${modeLabel}。请只使用当前可用工具，不要声称拥有未开放能力。`,
        '引用当前项目具体词条时使用 Markdown 链接格式：[词条标题](fc://self/entry/词条ID)，不要使用缺少项目 ID 的旧格式。',
    ]
    if (!webSearchEnabled) {
        hints.push(
            '用户已禁用 "web_search" 和 "open_url" 工具。' +
            '若问题涉及联网获取信息，请勿主观臆断，而是告知用户开启"联网搜索"功能后再试。',
        )
    }
    if (!editModeEnabled) {
        hints.push(
            'reader（读者模式）：所有写入类工具已被禁用。' +
            '若用户要求修改内容，请告知其切换到"助手模式"或"作家模式"后再操作。',
        )
    } else if (toolAccessMode === 'assistant') {
        hints.push('assistant（助手模式）：允许写入工具，但写入和删除操作必须等待用户确认后才能执行。')
    } else if (toolAccessMode === 'writer') {
        hints.push('writer（作家模式）：常规新建、改写和移动操作可直接执行；删除类操作仍必须等待用户确认。')
    }
    instructionAttributes.ai_instructions = hints.join('\n')
    instructionAttributes.ai_tool_mode = toolAccessMode

    return {
        attributes,
        instructionAttributes,
        flags: {
            read_only: toolAccessMode === 'reader',
            auto_confirm_writes: toolAccessMode === 'writer',
        },
    }
}

export function withDocumentContext(
    context: TaskContextPayload,
    markdown: string,
): TaskContextPayload {
    if (!markdown.trim()) return context
    return {
        ...context,
        attributes: {
            ...(context.attributes ?? {}),
            [DOCUMENT_CONTEXT_ATTRIBUTE]: markdown,
        },
    }
}

/** 精确、确定性的提交版本；只用于本地比较，不写入 prompt。 */
export function contextSubmissionVersion(context: TaskContextPayload): string {
    const entries = (value: Record<string, string | boolean> | undefined) =>
        Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right))
    return JSON.stringify({
        projectId: context.projectId ?? null,
        taskType: context.taskType ?? null,
        attributes: entries(context.attributes),
        instructionAttributes: entries(context.instructionAttributes),
        flags: entries(context.flags),
    })
}
