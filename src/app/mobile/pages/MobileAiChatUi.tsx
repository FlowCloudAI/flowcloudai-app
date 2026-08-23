/* eslint-disable react-refresh/only-export-components */
/** 移动端 AI 会话的轻量 UI 模型与图标；业务状态仍由 MobileAiChat 管理。 */
import type {ConversationExportFormat} from '../../../api'
import type {AiToolAccessMode, Conversation} from '../../../features/ai-chat/model/AiControllerTypes'

export type ApiKeyAvailability = 'unknown' | 'checking' | 'configured' | 'missing' | 'error'
export type AiConversationFilter = 'all' | 'default' | 'character' | 'report'
export type AiConversationStatusFilter = 'active' | 'archived'
export interface ConversationLongPressState { conversation: Conversation; ready: boolean; timerId: number | null }

export const CONVERSATION_LONG_PRESS_DELAY = 430
export const CONVERSATION_LONG_PRESS_MOVE_TOLERANCE = 12
export const AI_DOCUMENT_CONTEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'toml', 'ini', 'log', 'js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'php', 'rb', 'swift', 'kt', 'sql', 'html', 'htm', 'css', 'scss', 'less', 'sh', 'bat', 'ps1', 'env', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf']
export const AI_DOCUMENT_CONTEXT_EXTENSION_SET = new Set(AI_DOCUMENT_CONTEXT_EXTENSIONS)
export const AI_TOOL_ACCESS_LABELS: Record<AiToolAccessMode, string> = {reader: '读者模式', assistant: '助手模式', writer: '作家模式'}
export const AI_TOOL_ACCESS_DETAILS: Record<AiToolAccessMode, string> = {reader: '只读取资料', assistant: '写入前确认', writer: '写入免确认'}
export const AI_TOOL_ACCESS_OPTIONS: AiToolAccessMode[] = ['reader', 'assistant', 'writer']
export const AI_CONVERSATION_FILTER_OPTIONS: Array<{key: AiConversationFilter; label: string}> = [{key: 'all', label: '全部'}, {key: 'default', label: '通用'}, {key: 'character', label: '角色聊天'}, {key: 'report', label: '矛盾检测'}]
export const AI_CONVERSATION_STATUS_OPTIONS: Array<{key: AiConversationStatusFilter; label: string}> = [{key: 'active', label: '当前'}, {key: 'archived', label: '归档'}]

