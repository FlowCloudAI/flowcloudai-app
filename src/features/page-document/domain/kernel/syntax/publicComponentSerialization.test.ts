// 本测试固定公共组件实例的 v1 HTML 形状，并区分实例 part 与项目模板 slot 的作用域。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {DOCUMENT_VERSION} from '../contracts/primitives.ts'
import {parseHtmlSource} from './htmlContract.ts'

const DEFINITION_ID = '11111111-1111-4111-8111-111111111111'
const NODE_A = '22222222-2222-4222-8222-222222222222'
const NODE_B = '33333333-3333-4333-8333-333333333333'
const INSTANCE_A = '44444444-4444-4444-8444-444444444444'
const INSTANCE_B = '55555555-5555-4555-8555-555555555555'

function instance(nodeId: string, instanceId: string, body: string): string {
    return `<div data-fc-node-id="${nodeId}" data-fc-node-kind="component" data-fc-component="${DEFINITION_ID}" data-fc-component-revision="latest" data-fc-instance="${instanceId}" data-fc-prop-emphasis="true" style="--card-accent: CanvasText">${body}</div>`
}

describe('public component instance serialization', () => {
    it('组件实例是页面节点，引用、修订、实例、逐属性配置与样式变量通过 v1 契约', () => {
        const parsed = parseHtmlSource(
            instance(NODE_A, INSTANCE_A, '<span data-fc-part="avatar">头像</span>'),
            {mode: 'fragment', scope: 'entry'},
        )
        assert.equal(DOCUMENT_VERSION, 1)
        assert.deepEqual(parsed.diagnostics, [])
    })

    it('同名 part 可在不同实例重复，但同一实例内必须唯一', () => {
        const crossInstance = parseHtmlSource(
            `${instance(NODE_A, INSTANCE_A, '<span data-fc-part="avatar">甲</span>')}${instance(NODE_B, INSTANCE_B, '<span data-fc-part="avatar">乙</span>')}`,
            {mode: 'fragment', scope: 'entry'},
        )
        assert.deepEqual(crossInstance.diagnostics, [])

        const duplicate = parseHtmlSource(
            instance(
                NODE_A,
                INSTANCE_A,
                '<span data-fc-part="avatar">甲</span><span data-fc-part="avatar">乙</span>',
            ),
            {mode: 'fragment', scope: 'entry'},
        )
        assert.equal(
            duplicate.diagnostics.some(item => item.code === 'duplicate_component_part'),
            true,
        )
    })

    it('data-fc-slot 仍按项目模板全局唯一，不与实例 part 共用规则', () => {
        const project = parseHtmlSource(
            `<!doctype html><html data-fc-document-version="1" data-fc-template-version="1"><head><title>测试</title></head><body><main data-fc-slot="body"></main><aside data-fc-slot="body"></aside></body></html>`,
            {mode: 'document', scope: 'project'},
        )
        assert.equal(project.diagnostics.some(item => item.code === 'duplicate_slot'), true)
    })

    it('拒绝缺失组件字段、孤立 part、非法 prop 名与实例内部页面节点', () => {
        const missing = parseHtmlSource(
            `<div data-fc-node-id="${NODE_A}" data-fc-node-kind="component"></div>`,
            {mode: 'fragment', scope: 'entry'},
        )
        assert.deepEqual(
            new Set(missing.diagnostics.map(item => item.code)),
            new Set([
                'invalid_component_reference',
                'invalid_component_revision',
                'invalid_component_instance_id',
            ]),
        )

        const malformed = parseHtmlSource(
            `${instance(NODE_A, INSTANCE_A, `<span data-fc-part="Bad_Name"></span><p data-fc-node-id="${NODE_B}" data-fc-node-kind="paragraph">内部</p>`)}<span data-fc-part="avatar"></span><p data-fc-prop-bad="x"></p>`,
            {mode: 'fragment', scope: 'entry'},
        )
        const codes = new Set(malformed.diagnostics.map(item => item.code))
        assert.equal(codes.has('invalid_component_part_name'), true)
        assert.equal(codes.has('invalid_managed_parent'), true)
        assert.equal(codes.has('orphan_component_part'), true)
        assert.equal(codes.has('orphan_component_attribute'), true)
    })

    it('固定修订必须是正安全整数且实例身份在文档内唯一', () => {
        const invalidRevision = parseHtmlSource(
            instance(NODE_A, INSTANCE_A, '').replace(
                'data-fc-component-revision="latest"',
                'data-fc-component-revision="9007199254740993"',
            ),
            {mode: 'fragment', scope: 'entry'},
        )
        assert.equal(
            invalidRevision.diagnostics.some(item => item.code === 'invalid_component_revision'),
            true,
        )

        const duplicateInstance = parseHtmlSource(
            `${instance(NODE_A, INSTANCE_A, '')}${instance(NODE_B, INSTANCE_A, '')}`,
            {mode: 'fragment', scope: 'entry'},
        )
        assert.equal(
            duplicateInstance.diagnostics.some(
                item => item.code === 'duplicate_component_instance_id',
            ),
            true,
        )
    })
})
