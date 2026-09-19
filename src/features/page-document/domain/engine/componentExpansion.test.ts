// 本测试从页面预览编译入口验证公共组件展开、索引边界与缺失状态。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {compilePreviewArtifact} from './previewCompiler.ts'
import {CANVAS_BASE_PROJECT_CSS, CANVAS_BASE_PROJECT_HTML} from '../../canvas/host/compiledPreview.ts'
import type {PublicComponentDefinitionContract} from '../kernel/contracts/publicComponent.ts'

const ENTRY_ID = '11111111-1111-4111-8111-111111111111'
const DEFINITION_ID = '22222222-2222-4222-8222-222222222222'
const ROOT_ID = '33333333-3333-4333-8333-333333333333'
const INSTANCE_A = '44444444-4444-4444-8444-444444444444'
const INSTANCE_B = '55555555-5555-4555-8555-555555555555'
const NODE_A = '66666666-6666-4666-8666-666666666666'
const NODE_B = '77777777-7777-4777-8777-777777777777'

function definition(overrides: Partial<PublicComponentDefinitionContract> = {}): PublicComponentDefinitionContract {
    return {
        componentId: DEFINITION_ID,
        revision: 1,
        html: '<article><h2>模板标题 {{title}}</h2><p data-fc-part="body">默认内容</p></article>',
        css: `@layer fc-component { [data-fc-component="${DEFINITION_ID}"] { display: grid; } }`,
        propertySchema: [{name: 'title', valueType: 'text', required: false}],
        partSchema: [{name: 'body', accepts: ['text'], required: false}],
        styleVariableSchema: [],
        assetDependencies: [],
        name: '测试卡片',
        category: '基础',
        preview: null,
        ownershipScope: {kind: 'project', id: '88888888-8888-4888-8888-888888888888'},
        ...overrides,
    }
}

function article(instances: string): string {
    return `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="entry-body"><div data-fc-node-id="${ROOT_ID}" data-fc-node-kind="container">${instances}<p data-fc-node-id="88888888-8888-4888-8888-888888888888" data-fc-node-kind="paragraph">页尾</p></div></template></template>`
}

function instance(nodeId: string, instanceId: string, title: string, body: string): string {
    return `<div data-fc-node-id="${nodeId}" data-fc-node-kind="component" data-fc-component="${DEFINITION_ID}" data-fc-component-revision="latest" data-fc-instance="${instanceId}" data-fc-prop-title="${title}"><span data-fc-part="body">${body}</span></div>`
}

function compile(html: string, definitions: readonly PublicComponentDefinitionContract[] = [definition()]) {
    return compilePreviewArtifact({
        projectArticleHtml: CANVAS_BASE_PROJECT_HTML,
        projectStyleCss: CANVAS_BASE_PROJECT_CSS,
        entryArticleHtml: html,
        entryStyleCss: '',
        metadata: {id: ENTRY_ID, title: '测试', summary: '', tags: []},
        assetIds: [],
        componentDefinitions: definitions,
    })
}

describe('公共组件编译期展开', () => {
    it('从真实预览入口展开属性和插槽，静态文字不进入段落索引', () => {
        const result = compile(article(instance(NODE_A, INSTANCE_A, '甲', '插槽甲')))
        assert.equal(result.diagnostics.filter(item => item.severity === 'error').length, 0)
        assert.match(result.srcdoc ?? '', /data-fc-component-state="resolved"/u)
        assert.match(result.srcdoc ?? '', /模板标题 <span data-fc-component-instance-content="">甲<\/span>/u)
        assert.deepEqual(
            result.textBlocks?.map(block => ({nodeId: block.nodeId, text: block.text})),
            [
                {nodeId: NODE_A, text: '甲'},
                {nodeId: NODE_A, text: '插槽甲'},
                {nodeId: '88888888-8888-4888-8888-888888888888', text: '页尾'},
            ],
        )
        assert.match(result.srcdoc ?? '', /data-fc-style-scope="component"/u)
    })

    it('同一定义的重复实例各自承载同名 part，并保持实例节点索引隔离', () => {
        const result = compile(article(
            instance(NODE_A, INSTANCE_A, '甲', '插槽甲') + instance(NODE_B, INSTANCE_B, '乙', '插槽乙'),
        ))
        assert.equal(result.diagnostics.filter(item => item.severity === 'error').length, 0)
        assert.equal((result.srcdoc ?? '').match(/data-fc-part="body"/gu)?.length, 2)
        assert.deepEqual(
            result.textBlocks?.filter(block => block.text.startsWith('插槽')).map(block => [block.nodeId, block.text]),
            [[NODE_A, '插槽甲'], [NODE_B, '插槽乙']],
        )
    })

    it('缺失定义保留实例并显示明确的缺失状态', () => {
        const result = compile(article(instance(NODE_A, INSTANCE_A, '甲', '插槽甲')), [])
        assert.equal(result.diagnostics.some(item => item.code === 'missing_component_definition'), true)
        assert.ok(result.srcdoc)
        assert.match(result.srcdoc, /data-fc-component-state="missing"/u)
        assert.match(result.srcdoc ?? '', new RegExp(`data-fc-component="${DEFINITION_ID}"`, 'u'))
    })

    it('固定旧修订从完整修订快照展开，latest 仍跟随最高修订', () => {
        const older = definition({
            revision: 1,
            html: '<article><h2>旧模板 {{title}}</h2><p data-fc-part="body">默认</p></article>',
        })
        const latest = definition({
            revision: 2,
            html: '<article><h2>新模板 {{title}}</h2><p data-fc-part="body">默认</p></article>',
        })
        const result = compile(
            article(instance(NODE_A, INSTANCE_A, '甲', '旧插槽'))
                .replace('data-fc-component-revision="latest"', 'data-fc-component-revision="1"'),
            [older, latest],
        )
        assert.equal(result.diagnostics.filter(item => item.severity === 'error').length, 0)
        assert.match(result.srcdoc ?? '', /旧模板/u)
        assert.doesNotMatch(result.srcdoc ?? '', /新模板/u)
    })

    it('定义携带页面节点身份时拒绝展开，不把身份泄漏到组件内部', () => {
        const result = compile(article(instance(NODE_A, INSTANCE_A, '甲', '插槽甲')), [
            definition({html: `<div data-fc-node-id="${NODE_B}"><p>不应展开</p></div>`}),
        ])
        assert.equal(result.diagnostics.some(item => item.code === 'component_definition_contains_page_identity'), true)
        assert.equal(result.srcdoc, null)
    })
})
