/*
 * AI 回复的可渲染化：把模型产出的词条链接改写成应用内可点的形式，并给中断的工具调用收尾。
 *
 * 为什么必须做这一步：模型会直接吐出 `[[标题]]`、`fc://…/entry/…`、`entry://`、
 * `entry-title://`。这些原样交给 MessageBox 的话，`[[标题]]` 只是一段字面量，
 * 其余几种会渲染成 <a> 但点下去是顶层导航——Tauri WebView 一旦导航离开应用地址，
 * 整个应用就被替换掉（见 shared/hooks/useTopLevelNavigationGuard.ts 的说明）。
 * 这里统一改写成 `#fc-entry-link?…` 这种同文档 hash，既不会触发顶层导航，
 * 也让两端可以用同一个 parse 函数还原出 InternalEntryLink。
 *
 * 本模块原先内联在桌面端 AIChatContent.tsx 里，移动端因此一直渲染的是原始文本。
 * 抽出来是为了让两端共用同一条管线，不要再各写一份。
 */
import {type MessageBoxBlock} from 'flowcloudai-ui'
/*
 * 这条 import 特意带 .ts 后缀（tsconfig 已开 allowImportingTsExtensions）：
 * scripts/ai-chat-markdown.test.mjs 用 node --experimental-strip-types 直接跑本模块，
 * node 的 ESM 解析不会补扩展名，省略后缀会 ERR_MODULE_NOT_FOUND。
 */
import {parseInternalEntryHref, type InternalEntryLink} from '../../entries/lib/entryLinkHref.ts'

/** 同文档 hash 前缀：不触发顶层导航，因此不会被 useTopLevelNavigationGuard 拦掉。 */
export const AI_CHAT_ENTRY_LINK_PREFIX = '#fc-entry-link?'

export function buildAiChatEntryHref(link: InternalEntryLink): string {
    const params = new URLSearchParams()
    if (link.projectId) params.set('projectId', link.projectId)
    if (link.isSelfProject) params.set('selfProject', '1')
    if (link.entryId) params.set('entryId', link.entryId)
    params.set('title', link.title)
    return `${AI_CHAT_ENTRY_LINK_PREFIX}${params.toString()}`
}

export function parseAiChatEntryHref(href: string, fallbackTitle = ''): InternalEntryLink | null {
    if (href.startsWith(AI_CHAT_ENTRY_LINK_PREFIX)) {
        const params = new URLSearchParams(href.slice(AI_CHAT_ENTRY_LINK_PREFIX.length))
        const title = (params.get('title') ?? fallbackTitle).trim()
        const projectId = params.get('projectId')?.trim() || null
        const entryId = params.get('entryId')?.trim() || null
        if (!title && !entryId) return null
        return {title, projectId, entryId, isSelfProject: params.get('selfProject') === '1'}
    }

    return parseInternalEntryHref(href, fallbackTitle)
}

export function buildRenderableAiChatMarkdown(content: string): string {
    return content
        .replace(/\[([^\]\n]+?)]\((fc:\/\/[^)\s]+\/entry\/[^)\s]+|entry:\/\/[^)\s]+|entry-title:\/\/[^)]+)\)/g, (_match, rawTitle, rawHref) => {
            const title = String(rawTitle).trim()
            const link = parseInternalEntryHref(String(rawHref), title)
            if (!link) return _match
            return `[${title}](${buildAiChatEntryHref(link)})`
        })
        .replace(/\[\[([^[\]\n]+?)]]/g, (_match, rawTitle) => {
            const title = String(rawTitle).trim()
            if (!title) return _match
            return `[${title}](${buildAiChatEntryHref({title, projectId: null, entryId: null})})`
        })
}

export function buildRenderableAiChatBlocks(
    blocks?: MessageBoxBlock[],
    finalizePendingTools = false,
): MessageBoxBlock[] | undefined {
    if (!blocks) return undefined
    return blocks.map((block) => {
        if (block.type === 'content') {
            return {
                ...block,
                content: buildRenderableAiChatMarkdown(block.content),
                streaming: finalizePendingTools ? false : block.streaming,
            }
        }
        if (block.type === 'reasoning') {
            return finalizePendingTools ? {...block, streaming: false} : block
        }
        if (finalizePendingTools && block.type === 'tool' && block.tool.result == null) {
            return {
                ...block,
                tool: {...block.tool, result: '会话已结束，未返回工具结果。'},
            }
        }
        if (finalizePendingTools && block.type === 'tool_use') {
            return {
                ...block,
                tools: block.tools.map(tool => (
                    tool.result == null ? {...tool, result: '会话已结束，未返回工具结果。'} : tool
                )),
            }
        }
        return block
    })
}
