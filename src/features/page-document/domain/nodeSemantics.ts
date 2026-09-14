// 本模块为旧调用点提供组件语义薄入口；规则唯一来源是文档内核的组件定义注册表。

import type {DocumentMutableNodeTag, DocumentNodeKind} from './contract.ts'
import {
    EDITABLE_TEXT_NODE_KINDS,
    INLINE_FORMAT_NODE_KINDS,
    SPLITTABLE_TEXT_NODE_KINDS,
    canComponentContain,
    componentDefinition,
    inferComponentKindFromTag,
    isComponentTagCompatible,
} from './kernel/components/index.ts'

export {EDITABLE_TEXT_NODE_KINDS, INLINE_FORMAT_NODE_KINDS, SPLITTABLE_TEXT_NODE_KINDS}

export function isEditableTextNodeKind(
    kind: string | undefined,
): kind is (typeof EDITABLE_TEXT_NODE_KINDS)[number] {
    return EDITABLE_TEXT_NODE_KINDS.includes(kind as (typeof EDITABLE_TEXT_NODE_KINDS)[number])
}

export function isInlineFormatNodeKind(
    kind: string | undefined,
): kind is (typeof INLINE_FORMAT_NODE_KINDS)[number] {
    return INLINE_FORMAT_NODE_KINDS.includes(kind as (typeof INLINE_FORMAT_NODE_KINDS)[number])
}

export function isSplittableTextNodeKind(
    kind: string | undefined,
): kind is (typeof SPLITTABLE_TEXT_NODE_KINDS)[number] {
    return SPLITTABLE_TEXT_NODE_KINDS.includes(kind as (typeof SPLITTABLE_TEXT_NODE_KINDS)[number])
}

export function projectsManagedChildren(kind: DocumentNodeKind): boolean {
    return componentDefinition(kind).projectsManagedChildren
}

export function canContainManagedNode(
    parentKind: DocumentNodeKind,
    childKind: DocumentNodeKind,
): boolean {
    return canComponentContain(parentKind, childKind)
}

export function isManagedNodeTagCompatible(kind: DocumentNodeKind, tagName: string): boolean {
    return isComponentTagCompatible(kind, tagName)
}

export function inferManagedNodeKindFromTag(tagName: string | null): DocumentNodeKind | null {
    return inferComponentKindFromTag(tagName)
}

export function isMutableNodeTag(value: string): value is DocumentMutableNodeTag {
    return /^(?:h[2-6]|ul|ol)$/u.test(value)
}
