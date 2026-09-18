// 本测试固定公共组件定义字段、开放归属范围与 WebP 预览的运行时边界。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {
    createProjectComponentOwnershipScope,
    parsePublicComponentDefinition,
} from './publicComponent.ts'

const COMPONENT_ID = '11111111-1111-4111-8111-111111111111'
const PROJECT_ID = '22222222-2222-4222-8222-222222222222'
const ASSET_ID = '33333333-3333-4333-8333-333333333333'
const PREVIEW_ID = '44444444-4444-4444-8444-444444444444'

function definition() {
    return {
        componentId: COMPONENT_ID,
        revision: 3,
        html: '<div data-fc-part="avatar"></div>',
        css: '@layer fc-component { [data-fc-component="id"] { display: grid; } }',
        propertySchema: [{name: 'emphasis', valueType: 'boolean', required: false}],
        partSchema: [{name: 'avatar', accepts: ['asset'], required: false}],
        styleVariableSchema: [
            {name: '--card-accent', syntax: '<color>', initialValue: 'CanvasText'},
        ],
        assetDependencies: [ASSET_ID],
        name: '人物卡',
        category: '人物',
        preview: {assetId: PREVIEW_ID, mediaType: 'image/webp'},
        ownershipScope: {kind: 'project', id: PROJECT_ID},
    }
}

describe('public component definition contract', () => {
    it('解析并冻结组件定义的全部稳定字段', () => {
        const parsed = parsePublicComponentDefinition(definition())
        assert.equal(parsed.componentId, COMPONENT_ID)
        assert.equal(parsed.revision, 3)
        assert.equal(parsed.preview?.mediaType, 'image/webp')
        assert.deepEqual(parsed.assetDependencies, [ASSET_ID])
        assert.equal(Object.isFrozen(parsed), true)
        assert.equal(Object.isFrozen(parsed.propertySchema), true)
        assert.equal(Object.isFrozen(parsed.partSchema[0]?.accepts), true)
    })

    it('归属范围类型保持开放，但 0.2.0 的构造器只创建 project 范围', () => {
        assert.deepEqual(createProjectComponentOwnershipScope(PROJECT_ID), {
            kind: 'project',
            id: PROJECT_ID,
        })
        const future = definition()
        future.ownershipScope = {kind: 'future-scope', id: 'opaque:future:scope'}
        assert.deepEqual(parsePublicComponentDefinition(future).ownershipScope, future.ownershipScope)
    })

    it('拒绝重复 schema 名、非 WebP 预览与 project 的非 UUID 范围', () => {
        const duplicate = definition()
        duplicate.partSchema.push({name: 'avatar', accepts: ['text'], required: false})
        assert.throws(() => parsePublicComponentDefinition(duplicate), /part 名称不能重复/u)

        const png = definition()
        png.preview = {assetId: PREVIEW_ID, mediaType: 'image/png'}
        assert.throws(() => parsePublicComponentDefinition(png), /image\/webp/u)

        const invalidProject = definition()
        invalidProject.ownershipScope = {kind: 'project', id: 'not-a-uuid'}
        assert.throws(() => parsePublicComponentDefinition(invalidProject), /UUID/u)
    })

    it('拒绝未知顶层字段、非法属性名与重复资源依赖', () => {
        assert.throws(
            () => parsePublicComponentDefinition({...definition(), unknown: true}),
            /缺失或未知字段/u,
        )
        const invalidName = definition()
        invalidName.propertySchema[0].name = 'Bad_Name'
        assert.throws(() => parsePublicComponentDefinition(invalidName), /属性名称格式无效/u)
        const duplicateAsset = definition()
        duplicateAsset.assetDependencies.push(ASSET_ID)
        assert.throws(() => parsePublicComponentDefinition(duplicateAsset), /资源依赖不能重复/u)
    })
})
