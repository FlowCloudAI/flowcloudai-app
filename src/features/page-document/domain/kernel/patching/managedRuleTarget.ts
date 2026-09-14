// 本模块定义受管节点规则的唯一选择器与条件身份；写入器和候选后置校验必须共用该描述。

import type {WriteChannel} from '../contracts/context.ts'
import type {ComponentSemanticPartId} from '../components/definitions.ts'
import {
    ENTRY_DESKTOP_MEDIA_QUERY,
    ENTRY_HOVER_MEDIA_QUERY,
    type DocumentNodeKind,
    type ManagedNodeStyleContext,
} from '../contracts/primitives.ts'

export interface ManagedRuleTarget {
    readonly selector: string
    readonly media: string | null
}

export function managedRuleTarget(
    nodeId: string,
    nodeKind: DocumentNodeKind,
    channel: Exclude<WriteChannel, {readonly kind: 'inline'}>,
    semanticPart: ComponentSemanticPartId | null = null,
): ManagedRuleTarget {
    const context = channel.kind === 'base-rule' ? 'mobile' : channel.context
    const condition = contextDefinition(context)
    const identity = `[data-fc-node-id="${nodeId.toLowerCase()}"][data-fc-node-kind="${nodeKind}"]`
    const subjects = semanticRuleSubjects(identity, semanticPart)
    return Object.freeze({
        selector: subjects.map(subject => `${subject}${condition.selectorSuffix}`).join(', '),
        media: condition.media,
    })
}

function semanticRuleSubjects(
    identity: string,
    semanticPart: ComponentSemanticPartId | null,
): readonly string[] {
    if (semanticPart === null || semanticPart === 'root') return [identity]
    if (semanticPart === 'asset-image') return [`${identity}:is(img)`, `${identity} img`]
    throw new TypeError(`语义部位 ${semanticPart} 尚不支持受管样式规则。`)
}

export function normalizeManagedCondition(value: string | null): string | null {
    return value === null ? null : value.replace(/\s+/gu, '').toLowerCase()
}

function contextDefinition(context: ManagedNodeStyleContext): {
    readonly media: string | null
    readonly selectorSuffix: string
} {
    switch (context) {
        case 'mobile':
            return {media: null, selectorSuffix: ''}
        case 'desktop':
            return {media: ENTRY_DESKTOP_MEDIA_QUERY, selectorSuffix: ''}
        case 'hover':
            return {media: ENTRY_HOVER_MEDIA_QUERY, selectorSuffix: ':where(:hover)'}
        case 'focus-within':
            return {media: null, selectorSuffix: ':focus-within'}
    }
}
