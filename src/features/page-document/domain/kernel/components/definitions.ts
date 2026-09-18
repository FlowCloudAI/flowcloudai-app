// 本模块集中声明托管组件的标签、语义部位、子组件边界、能力候选与创建参数；运行时能力仍由上下文分析决定。

import {
    DOCUMENT_NODE_KINDS,
    type DocumentMutableNodeTag,
    type DocumentNodeKind,
} from '../contracts/primitives.ts'

export const COMPONENT_CAPABILITY_IDS = [
    'content.text',
    'format.inline',
    'format.paragraph',
    'structure.split',
    'structure.children',
    'structure.list-items',
    'structure.table-size',
    'structure.visibility',
    'structure.tag',
    'structure.remove',
    'structure.move',
    'appearance.width',
    'appearance.spacing',
    'appearance.foreground',
    'appearance.background',
    'appearance.border',
    'appearance.radius',
    'appearance.shadow',
    'appearance.effects',
    'layout.container',
    'layout.child',
    'asset.reference',
    'asset.alt',
    'asset.crop',
    'asset.wrap',
    'asset.caption',
    'divider.line',
] as const

export type ComponentCapabilityId = (typeof COMPONENT_CAPABILITY_IDS)[number]
export type ComponentSemanticPartId =
    'root' | 'text-content' | 'asset-image' | 'asset-caption' | 'list-items' | 'table-cells'

export interface ComponentSemanticPartDefinition {
    readonly id: ComponentSemanticPartId
    readonly target:
        | {readonly kind: 'self'}
        | {readonly kind: 'self-or-unique-descendant'; readonly tag: string}
        | {readonly kind: 'optional-direct-child'; readonly tag: string}
        | {readonly kind: 'managed-children'; readonly childKind: DocumentNodeKind}
}

export interface ComponentCreationDefinition {
    readonly rootTag: string
    readonly requiredInputs: readonly ('assetId' | 'listItemId' | 'tableCellIds')[]
}

export interface ComponentDefinition {
    readonly kind: DocumentNodeKind
    readonly compatibleTags: readonly string[]
    readonly autoAdoptTags: readonly string[]
    readonly semanticParts: readonly ComponentSemanticPartDefinition[]
    readonly capabilityCandidates: readonly ComponentCapabilityId[]
    readonly allowedManagedChildren: readonly DocumentNodeKind[]
    readonly projectsManagedChildren: boolean
    readonly creation: ComponentCreationDefinition | null
    readonly conversionTags: readonly DocumentMutableNodeTag[]
}

const COMMON_COMPONENT_CAPABILITIES = [
    'structure.visibility',
    'structure.remove',
    'structure.move',
    'appearance.width',
    'appearance.spacing',
    'appearance.foreground',
    'appearance.background',
    'appearance.border',
    'appearance.radius',
    'appearance.shadow',
    'appearance.effects',
    'layout.child',
] as const satisfies readonly ComponentCapabilityId[]

const TEXT_CAPABILITIES = [
    'content.text',
    'format.inline',
    'format.paragraph',
] as const satisfies readonly ComponentCapabilityId[]

export const EDITABLE_TEXT_NODE_KINDS = [
    'paragraph',
    'heading',
    'list-item',
    'table-cell',
] as const satisfies readonly DocumentNodeKind[]

export const INLINE_FORMAT_NODE_KINDS = EDITABLE_TEXT_NODE_KINDS

export const SPLITTABLE_TEXT_NODE_KINDS = [
    'paragraph',
    'heading',
    'list-item',
] as const satisfies readonly DocumentNodeKind[]

export const INSERTABLE_COMPONENT_KINDS = [
    'container',
    'paragraph',
    'heading',
    'list',
    'table',
    'asset',
    'gallery',
    'divider',
] as const satisfies readonly Exclude<DocumentNodeKind, 'list-item' | 'table-cell' | 'component'>[]

