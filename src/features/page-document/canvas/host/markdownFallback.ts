// 本模块把旧 Markdown 正文降级为无语法解释的安全段落；它不保存，也不生成作者能力。

function escapeHtml(value: string): string {
    return value
        .replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;')
        .replace(/"/gu, '&quot;')
        .replace(/'/gu, '&#39;')
}

export function markdownParagraphsToHtml(markdown: string): string {
    const normalized = markdown.replace(/\r\n?/gu, '\n').trim()
    if (!normalized) return ''
    return normalized
        .split(/\n[\t ]*\n+/gu)
        .map(paragraph => `<p>${escapeHtml(paragraph.trim()).replace(/\n/gu, '<br>')}</p>`)
        .join('\n')
}
