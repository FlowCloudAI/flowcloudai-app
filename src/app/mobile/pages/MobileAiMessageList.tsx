import {Fragment, type MouseEvent as ReactMouseEvent, type RefObject} from 'react'
import {Button, MessageBox} from 'flowcloudai-ui'
import {type AiContextValue} from '../../../features/ai-chat/model/AiControllerTypes'
import {
    buildRenderableAiChatBlocks,
    buildRenderableAiChatMarkdown,
} from '../../../features/ai-chat/lib/aiChatMarkdown'
import AiChatErrorNotice from '../../../features/ai-chat/components/AiChatErrorNotice'
import AiResponsePendingIndicator from '../../../features/ai-chat/components/AiResponsePendingIndicator'
import {isIncompleteMessage} from '../../../features/ai-chat/model/conversationState'
import {ErrorCode} from '../../../api'

interface MobileAiMessageListProps {
    messages: AiContextValue['messages']
    streamingBlocks: AiContextValue['streamingBlocks']
    isStreaming: boolean
    continuationNodeId: number | null
    continuationSubmittingMessageId: string | null
    focusEntryId: string | null
    hasActiveConversation: boolean
    conversationCreationDisabled: boolean
    setupActionLabel: string | null
    messagesEndRef: RefObject<HTMLDivElement | null>
    onNewConversation: () => void
    onOpenSettings: () => void
    onRetryMessage: (messageId: string) => void
    onCompactRetryMessage: (messageId: string) => void
    onContinueMessage: (messageId: string) => void
    /**
     * 消息区的锚点接管。AI 回复是 Markdown 表面，必须自己拦链接：
     * 见 app_main/AGENTS.md「任何渲染 Markdown 的表面都必须自己接管锚点点击」。
     */
    onMessageLinkClick: (event: ReactMouseEvent<HTMLElement>) => void
}

export default function MobileAiMessageList({
    messages,
    streamingBlocks,
    isStreaming,
    continuationNodeId,
    continuationSubmittingMessageId,
    focusEntryId,
    hasActiveConversation,
    conversationCreationDisabled,
    setupActionLabel,
    messagesEndRef,
    onNewConversation,
    onOpenSettings,
    onRetryMessage,
    onCompactRetryMessage,
    onContinueMessage,
    onMessageLinkClick,
}: MobileAiMessageListProps) {
    const showEmptyState = messages.length === 0 && !isStreaming

    return (
        <main
            className={`mobile-ai-chat__messages${showEmptyState ? ' mobile-ai-chat__messages--empty' : ''}`}
            onClick={onMessageLinkClick}
        >
            {showEmptyState && (
                <div className="mobile-ai-chat__empty">
                    <p>开始 AI 对话</p>
                    <span>{focusEntryId ? '围绕当前词条继续创作。' : '与 AI 讨论世界观设定、资料整理和后续创作。'}</span>
                    {!hasActiveConversation && (
                        <Button type="button" onClick={onNewConversation} disabled={conversationCreationDisabled}>
                            开始新对话
                        </Button>
                    )}
                    {setupActionLabel ? (
                        <Button type="button" variant="outline" onClick={onOpenSettings}>
                            {setupActionLabel}
                        </Button>
                    ) : null}
                </div>
            )}
            {messages.map((message, messageIndex) => {
                const isContinuing = Boolean(
                    isStreaming
                    && continuationNodeId != null
                    && continuationNodeId === message.nodeId,
                )
                const canContinue = Boolean(
                    !isStreaming
                    && continuationSubmittingMessageId !== message.id
                    && message.nodeId != null
                    && isIncompleteMessage(message),
                )
                const visibleBlocks = isContinuing
                    ? [...(message.blocks ?? []), ...streamingBlocks]
                    : message.blocks
                /*
                 * 与桌面端共用同一条可渲染化管线：把模型产出的 [[标题]] / fc:// / entry://
                 * 改写成同文档 hash 链接，并给已经结束的会话里悬挂的工具调用收尾。
                 * 只对 assistant 做——用户输入按原文显示，不该被改写。
                 */
                const renderableBlocks = message.role === 'assistant'
                    ? buildRenderableAiChatBlocks(visibleBlocks, !isContinuing)
                    : visibleBlocks
                const renderableContent = message.role === 'assistant'
                    ? buildRenderableAiChatMarkdown(message.content)
                    : message.content
                if (!message.error) {
                    return (
                        <Fragment key={message.id}>
                            <MessageBox
                                role={message.role}
                                blocks={renderableBlocks}
                                content={renderableContent}
                                markdown={message.role === 'assistant'}
                                contextDisplay={message.role === 'assistant' ? 'compact' : 'full'}
                                toolCallDetail="verbose"
                                lineHeight={1.5}
                                streaming={isContinuing}
                            />
                            {canContinue ? (
                                <Button type="button" size="sm" onClick={() => onContinueMessage(message.id)}>
                                    继续
                                </Button>
                            ) : null}
                        </Fragment>
                    )
                }
                const canRetry = messages
                    .slice(0, messageIndex)
                    .some(item => item.role === 'user' && item.nodeId != null)
                const hasRenderableMessage = Boolean(
                    message.content || message.reasoning || message.blocks?.length,
                )
                return (
                    <div key={message.id} className="mobile-ai-chat__message">
                        {hasRenderableMessage ? (
                            <MessageBox
                                role={message.role}
                                blocks={renderableBlocks}
                                content={renderableContent}
                                markdown={message.role === 'assistant'}
                                contextDisplay={message.role === 'assistant' ? 'compact' : 'full'}
                                toolCallDetail="verbose"
                                lineHeight={1.5}
                                streaming={isContinuing}
                            />
                        ) : null}
                        <AiChatErrorNotice
                            compact
                            error={message.error}
                            onRetry={message.error.code === ErrorCode.ContextBudgetExceeded
                                ? () => onCompactRetryMessage(message.id)
                                : canContinue
                                ? () => onContinueMessage(message.id)
                                : canRetry
                                    ? () => onRetryMessage(message.id)
                                    : undefined}
                            retryLabel={message.error.code === ErrorCode.ContextBudgetExceeded
                                ? '立即压缩并重试'
                                : canContinue ? '继续' : '重试'}
                            onOpenSettings={onOpenSettings}
                        />
                    </div>
                )
            })}
            {isStreaming && continuationNodeId == null && streamingBlocks.length === 0 && (
                <AiResponsePendingIndicator/>
            )}
            {isStreaming && continuationNodeId == null && streamingBlocks.length > 0 && (
                <MessageBox
                    role="assistant"
                    blocks={buildRenderableAiChatBlocks(streamingBlocks)}
                    streaming
                    markdown
                    toolCallDetail="verbose"
                    lineHeight={1.5}
                />
            )}
            <div ref={messagesEndRef}/>
        </main>
    )
}
