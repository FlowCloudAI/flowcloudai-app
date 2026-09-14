// 本模块冻结可视节点的有限响应式与交互上下文；读写器共享选择器、媒体条件和优先级定义。
import {
    DOCUMENT_NODE_KINDS,
    ENTRY_DESKTOP_MEDIA_QUERY,
    ENTRY_HOVER_MEDIA_QUERY,
    MANAGED_NODE_STYLE_CONTEXTS,
    type DocumentNodeKind,
    type ManagedNodeStyleContext,
} from '../contract.ts'
import {cssMediaMatches} from './managedCssContext.ts'
import {parseManagedNodeSelector, type ManagedNodeSelectorIdentity} from './managedNodeSelector.ts'

export interface ManagedNodeStyleContextDefinition {
    context: ManagedNodeStyleContext
    label: string
    media: string | null
    selectorSuffix: string
}

export const MANAGED_NODE_STYLE_CONTEXT_DEFINITIONS: Readonly<
    Record<ManagedNodeStyleContext, ManagedNodeStyleContextDefinition>
> = {
    mobile: {context: 'mobile', label: '移动基础', media: null, selectorSuffix: ''},
    desktop: {
        context: 'desktop',
        label: '桌面',
        media: ENTRY_DESKTOP_MEDIA_QUERY,
        selectorSuffix: '',
    },
    hover: {
        context: 'hover',
        label: '悬停',
        media: ENTRY_HOVER_MEDIA_QUERY,
        // :where 不增加 specificity；focus-within 同时命中时自然优先。
        selectorSuffix: ':where(:hover)',
    },
    'focus-within': {
        context: 'focus-within',
        label: '聚焦内部',
        media: null,
        selectorSuffix: ':focus-within',
    },
}

export interface ManagedConditionalSelectorIdentity extends ManagedNodeSelectorIdentity {
    context: ManagedNodeStyleContext
}

export function managedNodeIdentitySelector(nodeId: string, nodeKind: DocumentNodeKind): string {
    return `[data-fc-node-id="${nodeId.toLowerCase()}"][data-fc-node-kind="${nodeKind}"]`
}

export function managedNodeStyleTarget(
    nodeId: string,
    nodeKind: DocumentNodeKind,
    context: ManagedNodeStyleContext,
): {selector: string; media: string | null} {
    const definition = MANAGED_NODE_STYLE_CONTEXT_DEFINITIONS[context]
    return {
        selector: `${managedNodeIdentitySelector(nodeId, nodeKind)}${definition.selectorSuffix}`,
        media: definition.media,
    }
}

export function parseManagedNodeConditionalSelector(
    selector: string,
    media: string | null,
): ManagedConditionalSelectorIdentity | null {
    const trimmed = selector.trim()
    for (const context of MANAGED_NODE_STYLE_CONTEXTS) {
        const definition = MANAGED_NODE_STYLE_CONTEXT_DEFINITIONS[context]
        if (!cssMediaMatches(media, definition.media)) continue
        if (definition.selectorSuffix && !trimmed.endsWith(definition.selectorSuffix)) continue
        const base = definition.selectorSuffix
            ? trimmed.slice(0, -definition.selectorSuffix.length)
            : trimmed
        const identity = parseManagedNodeSelector(base)
        if (
            identity &&
            identity.nodeKind &&
            DOCUMENT_NODE_KINDS.includes(identity.nodeKind as DocumentNodeKind)
        ) {
            return {...identity, context}
        }
    }
    return null
}

export function isManagedNodeStyleContext(value: string): value is ManagedNodeStyleContext {
    return MANAGED_NODE_STYLE_CONTEXTS.includes(value as ManagedNodeStyleContext)
}
