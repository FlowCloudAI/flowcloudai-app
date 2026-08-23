// 移动端 AI 会话抽屉：集中呈现搜索、筛选与历史会话入口。
import type {HTMLAttributes, MouseEvent} from 'react'
import {Button, Input} from 'flowcloudai-ui'
import type {Conversation} from '../../../features/ai-chat/model/AiControllerTypes'
import {MobileAddIcon, MobileSearchIcon} from '../components/MobileTopControls'
import {
    AI_CONVERSATION_FILTER_OPTIONS,
    AI_CONVERSATION_STATUS_OPTIONS,
    formatConversationDate,
    MoreDotsIcon,
    type AiConversationFilter,
    type AiConversationStatusFilter,
} from './MobileAiChatUi'

interface Props {
    search: string
    onSearch: (value: string) => void
    statusFilter: AiConversationStatusFilter
    onStatusFilter: (filter: AiConversationStatusFilter) => void
    filter: AiConversationFilter
    onFilter: (filter: AiConversationFilter) => void
    creationDisabled: boolean
    onNew: () => void
    conversations: Conversation[]
    visibleConversations: Conversation[]
    hasSearch: boolean
    runtime: Record<string, {isStreaming?: boolean; hasUnreadReply?: boolean} | undefined>
    activeConversationId: string | null
    getLongPressProps: (conversation: Conversation) => HTMLAttributes<HTMLButtonElement>
    onOpen: (id: string) => void
    onContextMenu: (conversation: Conversation, event: MouseEvent<HTMLButtonElement>) => void
    actionTarget: Conversation | null
    onActionTarget: (conversation: Conversation) => void
}

export default function MobileAiConversationDrawer(props: Props) {
    return <aside className="mobile-ai-drawer" aria-label="对话列表">
        <Input value={props.search} onValueChange={props.onSearch} placeholder="搜索对话..." aria-label="搜索对话" prefix={<MobileSearchIcon className="mobile-drawer-search-icon"/>} radius="full" size="md" allowClear className="mobile-drawer-search"/>
        <div className="mobile-drawer-filter-stack">
            <div className="mobile-drawer-filter-group"><span>状态</span><div className="mobile-drawer-segmented" role="group" aria-label="AI 对话状态">{AI_CONVERSATION_STATUS_OPTIONS.map(option => <button key={option.key} type="button" className={props.statusFilter === option.key ? 'active' : ''} aria-pressed={props.statusFilter === option.key} onClick={() => props.onStatusFilter(option.key)}>{option.label}</button>)}</div></div>
            <div className="mobile-drawer-filter-group"><span>类型</span><div className="mobile-drawer-segmented" role="group" aria-label="AI 对话类型">{AI_CONVERSATION_FILTER_OPTIONS.map(option => <button key={option.key} type="button" className={props.filter === option.key ? 'active' : ''} aria-pressed={props.filter === option.key} onClick={() => props.onFilter(option.key)}>{option.label}</button>)}</div></div>
            <Button type="button" variant="outline" size="md" radius="full" block className="mobile-drawer-primary-action" disabled={props.creationDisabled} onClick={props.onNew}><MobileAddIcon className="mobile-top-control-svg--inline"/>新对话</Button>
        </div>
        <div className="mobile-ai-drawer__list">
            {props.visibleConversations.length === 0 ? <div className="mobile-drawer-empty">{props.conversations.length === 0 ? '暂无历史对话' : props.hasSearch ? '没有匹配的对话' : props.statusFilter === 'archived' ? '暂无归档对话' : '当前类型下没有对话'}</div> : props.visibleConversations.map(conversation => {
                const state = props.runtime[conversation.id]
                const tags = [conversation.pinnedAt ? '已顶置' : null, conversation.archivedAt ? '已归档' : null, conversation.mode === 'character' ? '角色对话' : null, conversation.mode === 'report' ? '矛盾检测' : null].filter(Boolean).join(' · ')
                return <div key={conversation.id} className={`mobile-ai-drawer__item${conversation.id === props.activeConversationId ? ' active' : ''}${conversation.mode === 'character' ? ' is-character' : ''}${conversation.mode === 'report' ? ' is-report' : ''}${conversation.pinnedAt ? ' is-pinned' : ''}${conversation.archivedAt ? ' is-archived' : ''}${state?.isStreaming ? ' is-streaming' : ''}${state?.hasUnreadReply ? ' has-unread-reply' : ''}`}>
                    <button type="button" className="mobile-ai-drawer__item-content" aria-current={conversation.id === props.activeConversationId ? 'true' : undefined} {...props.getLongPressProps(conversation)} onClick={() => props.onOpen(conversation.id)} onContextMenu={event => props.onContextMenu(conversation, event)}><span className="mobile-ai-drawer__item-main"><strong>{conversation.title}</strong>{tags ? <small>{tags}</small> : null}</span><span className="mobile-ai-drawer__item-meta">{formatConversationDate(conversation.timestamp)}</span></button>
                    <button type="button" className="mobile-ai-drawer__item-more" aria-label={`打开「${conversation.title}」的操作菜单`} aria-haspopup="menu" aria-expanded={props.actionTarget?.id === conversation.id} onClick={() => props.onActionTarget(conversation)}><MoreDotsIcon/></button>
                </div>
            })}
        </div>
    </aside>
}
