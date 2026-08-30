/* eslint-disable react-hooks/refs -- 仅透传父组件 refs 给锚点组件，不读取 ref.current */
import type {ReactNode, RefObject} from 'react'
import type {DocumentContextItem, PluginInfo} from '../../../api'
import type {AiToolAccessMode, Conversation} from '../../../features/ai-chat/model/AiControllerTypes'
import type {AiContextUsage} from '../../../features/ai-chat/hooks/useAiContextUsage'
import {formatTokenCount} from '../../../features/ai-chat/lib/contextUsage'
import {ActionMenu, RenameDialog} from '../../../shared/ui/overlay'
import MobileBottomSheet from '../components/MobileBottomSheet'
import {
    MobileAddIcon,
    MobileAnchoredActionMenu,
    MobileAnchoredMenu,
    MobileCheckIcon,
    type MobileAnchoredMenuItem,
} from '../components/MobileTopControls'
import {AI_TOOL_ACCESS_LABELS, MobileAiIcon} from './MobileAiChatUi'

interface ModelOption { id: string; label: string; description: string }
interface ToolModeOption { mode: AiToolAccessMode; label: string; description: string }
interface Props {
    pageRef: RefObject<HTMLDivElement | null>; composerRef: RefObject<HTMLElement | null>
    topActionsRef: RefObject<HTMLDivElement | null>
    toolModeMenuRef: RefObject<HTMLButtonElement | null>; modelMenuRef: RefObject<HTMLButtonElement | null>
    inputValue: string; onInput: (value: string) => void; onSend: () => void; inputPlaceholder: string; inputDisabled: boolean
    isStreaming: boolean; isCompacting: boolean; onStop: () => void; thinking: boolean; onToggleThinking: () => void
    toolAccessMode: AiToolAccessMode; activeToolModeShortLabel: string; toolModeMenuOpen: boolean; onToolModeMenuOpen: (open: boolean) => void; onBeforeToolModeMenuOpen: () => void
    toolModeOptions: ToolModeOption[]; onToolModeChange: (mode: AiToolAccessMode) => void
    morePanelOpen: boolean; onOpenMore: () => void; onCloseMore: () => void
    editing: boolean; onCancelEditing: () => void
    modelMenuOpen: boolean; onCloseModelMenu: () => void; modelMenuMode: 'models' | 'plugins'; onModelMenuMode: (mode: 'models' | 'plugins') => void
    plugins: PluginInfo[]; activeLlmPluginName: string; activeLlmPluginId: string; activeModelOptions: ModelOption[]; activeModelId: string
    onSelectModel: (modelId: string) => void; onSelectPlugin: (pluginId: string) => void
    topMenuOpen: boolean; onCloseTopMenu: () => void; activeConversationMenuItems: MobileAnchoredMenuItem[]
    onAttachDocuments: () => void; webSearchEnabled: boolean; onToggleWebSearch: () => void
    documentContextItems: DocumentContextItem[]
    contextUsage: AiContextUsage | null; contextUsageOpen: boolean
    contextUsageRef: RefObject<HTMLButtonElement | null>; onToggleContextUsage: () => void
    onCloseContextUsage: () => void
    onRetryDocument: (itemId: string) => void; onRemoveDocument: (itemId: string) => void
    /** 「更多」面板里描述本次请求注入了什么的一行文本。 */
    contextScopeText: string
    conversationControls: ReactNode; conversationActionTarget: Conversation | null; onCloseConversationAction: () => void; conversationActionMenuItems: MobileAnchoredMenuItem[]
    renameTarget: Conversation | null; renaming: boolean; onCloseRename: () => void; onRename: (title: string) => void
}

/* 环画在 24x24 视口里；半径留出描边宽度，不要贴边。 */
const CONTEXT_RING_RADIUS = 9
const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_RING_RADIUS

/** 与桌面端 documentContextStatusLabel 同一套措辞；ready 不显示状态词，由「已引用」兜底。 */
const DOCUMENT_STATUS_LABELS: Record<string, string> = {
    pending: '排队中',
    parsing: '解析中',
    ready: '',
    failed: '解析失败',
}

