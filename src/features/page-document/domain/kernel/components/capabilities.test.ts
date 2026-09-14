// 本模块验证组件候选能力、属性目标和值域契约使用同一份能力定义。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {
    CAPABILITY_DEFINITIONS,
    capabilityDefinition,
    propertyCapabilityForComponent,
} from './capabilities.ts'
import {COMPONENT_DEFINITIONS} from './definitions.ts'

describe('kernel capability definitions', () => {
    it('每个组件候选都有冻结且完整的能力契约', () => {
        for (const component of Object.values(COMPONENT_DEFINITIONS)) {
            for (const id of component.capabilityCandidates) {
                const capability = capabilityDefinition(id)
                assert.equal(capability.id, id)
                assert.equal(Object.isFrozen(capability), true)
                assert.equal(Object.isFrozen(capability.inputSchema.targets), true)
                assert.equal(Object.isFrozen(capability.requiredReadDependencies), true)
                assert.ok(capability.semanticTargets.length > 0)
            }
        }
        assert.deepEqual(
            Object.keys(CAPABILITY_DEFINITIONS).sort(),
            [
                ...new Set(
                    Object.values(COMPONENT_DEFINITIONS).flatMap(item => item.capabilityCandidates),
                ),
            ].sort(),
        )
    })

    it('按组件、语义目标和属性联合决定能力而不使用全局开关', () => {
        assert.equal(
            propertyCapabilityForComponent('paragraph', 'component-root', 'width')?.id,
            'appearance.width',
        )
        assert.equal(
            propertyCapabilityForComponent('paragraph', 'component-root', 'font-weight')?.id,
            'format.paragraph',
        )
        assert.equal(
            propertyCapabilityForComponent('paragraph', 'text-range', 'font-weight')?.id,
            'format.inline',
        )
        assert.equal(propertyCapabilityForComponent('paragraph', 'component-root', 'gap'), null)
        assert.equal(
            propertyCapabilityForComponent('container', 'component-root', 'gap')?.id,
            'layout.container',
        )
        assert.equal(
            propertyCapabilityForComponent('asset', 'semantic-part', 'object-fit')?.id,
            'asset.crop',
        )
        assert.equal(
            propertyCapabilityForComponent('asset', 'component-root', 'float')?.id,
            'asset.wrap',
        )
        assert.equal(propertyCapabilityForComponent('asset', 'component-root', 'object-fit'), null)
        assert.equal(propertyCapabilityForComponent('container', 'text-range', 'color'), null)
        assert.deepEqual(capabilityDefinition('structure.remove').generatedIntentKinds, [
            'remove-component',
        ])
        assert.deepEqual(capabilityDefinition('structure.move').generatedIntentKinds, [
            'move-component',
        ])
        assert.deepEqual(capabilityDefinition('structure.children').generatedIntentKinds, [
            'insert-component',
        ])
        assert.deepEqual(capabilityDefinition('structure.list-items').generatedIntentKinds, [
            'insert-component',
        ])
        assert.deepEqual(capabilityDefinition('layout.child').generatedIntentKinds, [
            'edit-property',
            'set-grid-auto-placement',
        ])
        assert.deepEqual(capabilityDefinition('layout.container').generatedIntentKinds, [
            'edit-property',
            'change-grid-track-structure',
        ])
    })
})
