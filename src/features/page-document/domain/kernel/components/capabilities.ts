// 本模块把组件能力候选落实为统一输入、目标、属性和值域契约；运行时适用性仍由来源感知属性分析决定。

import type {DocumentNodeKind} from '../contracts/primitives.ts'
import {componentDefinition, type ComponentCapabilityId} from './definitions.ts'

export type CapabilityTargetKind = 'component-root' | 'semantic-part' | 'text-range'
export type CapabilityIntentKind =
    | 'edit-property'
    | 'replace-text'
    | 'set-link'
    | 'split-text-block'
    | 'set-component-visibility'
    | 'set-component-tag'
    | 'set-asset-alt'
    | 'set-asset-caption'
    | 'set-asset-reference'
    | 'resize-table'
    | 'remove-component'
    | 'move-component'
    | 'insert-component'
    | 'set-grid-auto-placement'
    | 'change-grid-track-structure'
    | 'edit-structure'

export interface CapabilityDefinition {
    readonly id: ComponentCapabilityId
    readonly inputSchema: Readonly<{
        kind: 'property-edit' | 'content-edit' | 'structure-edit'
        targets: readonly CapabilityTargetKind[]
    }>
    readonly outputSchema: Readonly<{
        kind: 'edit-intents'
        intentKinds: readonly CapabilityIntentKind[]
    }>
    readonly supportedProperties: readonly string[]
    readonly valueDomain: 'css-value' | 'text' | 'structure'
    readonly semanticTargets: readonly string[]
    readonly applicabilityDependencies: readonly string[]
    readonly requiredReadDependencies: readonly string[]
    readonly generatedIntentKinds: readonly CapabilityIntentKind[]
}