const definitions = {
    paragraph: definition({
        kind: 'paragraph',
        compatibleTags: ['p'],
        autoAdoptTags: ['p'],
        semanticParts: [self('root'), self('text-content')],
        capabilityCandidates: [
            ...COMMON_COMPONENT_CAPABILITIES,
            ...TEXT_CAPABILITIES,
            'structure.split',
        ],
        creation: creation('p'),
    }),
    heading: definition({
        kind: 'heading',
        compatibleTags: ['h2', 'h3', 'h4', 'h5', 'h6'],
        autoAdoptTags: ['h2', 'h3', 'h4', 'h5', 'h6'],
        semanticParts: [self('root'), self('text-content')],
        capabilityCandidates: [
            ...COMMON_COMPONENT_CAPABILITIES,
            ...TEXT_CAPABILITIES,
            'structure.split',
            'structure.tag',
        ],
        creation: creation('h2'),
        conversionTags: ['h2', 'h3', 'h4', 'h5', 'h6'],
    }),
    list: definition({
        kind: 'list',
        compatibleTags: ['ul', 'ol'],
        autoAdoptTags: ['ul', 'ol'],
        semanticParts: [self('root'), managedChildren('list-items', 'list-item')],
        capabilityCandidates: [
            ...COMMON_COMPONENT_CAPABILITIES,
            'structure.children',
            'structure.list-items',
            'structure.tag',
        ],
        allowedManagedChildren: ['list-item'],
        projectsManagedChildren: true,
        creation: creation('ul', ['listItemId']),
        conversionTags: ['ul', 'ol'],
    }),
    'list-item': definition({
        kind: 'list-item',
        compatibleTags: ['li'],
        autoAdoptTags: ['li'],
        semanticParts: [self('root'), self('text-content')],
        capabilityCandidates: [
            ...COMMON_COMPONENT_CAPABILITIES,
            ...TEXT_CAPABILITIES,
            'structure.split',
        ],
        creation: creation('li'),
    }),
    table: definition({
        kind: 'table',
        compatibleTags: ['table'],
        autoAdoptTags: [],
        semanticParts: [self('root'), managedChildren('table-cells', 'table-cell')],
        capabilityCandidates: [
            ...COMMON_COMPONENT_CAPABILITIES,
            'structure.children',
            'structure.table-size',
        ],
        allowedManagedChildren: ['table-cell'],
        projectsManagedChildren: true,
        creation: creation('table', ['tableCellIds']),
    }),
    'table-cell': definition({
        kind: 'table-cell',
        compatibleTags: ['th', 'td'],
        autoAdoptTags: [],
        semanticParts: [self('root'), self('text-content')],
        capabilityCandidates: [...COMMON_COMPONENT_CAPABILITIES, ...TEXT_CAPABILITIES],
        creation: null,
    }),
    asset: definition({
        kind: 'asset',
        compatibleTags: ['figure', 'img'],
        autoAdoptTags: ['figure', 'img'],
        semanticParts: [
            self('root'),
            {id: 'asset-image', target: {kind: 'self-or-unique-descendant', tag: 'img'}},
            {id: 'asset-caption', target: {kind: 'optional-direct-child', tag: 'figcaption'}},
        ],
        capabilityCandidates: [
            ...COMMON_COMPONENT_CAPABILITIES,
            'asset.reference',
            'asset.alt',
            'asset.crop',
            'asset.wrap',
            'asset.caption',
        ],
        creation: creation('figure', ['assetId']),
    }),
    gallery: definition({
        kind: 'gallery',
        compatibleTags: ['section'],
        autoAdoptTags: [],
        semanticParts: [self('root')],
        capabilityCandidates: COMMON_COMPONENT_CAPABILITIES,
        creation: creation('section'),
    }),
    divider: definition({
        kind: 'divider',
        compatibleTags: ['hr'],
        autoAdoptTags: ['hr'],
        semanticParts: [self('root')],
        capabilityCandidates: [...COMMON_COMPONENT_CAPABILITIES, 'divider.line'],
        creation: creation('hr'),
    }),
    container: definition({
        kind: 'container',
        compatibleTags: ['div', 'main', 'section'],
        autoAdoptTags: ['div', 'main', 'section'],
        semanticParts: [self('root')],
        capabilityCandidates: [
            ...COMMON_COMPONENT_CAPABILITIES,
            'structure.children',
            'layout.container',
        ],
        allowedManagedChildren: DOCUMENT_NODE_KINDS.filter(
            kind => kind !== 'list-item' && kind !== 'table-cell',
        ),
        projectsManagedChildren: true,
        creation: creation('div'),
    }),
    component: definition({
        kind: 'component',
        compatibleTags: ['div'],
        autoAdoptTags: [],
        semanticParts: [self('root')],
        capabilityCandidates: [],
        creation: null,
    }),
} as const satisfies Record<DocumentNodeKind, ComponentDefinition>

