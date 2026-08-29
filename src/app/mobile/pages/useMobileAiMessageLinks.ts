/*
 * AI 回复里的锚点接管。
 *
 * AI 消息区是一个渲染 Markdown 的表面，按 app_main/AGENTS.md 的红线必须自己拦链接：
 * AppShell 的 useTopLevelNavigationGuard 只在捕获阶段 preventDefault，它防的是
 * 「把应用打没」，不负责让链接可用——在接管之前，移动端 AI 回复里的词条链接与外链
 * 点下去都是**没反应**，只在日志里留一行 warn。
 *
 * 三类分开处理：词条链接进词条页；http(s)/mailto/tel 交给系统浏览器；其余一律拦下并提示。
 */
import {type MouseEvent as ReactMouseEvent, useCallback} from 'react'
import {useAlert} from 'flowcloudai-ui'
import {db_list_entries} from '../../../api'
import {openUrl} from '../../../api/opener'
import {parseAiChatEntryHref} from '../../../features/ai-chat/lib/aiChatMarkdown'
import {
    isSafeExternalHref,
    resolveInternalEntryProjectId,
    resolveMarkdownAnchor,
} from '../../../features/entries/lib/entryMarkdown'
import {logger} from '../../../shared/logger'
import type {MobileTab} from '../MobileNav'
import type {MobilePage} from '../usePageStack'

/** 旧式「只有标题」双链的查表上限；与词条页的 PROJECT_ENTRY_LOOKUP_LIMIT 同义。 */
const AI_CHAT_ENTRY_LOOKUP_LIMIT = 1000

interface MobileAiMessageLinksOptions {
    /** 解析链接用的项目上下文；缺省时只有自带 projectId 的链接能打开。 */
    projectId: string | null
    navigateToTab: (tab: MobileTab, page?: MobilePage) => void
}

export function useMobileAiMessageLinks({
    projectId,
    navigateToTab,
}: MobileAiMessageLinksOptions): (event: ReactMouseEvent<HTMLElement>) => void {
    const {showAlert} = useAlert()

    return useCallback((event: ReactMouseEvent<HTMLElement>) => {
        const anchor = resolveMarkdownAnchor(event.target)
        if (!anchor) return
        const href = anchor.getAttribute('href') ?? ''

        const openEntry = (targetProjectId: string, entryId: string, displayName: string) => {
            navigateToTab('home', {
                type: 'entryDetail',
                params: {projectId: targetProjectId, entryId, displayName},
            })
        }

        const entryLink = parseAiChatEntryHref(href, anchor.textContent ?? '')
        if (entryLink) {
            event.preventDefault()
            if (entryLink.entryId) {
                const targetProjectId = resolveInternalEntryProjectId(entryLink, projectId)
                if (!targetProjectId) {
                    void showAlert('这条词条链接没带项目 ID，当前对话也没有项目上下文。', 'warning', 'nonInvasive', 2200)
                    return
                }
                openEntry(targetProjectId, entryLink.entryId, entryLink.title || '词条')
                return
            }

            // 只有标题的旧式双链需要查表；按需拉，不为它常驻一份词条列表。
            const title = entryLink.title.trim()
            if (!projectId || !title) {
                void showAlert('当前对话没有项目上下文，无法打开词条链接。', 'warning', 'nonInvasive', 1800)
                return
            }
            void (async () => {
                try {
                    const entries = await db_list_entries({
                        projectId,
                        limit: AI_CHAT_ENTRY_LOOKUP_LIMIT,
                        offset: 0,
                    })
                    const target = entries.find(item => item.title.trim() === title)
                    if (!target) {
                        await showAlert(`未找到词条「${title}」`, 'warning', 'nonInvasive', 1800)
                        return
                    }
                    openEntry(projectId, target.id, target.title)
                } catch (error) {
                    logger.error('[MobileAiChat] 按标题查找词条失败', error)
                    await showAlert('查找词条失败', 'error', 'nonInvasive', 1800)
                }
            })()
            return
        }

        if (isSafeExternalHref(href)) {
            event.preventDefault()
            void openUrl(href).catch((error) => {
                logger.error('[MobileAiChat] 打开外链失败', error)
                void showAlert('打开链接失败', 'error', 'nonInvasive', 1800)
            })
            return
        }

        // 页内锚点（#heading）属于正常跳转，不拦；其余未知协议一律拦下。
        if (href && !href.startsWith('#')) {
            event.preventDefault()
            void showAlert('无效链接，已阻止跳转', 'warning', 'nonInvasive', 1500)
        }
    }, [navigateToTab, projectId, showAlert])
}