const definitions = {
    'content.text': contentCapability('content.text', ['text-content']),
    'format.inline': propertyCapability(
        'format.inline',
        [
            'background-color',
            'color',
            'font-family',
            'font-size',
            'font-style',
            'font-weight',
            'letter-spacing',
            'text-decoration-color',
            'text-decoration-line',
            'text-decoration-style',
        ],
        ['text-range'],
        ['text-content'],
        ['inline-ancestors', 'author-cascade', 'selection-boundaries'],
        ['edit-property', 'set-link'],
    ),
    'format.paragraph': propertyCapability(
        'format.paragraph',
        [
            'font-family',
            'font-size',
            'font-style',
            'font-weight',
            'letter-spacing',
            'line-height',
            'text-align',
            'text-decoration-color',
            'text-decoration-line',
            'text-decoration-style',
            'text-indent',
        ],
        ['component-root'],
        ['root'],
        ['author-cascade', 'ancestors'],
    ),
    'structure.split': structureCapability('structure.split', ['text-content']),
    'structure.children': structureCapability('structure.children', ['root'], ['insert-component']),
    'structure.list-items': structureCapability(
        'structure.list-items',
        ['list-items'],
        ['insert-component'],
    ),
    'structure.table-size': structureCapability(
        'structure.table-size',
        ['table-cells'],
        ['resize-table'],
    ),
    'structure.visibility': structureCapability(
        'structure.visibility',
        ['root'],
        ['set-component-visibility'],
    ),
    'structure.tag': structureCapability('structure.tag', ['root'], ['set-component-tag']),
    'structure.remove': structureCapability('structure.remove', ['root'], ['remove-component']),
    'structure.move': structureCapability('structure.move', ['root'], ['move-component']),
    'appearance.width': propertyCapability(
        'appearance.width',
        ['height', 'max-height', 'max-width', 'min-height', 'min-width', 'width'],
        ['component-root'],
        ['root'],
        ['author-cascade', 'parent-layout'],
    ),
    'appearance.spacing': propertyCapability(
        'appearance.spacing',
        [
            'margin',
            'margin-block',
            'margin-block-end',
            'margin-block-start',
            'margin-inline',
            'margin-inline-end',
            'margin-inline-start',
            'padding',
            'padding-block',
            'padding-block-end',
            'padding-block-start',
            'padding-inline',
            'padding-inline-end',
            'padding-inline-start',
        ],
        ['component-root'],
        ['root'],
        ['author-cascade', 'writing-mode', 'direction'],
    ),
    'appearance.foreground': propertyCapability(
        'appearance.foreground',
        ['color'],
        ['component-root'],
        ['root'],
        ['author-cascade', 'ancestors'],
    ),
    'appearance.background': propertyCapability(
        'appearance.background',
        ['background-color', 'background-image'],
        ['component-root'],
        ['root'],
        ['author-cascade'],
    ),
    'appearance.border': propertyCapability(
        'appearance.border',
        ['border', 'border-color', 'border-style', 'border-width'],
        ['component-root'],
        ['root'],
        ['author-cascade'],
    ),
    'appearance.radius': propertyCapability(
        'appearance.radius',
        ['border-radius'],
        ['component-root'],
        ['root'],
        ['author-cascade'],
    ),
    'appearance.shadow': propertyCapability(
        'appearance.shadow',
        ['box-shadow'],
        ['component-root'],
        ['root'],
        ['author-cascade'],
    ),
    'appearance.effects': propertyCapability(
        'appearance.effects',
        ['filter', 'opacity', 'overflow', 'rotate', 'visibility'],
        ['component-root'],
        ['root'],
        ['author-cascade'],
    ),
    'layout.container': propertyCapability(
        'layout.container',
        [
            'align-content',
            'align-items',
            'columns',
            'column-count',
            'column-gap',
            'column-width',
            'display',
            'flex-flow',
            'flex-direction',
            'flex-wrap',
            'gap',
            'grid-auto-flow',
            'grid-template-areas',
            'grid-template-columns',
            'grid-template-rows',
            'justify-content',
            'justify-items',
            'place-content',
            'place-items',
            'row-gap',
        ],
        ['component-root'],
        ['root'],
        ['author-cascade', 'children', 'viewport'],
        ['edit-property', 'change-grid-track-structure'],
    ),
    'layout.child': propertyCapability(
        'layout.child',
        [
            'align-self',
            'flex',
            'flex-basis',
            'flex-grow',
            'flex-shrink',
            'grid-area',
            'grid-column',
            'grid-column-end',
            'grid-column-start',
            'grid-row',
            'grid-row-end',
            'grid-row-start',
            'justify-self',
        ],
        ['component-root'],
        ['root'],
        ['author-cascade', 'parent-layout', 'viewport'],
        ['edit-property', 'set-grid-auto-placement'],
    ),
    'asset.reference': contentCapability(
        'asset.reference',
        ['asset-image'],
        ['set-asset-reference'],
        ['component-root'],
    ),
    'asset.alt': contentCapability(
        'asset.alt',
        ['asset-image'],
        ['set-asset-alt'],
        ['component-root'],
    ),
    'asset.crop': propertyCapability(
        'asset.crop',
        ['aspect-ratio', 'filter', 'object-fit', 'object-position'],
        ['semantic-part'],
        ['asset-image'],
        ['author-cascade', 'asset-image'],
    ),
    'asset.wrap': propertyCapability(
        'asset.wrap',
        ['float', 'margin-block-end', 'margin-inline-end', 'margin-inline-start', 'width'],
        ['component-root'],
        ['root'],
        ['author-cascade', 'parent-layout', 'viewport'],
    ),
    'asset.caption': contentCapability(
        'asset.caption',
        ['asset-caption'],
        ['set-asset-caption'],
        ['component-root'],
    ),
    'divider.line': propertyCapability(
        'divider.line',
        ['border-color', 'border-style', 'border-width'],
        ['component-root'],
        ['root'],
        ['author-cascade'],
    ),
} as const satisfies Record<ComponentCapabilityId, CapabilityDefinition>

