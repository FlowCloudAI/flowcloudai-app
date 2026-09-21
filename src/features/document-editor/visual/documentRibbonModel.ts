// 本模块定义 Office 功能区的稳定页签与组件上下文映射；只描述界面能力，不读取或修改文档源码。
import type {LayerProjectionNode} from '../../page-document/domain/layerProjection.ts'
import {isInlineFormatNodeKind} from '../../page-document/domain/nodeSemantics.ts'

export type DocumentBaseRibbonTab = 'home' | 'insert' | 'page' | 'view'
export type DocumentContextualRibbonTab =
    'picture' | 'gallery' | 'table' | 'container' | 'list' | 'divider'
export type DocumentRibbonTab = DocumentBaseRibbonTab | DocumentContextualRibbonTab

export type DocumentRibbonDensity = 'full' | 'icons' | 'compact' | 'minimal'
export type DocumentRibbonGroupPriority = 'essential' | 'high' | 'normal' | 'low'

export const DOCUMENT_BASE_RIBBON_TABS = ['home', 'insert', 'page', 'view'] as const

export type DocumentHomeRibbonGroup = 'font' | 'paragraph' | 'edit' | 'block'

export const DOCUMENT_HOME_RIBBON_GROUPS = [
    'font',
    'paragraph',
    'edit',
    'block',
] as const satisfies readonly DocumentHomeRibbonGroup[]

export const DOCUMENT_HOME_RIBBON_PRIORITIES = Object.freeze({
    font: 'essential',
    paragraph: 'high',
    edit: 'normal',
    block: 'low',
} as const satisfies Readonly<Record<DocumentHomeRibbonGroup, DocumentRibbonGroupPriority>>)

export function documentRibbonDensity(width: number): DocumentRibbonDensity {
    if (width < 900) return 'minimal'
    if (width < 1180) return 'compact'
    if (width < 1500) return 'icons'
    return 'full'
}

export interface DocumentHomeRibbonAvailability {
    readonly font: string | null
    readonly paragraph: string | null
    readonly edit: null
    readonly block: string | null
}

export function homeRibbonGroupAvailability(
    node: LayerProjectionNode | null,
): DocumentHomeRibbonAvailability {
    const isManaged = Boolean(node?.managed)
    const isRoot = node?.attributes['data-fc-editor-root'] !== undefined
    const supportsText = Boolean(node?.managed && isInlineFormatNodeKind(node.kind))
    const selectionReason = node ? '当前节点不支持此组命令' : '先选择一个文档节点'

    return {
        font: supportsText ? null : selectionReason,
        paragraph: supportsText ? null : selectionReason,
        edit: null,
        block: isManaged && !isRoot ? null : isRoot ? '固定页面根不能移动或删除' : selectionReason,
    }
}

export function contextualRibbonTabForNode(
    node: LayerProjectionNode | null,
): DocumentContextualRibbonTab | null {
    if (!node?.managed || node.attributes['data-fc-editor-root'] !== undefined) return null
    if (node.kind === 'asset') return 'picture'
    if (node.kind === 'gallery') return 'gallery'
    if (node.kind === 'table' || node.kind === 'table-cell') return 'table'
    if (node.kind === 'container') return 'container'
    if (node.kind === 'list' || node.kind === 'list-item') return 'list'
    if (node.kind === 'divider') return 'divider'
    return null
}

export function ribbonTabsForNode(node: LayerProjectionNode | null): readonly DocumentRibbonTab[] {
    const contextual = contextualRibbonTabForNode(node)
    return contextual ? [...DOCUMENT_BASE_RIBBON_TABS, contextual] : DOCUMENT_BASE_RIBBON_TABS
}

export function resolveRibbonTab(
    requested: DocumentRibbonTab,
    node: LayerProjectionNode | null,
): DocumentRibbonTab {
    return ribbonTabsForNode(node).includes(requested) ? requested : 'home'
}