export const COMPONENT_DEFINITIONS: Readonly<Record<DocumentNodeKind, ComponentDefinition>> =
    Object.freeze(definitions)

export function componentDefinition(kind: DocumentNodeKind): ComponentDefinition {
    return COMPONENT_DEFINITIONS[kind]
}

export function componentHasCapability(
    kind: DocumentNodeKind,
    capability: ComponentCapabilityId,
): boolean {
    return componentDefinition(kind).capabilityCandidates.includes(capability)
}

export function isComponentTagCompatible(kind: DocumentNodeKind, tagName: string): boolean {
    return componentDefinition(kind).compatibleTags.includes(tagName.toLowerCase())
}

export function canComponentContain(
    parentKind: DocumentNodeKind,
    childKind: DocumentNodeKind,
): boolean {
    return componentDefinition(parentKind).allowedManagedChildren.includes(childKind)
}

/** 自动接管只接受唯一声明的映射；同一标签出现多个候选时保持为不透明源码。 */
export function inferComponentKindFromTag(tagName: string | null): DocumentNodeKind | null {
    const tag = tagName?.toLowerCase()
    if (!tag || tag === 'h1') return null
    const matches = DOCUMENT_NODE_KINDS.filter(kind =>
        componentDefinition(kind).autoAdoptTags.includes(tag),
    )
    return matches.length === 1 ? matches[0] : null
}

function self(id: 'root' | 'text-content'): ComponentSemanticPartDefinition {
    return {id, target: {kind: 'self'}}
}

function managedChildren(
    id: 'list-items' | 'table-cells',
    childKind: DocumentNodeKind,
): ComponentSemanticPartDefinition {
    return {id, target: {kind: 'managed-children', childKind}}
}

function creation(
    rootTag: string,
    requiredInputs: ComponentCreationDefinition['requiredInputs'] = [],
): ComponentCreationDefinition {
    return {rootTag, requiredInputs}
}

function definition(
    value: Omit<
        ComponentDefinition,
        'allowedManagedChildren' | 'projectsManagedChildren' | 'conversionTags'
    > &
        Partial<
            Pick<
                ComponentDefinition,
                'allowedManagedChildren' | 'projectsManagedChildren' | 'conversionTags'
            >
        >,
): ComponentDefinition {
    return Object.freeze({
        ...value,
        compatibleTags: Object.freeze([...value.compatibleTags]),
        autoAdoptTags: Object.freeze([...value.autoAdoptTags]),
        semanticParts: Object.freeze([...value.semanticParts]),
        capabilityCandidates: Object.freeze([...value.capabilityCandidates]),
        allowedManagedChildren: Object.freeze([...(value.allowedManagedChildren ?? [])]),
        projectsManagedChildren: value.projectsManagedChildren ?? false,
        conversionTags: Object.freeze([...(value.conversionTags ?? [])]),
    })
}
