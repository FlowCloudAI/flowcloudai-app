import type {ReactNode} from 'react'
import AIChatContent from './components/AIChatContent'
import type {AiContextValue} from './model/AiControllerTypes'
import AiPluginMissingOverlay, {type AiMissingPluginKind} from '../../shared/ui/AiPluginMissingOverlay'

interface UseAIChatPanelOptions {
    controller: AiContextValue
    onToggleCollapsed?: () => void
    onOpenEntry?: (projectId: string, entry: { id: string; title: string }) => void
    onOpenPluginManagement?: (kind: AiMissingPluginKind) => void
    onOpenWriterModeSettings?: () => void
}

export interface AIChatPanelSlots {
    main: ReactNode
}

/**
 * AIChatContent 作为单一组件实例挂在 Dock 主体中，保留其内部会话与草稿状态。
 */
export function useAIChatPanel({
                                   controller,
                                   ...rest
                               }: UseAIChatPanelOptions): AIChatPanelSlots {
    const missingLlmPlugin = controller.pluginsReady && controller.plugins.length === 0
    const renderMissingOverlay = () => missingLlmPlugin ? (
        <AiPluginMissingOverlay kind="llm" onOpenPluginManagement={rest.onOpenPluginManagement}/>
    ) : null

    return {
        main: (
            <div className={`ai-chat-layout ${controller.sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
                <AIChatContent
                    controller={controller}
                    {...rest}
                />
                {renderMissingOverlay()}
            </div>
        ),
    }
}
