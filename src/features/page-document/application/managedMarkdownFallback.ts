// 本模块只为首次进入页面编辑的新文档生成受管段落；浏览模式继续使用无身份的只读降级输出。

import {nodeId} from '../domain/kernel/index.ts'

function escapeHtml(value: string): string {
    return value
        .replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;')
        .replace(/"/gu, '&quot;')
        .replace(/'/gu, '&#39;')
}

export function managedMarkdownParagraphsToHtml(
    markdown: string,
    allocateNodeId: () => string = () => crypto.randomUUID(),
): string {
    const normalized = markdown.replace(/\r\n?/gu, '\n').trim()
    if (!normalized) return ''
    return normalized
        .split(/\n[\t ]*\n+/gu)
        .map(paragraph => {
            const id = nodeId(allocateNodeId())
            const content = escapeHtml(paragraph.trim()).replace(/\n/gu, '<br>')
            return `<p data-fc-node-id="${id}" data-fc-node-kind="paragraph">${content}</p>`
        })
        .join('\n')
}
