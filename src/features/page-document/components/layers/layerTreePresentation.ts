// 本模块把图层投影转换成作者可读的类型与摘要；它不参与节点选择或源码改写。

import type {LayerProjectionNode} from '../../domain/layerProjection.ts'

const MANAGED_KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
    container: '布局容器',
    paragraph: '段落',
    heading: '标题',
    asset: '图片',
    gallery: '图库',
    list: '列表',
    'list-item': '列表项',
    table: '表格',
    'table-cell': '表格单元格',
    divider: '分隔线',
})

function compactSummary(value: string): string {
    const compact = value.replace(/\s+/gu, ' ').trim()
    return compact.length > 28 ? `${compact.slice(0, 28)}…` : compact
}

function sourceTypeLabel(tagName: string | null): string {
    if (tagName && /^h[1-6]$/u.test(tagName)) return '未纳入标题'
    if (tagName === 'p') return '未纳入段落'
    if (tagName === 'img' || tagName === 'picture' || tagName === 'figure') return '未纳入图片'
    if (tagName === 'section' || tagName === 'article' || tagName === 'main' || tagName === 'div') return '未纳入区域'
    return '未纳入 HTML'
}

function operationLabel(node: LayerProjectionNode): string {
    const slot =
        node.attributes['data-fc-fill'] ??
        node.attributes['data-fc-append'] ??
        node.attributes['data-fc-replace'] ??
        node.attributes['data-fc-remove']
    if (slot === 'entry-header') return '词条页眉'
    if (slot === 'entry-body' || slot === 'body') return '词条正文'
    return '模板内容区'
}

export function pageDocumentLayerLabel(node: LayerProjectionNode): string {
    const typeLabel = node.managed
        ? (MANAGED_KIND_LABELS[node.kind] ?? '页面元素')
        : node.kind === 'operation'
          ? operationLabel(node)
          : sourceTypeLabel(node.tagName)
    const summary = compactSummary(node.textContent)
    return summary ? `${typeLabel} · ${summary}` : typeLabel
}