export const CAPABILITY_DEFINITIONS: Readonly<Record<ComponentCapabilityId, CapabilityDefinition>> =
    Object.freeze(definitions)

export function capabilityDefinition(id: ComponentCapabilityId): CapabilityDefinition {
    return CAPABILITY_DEFINITIONS[id]
}

export function propertyCapabilityForComponent(
    kind: DocumentNodeKind,
    target: CapabilityTargetKind,
    property: string,
): CapabilityDefinition | null {
    for (const id of componentDefinition(kind).capabilityCandidates) {
        const capability = capabilityDefinition(id)
        if (
            capability.inputSchema.kind === 'property-edit' &&
            capability.inputSchema.targets.includes(target) &&
            capability.supportedProperties.includes(property)
        ) {
            return capability
        }
    }
    return null
}

function propertyCapability(
    id: ComponentCapabilityId,
    supportedProperties: readonly string[],
    targets: readonly CapabilityTargetKind[],
    semanticTargets: readonly string[],
    dependencies: readonly string[],
    generatedIntentKinds: readonly CapabilityIntentKind[] = ['edit-property'],
): CapabilityDefinition {
    return freezeCapability({
        id,
        inputSchema: {kind: 'property-edit', targets},
        outputSchema: {kind: 'edit-intents', intentKinds: generatedIntentKinds},
        supportedProperties,
        valueDomain: 'css-value',
        semanticTargets,
        applicabilityDependencies: dependencies,
        requiredReadDependencies: dependencies,
        generatedIntentKinds,
    })
}

function contentCapability(
    id: ComponentCapabilityId,
    semanticTargets: readonly string[],
    intentKinds: readonly CapabilityIntentKind[] = ['replace-text'],
    targets: readonly CapabilityTargetKind[] = ['semantic-part'],
): CapabilityDefinition {
    return freezeCapability({
        id,
        inputSchema: {kind: 'content-edit', targets},
        outputSchema: {kind: 'edit-intents', intentKinds},
        supportedProperties: [],
        valueDomain: 'text',
        semanticTargets,
        applicabilityDependencies: ['component-structure'],
        requiredReadDependencies: ['component-structure', 'source-origin'],
        generatedIntentKinds: intentKinds,
    })
}

function structureCapability(
    id: ComponentCapabilityId,
    semanticTargets: readonly string[],
    intentKinds: readonly CapabilityIntentKind[] = id === 'structure.split'
        ? ['split-text-block']
        : ['edit-structure'],
): CapabilityDefinition {
    return freezeCapability({
        id,
        inputSchema: {
            kind: 'structure-edit',
            targets:
                id === 'structure.split' ? ['text-range'] : ['component-root', 'semantic-part'],
        },
        outputSchema: {
            kind: 'edit-intents',
            intentKinds,
        },
        supportedProperties: [],
        valueDomain: 'structure',
        semanticTargets,
        applicabilityDependencies: ['component-structure', 'children'],
        requiredReadDependencies: ['component-structure', 'children', 'source-origin'],
        generatedIntentKinds: intentKinds,
    })
}

function freezeCapability(value: CapabilityDefinition): CapabilityDefinition {
    return Object.freeze({
        ...value,
        inputSchema: Object.freeze({
            ...value.inputSchema,
            targets: Object.freeze([...value.inputSchema.targets]),
        }),
        outputSchema: Object.freeze({
            ...value.outputSchema,
            intentKinds: Object.freeze([...value.outputSchema.intentKinds]),
        }),
        supportedProperties: Object.freeze([...value.supportedProperties]),
        semanticTargets: Object.freeze([...value.semanticTargets]),
        applicabilityDependencies: Object.freeze([...value.applicabilityDependencies]),
        requiredReadDependencies: Object.freeze([...value.requiredReadDependencies]),
        generatedIntentKinds: Object.freeze([...value.generatedIntentKinds]),
    })
}