export function getSelectedFileExtension(path: string) {
    let decoded = path
    try { decoded = decodeURIComponent(path) } catch { /* 保留原路径 */ }
    const fileName = decoded.split(/[?#]/, 1)[0].split(/[\\/]/).pop() ?? decoded
    const dotIndex = fileName.lastIndexOf('.')
    return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLocaleLowerCase() : ''
}

export function formatConversationDate(timestamp: number) {
    return timestamp ? new Intl.DateTimeFormat('zh-CN', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'}).format(new Date(timestamp)) : '时间未知'
}

export function sortConversations(first: Conversation, second: Conversation) {
    const pinnedDiff = Number(Boolean(second.pinnedAt)) - Number(Boolean(first.pinnedAt))
    if (pinnedDiff) return pinnedDiff
    if (first.pinnedAt && second.pinnedAt) return second.pinnedAt.localeCompare(first.pinnedAt)
    return (second.timestamp ?? 0) - (first.timestamp ?? 0)
}

export function matchesConversationFilter(conversation: Conversation, filter: AiConversationFilter) {
    if (filter === 'all') return true
    if (filter === 'default') return !conversation.mode || conversation.mode === 'default'
    return conversation.mode === filter
}

export function buildConversationSearchText(conversation: Conversation) {
    return [conversation.title, conversation.characterName, conversation.reportContext?.projectName, conversation.reportContext?.scopeSummary].filter(Boolean).join(' ').toLocaleLowerCase()
}

export function buildConversationExportFileName(conversation: Conversation, format: ConversationExportFormat) {
    const safeTitle = conversation.title.split('').map(char => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char)).join('').replace(/\s+/g, ' ').trim().slice(0, 80)
    return `${safeTitle || 'AI会话'}.${format === 'json' ? 'json' : 'md'}`
}

type IconType = 'pin' | 'archive' | 'rename' | 'delete' | 'plugin' | 'image' | 'file' | 'web' | 'send' | 'stop' | 'camera' | 'thinking' | AiToolAccessMode
const AI_TOOL_ACCESS_ICON_PATHS: Record<AiToolAccessMode, string[]> = {
    reader: [
        'M12 8.8C10 7.2 7.6 6.4 4.7 6.4v10.3c2.9 0 5.3.8 7.3 2.5Z',
        'M12 8.8c2-1.6 4.4-2.4 7.3-2.4v10.3c-2.9 0-5.3.8-7.3 2.5Z',
        'M12 8.8v10.4',
    ],
    assistant: [
        'M12 3.6 19 6.3v5.2c0 4.3-2.8 7.3-7 8.9-4.2-1.6-7-4.6-7-8.9V6.3Z',
        'm8.4 11.9 2.3 2.3 4.9-4.9',
    ],
    writer: [
        'm5 19 1.2-4.7L15.5 5a1.6 1.6 0 0 1 2.3 0L19 6.2a1.6 1.6 0 0 1 0 2.3l-9.3 9.3Z',
        'm14.4 6.1 3.5 3.5M6.2 14.3l3.5 3.5M5 19l4.7-1.2',
    ],
}

export function MobileAiIcon({type, strokeWidth}: {type: IconType; strokeWidth?: number}) {
    if (type === 'reader' || type === 'assistant' || type === 'writer') {
        return (
            <svg className="mobile-ai-svg" viewBox="0 0 24 24" focusable="false" aria-hidden="true" style={{strokeWidth: strokeWidth ?? 2.1}}>
                {AI_TOOL_ACCESS_ICON_PATHS[type].map(path => <path key={path} d={path}/>)}
            </svg>
        )
    }
    if (type === 'plugin') {
        return (
            <svg className="mobile-ai-svg" viewBox="0 0 24 24" focusable="false" aria-hidden="true" style={{strokeWidth: 2.1}}>
                <path d="M7.6 8h8.8v4.2a4.4 4.4 0 0 1-8.8 0Z"/>
                <path d="M9.7 4.2V8M14.3 4.2V8M12 16.6v3.2"/>
            </svg>
        )
    }
    if (type === 'thinking') {
        return (
            <svg className="mobile-ai-svg" viewBox="0 0 24 24" focusable="false" aria-hidden="true" style={{fill: 'currentColor', strokeWidth: 2.1}}>
                <path d="M13.3 3.5 6.9 12.6h4.9l-1.1 7.9 6.4-9.4h-4.8Z"/>
            </svg>
        )
    }
    const paths: Partial<Record<IconType, string[]>> = {
        pin: ['M12 17v5', 'M8.5 10.8 6.2 13.1A1.7 1.7 0 0 0 7.4 16h9.2a1.7 1.7 0 0 0 1.2-2.9l-2.3-2.3V6.5l1.5-1.5H7l1.5 1.5Z'],
        archive: ['M5 7.5h14', 'M7 8.5v10h10v-10', 'M9.5 12h5', 'M6.5 4.5h11l1.5 3h-13Z'],
        rename: ['M4.5 16.5 15.8 5.2a2.1 2.1 0 0 1 3 3L7.5 19.5h-3Z', 'm14 7 3 3'],
        delete: ['M5.5 7h13', 'M9 7V5.5h6V7', 'M8 10v8', 'M12 10v8', 'M16 10v8', 'M7 7.5 8 20h8l1-12.5'],
        file: ['M7 4.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V6A1.5 1.5 0 0 1 7.5 4.5Z', 'M14 4.5V9h4', 'M8.5 13h7', 'M8.5 16h5'],
        web: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z', 'M4.5 12h17', 'M12 3.5c4.3 4.7 4.3 12.3 0 17', 'M12 3.5c-4.3 4.7-4.3 12.3 0 17'],
        send: ['M12 20V4', 'M4.5 11.5 12 4l7.5 7.5'],
    }
    if (type === 'stop') return <svg className="mobile-ai-svg" viewBox="0 0 24 24"><rect x="8" y="8" width="8" height="8" rx="1.5"/></svg>
    if (type === 'camera') return <svg className="mobile-ai-svg" viewBox="0 0 24 24"><path d="M8.5 7 10 5h4l1.5 2H18a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="3.2"/></svg>
    if (type === 'image') return <svg className="mobile-ai-svg" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="m7 16 3.5-3.5 2.5 2.5 2-2 3 3"/></svg>
    return <svg className="mobile-ai-svg" viewBox="0 0 24 24" focusable="false">{paths[type]?.map(path => <path key={path} d={path}/>)}</svg>
}

export function MoreDotsIcon() { return <svg className="mobile-ai-drawer__more-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.55"/><circle cx="12" cy="12" r="1.55"/><circle cx="18" cy="12" r="1.55"/></svg> }