export default function MobileAiComposer(p: Props) {
    return <>
        <footer ref={p.composerRef} className="mobile-ai-chat__composer">
            {/*
              * 已引用文档必须看得见：移动端此前只能「添加」，加进去之后既看不到列表、
              * 解析失败也没有重试入口，加错了也删不掉，只能弃用整个会话。
              * 横向滚动区必须带 data-mobile-horizontal-scroll，否则会和侧边抽屉手势抢横滑。
              */}
            {p.documentContextItems.length > 0 ? (
                <div className="mobile-ai-doc-rail" data-mobile-horizontal-scroll aria-label="本对话引用文档">
                    {p.documentContextItems.map(item => {
                        const typeLabel = item.extension ? item.extension.toUpperCase() : '文件'
                        const statusLabel = DOCUMENT_STATUS_LABELS[item.status] ?? item.status
                        return (
                            <article
                                key={item.id}
                                className={`mobile-ai-doc-chip mobile-ai-doc-chip--${item.status}`}
                            >
                                <span className="mobile-ai-doc-chip__meta">
                                    <span className="mobile-ai-doc-chip__name">{item.fileName}</span>
                                    <small>{statusLabel ? `${typeLabel} · ${statusLabel}` : `${typeLabel} · 已引用`}</small>
                                </span>
                                {item.status === 'failed' ? (
                                    <button
                                        type="button"
                                        className="mobile-ai-doc-chip__action"
                                        aria-label={`重新解析 ${item.fileName}`}
                                        onClick={() => p.onRetryDocument(item.id)}
                                    ><MobileAiIcon type="retry"/></button>
                                ) : null}
                                <button
                                    type="button"
                                    className="mobile-ai-doc-chip__action"
                                    aria-label={`停止引用 ${item.fileName}`}
                                    onClick={() => p.onRemoveDocument(item.id)}
                                ><MobileAiIcon type="close"/></button>
                            </article>
                        )
                    })}
                </div>
            ) : null}
            <div className="mobile-ai-composer-card">
            {p.isCompacting ? <div className="mobile-ai-composer-card__status" role="status">正在压缩对话历史…</div> : null}
            {/* 编辑态必须可见：MessageBox 的「编辑」只是把原文放回输入框，发送时会替换那条消息而不是追加。 */}
            {p.editing ? <div className="mobile-ai-composer-card__status mobile-ai-composer-card__status--editing" role="status"><span>正在编辑已发送的消息</span><button type="button" onClick={p.onCancelEditing}>取消</button></div> : null}
            <textarea aria-label="AI 消息" value={p.inputValue} onChange={event => p.onInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); p.onSend() } }} placeholder={p.inputPlaceholder} rows={1} disabled={p.inputDisabled && !p.isStreaming}/>
            <div className="mobile-ai-composer-card__bar"><div className="mobile-ai-composer-card__chips">
                <button type="button" className={`mobile-ai-composer-card__chip${p.thinking ? ' active' : ''}`} aria-pressed={p.thinking} disabled={p.isStreaming} onClick={p.onToggleThinking}><MobileAiIcon type="thinking"/><span>思考</span></button>
                <button ref={p.toolModeMenuRef} type="button" className={`mobile-ai-composer-card__chip mobile-ai-composer-card__chip--mode active${p.toolAccessMode === 'reader' ? ' is-reader' : ''}${p.toolAccessMode === 'writer' ? ' is-writer' : ''}${p.toolModeMenuOpen ? ' is-menu-open' : ''}`} aria-haspopup="menu" aria-expanded={p.toolModeMenuOpen} aria-label={`切换写入模式，当前为${AI_TOOL_ACCESS_LABELS[p.toolAccessMode]}`} disabled={p.isStreaming} onClick={() => { p.onBeforeToolModeMenuOpen(); p.onToolModeMenuOpen(!p.toolModeMenuOpen) }}><MobileAiIcon type={p.toolAccessMode}/><span>{p.activeToolModeShortLabel}</span></button>
            </div><div className="mobile-ai-composer-card__actions">
                {/*
                  * 对话记忆用量环。放在「更多」左边，默认只画环不写百分比字符——小屏上
                  * 一串数字会和右侧两颗圆钮抢位置；需要具体数值时点开浮窗看。
                  */}
                {p.contextUsage ? (
                    <button
                        ref={p.contextUsageRef}
                        type="button"
                        className={`mobile-ai-context-ring${p.contextUsageOpen ? ' is-open' : ''}`}
                        aria-haspopup="dialog"
                        aria-expanded={p.contextUsageOpen}
                        aria-label={p.contextUsage.title}
                        onClick={p.onToggleContextUsage}
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <circle className="mobile-ai-context-ring__track" cx="12" cy="12" r={CONTEXT_RING_RADIUS}/>
                            <circle
                                className="mobile-ai-context-ring__value"
                                cx="12"
                                cy="12"
                                r={CONTEXT_RING_RADIUS}
                                strokeDasharray={CONTEXT_RING_CIRCUMFERENCE}
                                strokeDashoffset={CONTEXT_RING_CIRCUMFERENCE * (1 - p.contextUsage.ringPercent / 100)}
                            />
                        </svg>
                    </button>
                ) : null}
                <button type="button" className="mobile-ai-composer-card__icon-btn" aria-label="更多" aria-expanded={p.morePanelOpen} onClick={p.morePanelOpen ? p.onCloseMore : p.onOpenMore}><MobileAddIcon className="mobile-top-control-svg--inline"/></button>
                <button type="button" className="mobile-ai-composer-card__icon-btn mobile-ai-composer-card__icon-btn--send" aria-label={p.isStreaming ? '停止生成' : '发送'} onClick={p.isStreaming ? p.onStop : p.onSend} disabled={!p.isStreaming && (!p.inputValue.trim() || p.inputDisabled)}><MobileAiIcon type={p.isStreaming ? 'stop' : 'send'}/></button>
            </div></div>
            </div>
        </footer>

        {/*
          * 用量浮窗：就长在用量环正上方——挪去顶栏试过，读数和它的入口离得太远，
          * 点完还得满屏找。clearAnchor 让它落在环外侧而不是盖住环本身。
          */}
        <MobileAnchoredMenu
            open={p.contextUsageOpen}
            onClose={p.onCloseContextUsage}
            anchorRef={p.contextUsageRef}
            containerRef={p.pageRef}
            ariaLabel="对话记忆用量"
            className="mobile-ai-context-usage-popover"
            align="right"
            placement="top"
            clearAnchor
        >
            <div className="mobile-ai-context-usage-popover__body">
                {/*
                  * 百分比已经在左边的 strong 里，右边只补绝对值与来源。
                  * contextUsage.title 是给 aria-label 的完整句子，直接铺在这一行会把
                  * 百分比说两遍，挤掉真正有信息量的 token 数。
                  */}
                <strong>{p.contextUsage?.label ?? '0%'}</strong>
                <span>{p.contextUsage
                    ? p.contextUsage.contextWindowTokens != null
                        ? `${p.contextUsage.source} ${formatTokenCount(p.contextUsage.usedTokens)} / ${formatTokenCount(p.contextUsage.contextWindowTokens)}`
                        : `${p.contextUsage.source} ${formatTokenCount(p.contextUsage.usedTokens)}，上限未知`
                    : ''}</span>
            </div>
        </MobileAnchoredMenu>

        <MobileAnchoredMenu open={p.toolModeMenuOpen} onClose={() => p.onToolModeMenuOpen(false)} anchorRef={p.toolModeMenuRef} containerRef={p.pageRef} ariaLabel="切换写入模式" className="mobile-ai-tool-mode-menu" align="left" placement="top">
            <div className="mobile-anchored-menu__group">{p.toolModeOptions.map(option => { const active = p.toolAccessMode === option.mode; return <button key={option.mode} type="button" role="menuitemradio" aria-checked={active} className={`mobile-anchored-menu__row mobile-ai-tool-mode-menu__row mobile-ai-tool-mode-menu__row--${option.mode}${active ? ' active' : ''}`} disabled={p.isStreaming} onClick={() => { p.onToolModeMenuOpen(false); p.onToolModeChange(option.mode) }}><span className="mobile-anchored-menu__icon" aria-hidden="true"><MobileAiIcon type={option.mode} strokeWidth={1.7}/></span><span className="mobile-anchored-menu__text"><span className="mobile-ai-tool-mode-menu__label">{option.label}</span><small>{option.description}</small></span></button> })}</div>
        </MobileAnchoredMenu>

        <MobileAnchoredMenu open={p.modelMenuOpen} onClose={() => p.modelMenuMode === 'plugins' ? p.onModelMenuMode('models') : p.onCloseModelMenu()} anchorRef={p.modelMenuRef} containerRef={p.pageRef} ariaLabel={p.modelMenuMode === 'plugins' ? '切换 AI 插件' : '切换 AI 模型'} className="mobile-ai-model-menu" align="left" rightBoundaryRef={p.topActionsRef} rightBoundaryGap={8}>
            {p.modelMenuMode === 'models' ? <div className="mobile-anchored-menu__group">
                <button type="button" role="menuitem" className="mobile-anchored-menu__row mobile-ai-model-menu__row" disabled={p.plugins.length === 0} onClick={() => p.onModelMenuMode('plugins')}><span className="mobile-anchored-menu__check"/><span className="mobile-anchored-menu__icon"><MobileAiIcon type="plugin"/></span><span className="mobile-anchored-menu__text"><span>切换插件</span><small>{p.activeLlmPluginName}</small></span></button>
                <div className="mobile-ai-model-menu__divider" role="presentation"/>
                {p.activeModelOptions.length === 0 ? <button type="button" role="menuitem" className="mobile-anchored-menu__row mobile-ai-model-menu__row" disabled><span className="mobile-anchored-menu__text"><span>没有可用模型</span><small>请先在设置中配置插件</small></span></button> : p.activeModelOptions.map(model => <button key={model.id} type="button" role="menuitemradio" aria-checked={model.id === p.activeModelId} className={`mobile-anchored-menu__row mobile-ai-model-menu__row${model.id === p.activeModelId ? ' active' : ''}`} disabled={p.isStreaming} onClick={() => p.onSelectModel(model.id)}><span className="mobile-anchored-menu__check" aria-hidden="true">{model.id === p.activeModelId ? <MobileCheckIcon/> : null}</span><span className="mobile-anchored-menu__text"><span>{model.label}</span>{model.description ? <small>{model.description}</small> : null}</span></button>)}
            </div> : <div className="mobile-anchored-menu__group">
                {p.plugins.length === 0 ? <button type="button" role="menuitem" className="mobile-anchored-menu__row mobile-ai-model-menu__row" disabled><span className="mobile-anchored-menu__text"><span>没有可用插件</span><small>请先在设置中安装 AI 对话插件</small></span></button> : p.plugins.map(plugin => { const nextModel = plugin.default_model && plugin.models.includes(plugin.default_model) ? plugin.default_model : (plugin.models[0] ?? ''); return <button key={plugin.id} type="button" role="menuitemradio" aria-checked={plugin.id === p.activeLlmPluginId} className={`mobile-anchored-menu__row mobile-ai-model-menu__row${plugin.id === p.activeLlmPluginId ? ' active' : ''}`} disabled={p.isStreaming || !nextModel} onClick={() => p.onSelectPlugin(plugin.id)}><span className="mobile-anchored-menu__check" aria-hidden="true">{plugin.id === p.activeLlmPluginId ? <MobileCheckIcon/> : null}</span><span className="mobile-anchored-menu__icon"><MobileAiIcon type="plugin"/></span><span className="mobile-anchored-menu__text"><span>{plugin.name}</span><small>{nextModel || '没有可用模型'}</small></span></button> })}
            </div>}
        </MobileAnchoredMenu>

        <MobileAnchoredActionMenu open={p.topMenuOpen} onClose={p.onCloseTopMenu} anchorRef={p.topActionsRef} containerRef={p.pageRef} ariaLabel="对话操作" className="mobile-ai-conversation-menu" items={p.activeConversationMenuItems}/>
        <MobileBottomSheet open={p.morePanelOpen} onClose={p.onCloseMore} ariaLabel="更多对话设置" className="mobile-ai-more-sheet"><div className="mobile-ai-more-sheet__quick" aria-label="添加内容">
            <button type="button" disabled aria-label="相机，即将支持"><MobileAiIcon type="camera"/><span>相机</span><small>即将支持</small></button><button type="button" disabled aria-label="图库，即将支持"><MobileAiIcon type="image"/><span>图库</span><small>即将支持</small></button><button type="button" onClick={p.onAttachDocuments}><MobileAiIcon type="file"/><span>文件</span></button><button type="button" className={p.webSearchEnabled ? 'active' : ''} aria-pressed={p.webSearchEnabled} onClick={p.onToggleWebSearch}><MobileAiIcon type="web"/><span>联网搜索</span></button>
        </div><p className="mobile-ai-more-sheet__scope">{p.contextScopeText}</p>{p.conversationControls}</MobileBottomSheet>
        <ActionMenu open={!!p.conversationActionTarget} onClose={p.onCloseConversationAction} title={p.conversationActionTarget?.title} ariaLabel="对话操作菜单" items={p.conversationActionMenuItems}/>
        <RenameDialog open={!!p.renameTarget} title="重命名对话" initialValue={p.renameTarget?.title ?? ''} placeholder="对话名称" busy={p.renaming} onClose={p.onCloseRename} onConfirm={p.onRename}/>
    </>
}
