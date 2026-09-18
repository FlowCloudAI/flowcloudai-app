// 本测试验证源码身份归一化只改缺失与重复身份，并为保存链提供可诊断的确定结果。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {normalizeManagedNodeIdentities} from './nodeIdentityNormalization.ts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

describe('managed node identity normalization', () => {
    it('补齐缺失身份并保留未知合法源码与其余字节', () => {
        const source = `<template data-fc-entry-patch><!--keep--><p class='author' data-fc-node-kind="paragraph">正文 <span data-x="1">保留</span></p></template>`
        const result = normalizeManagedNodeIdentities(source, () => A)
        assert.equal(
            result.source,
            `<template data-fc-entry-patch><!--keep--><p class='author' data-fc-node-kind="paragraph" data-fc-node-id="${A}">正文 <span data-x="1">保留</span></p></template>`,
        )
        assert.equal(result.diagnostics[0]?.code, 'managed_node_id_assigned')
    })

    it('重复身份保留文档顺序中的第一个并仅替换后续属性', () => {
        const source = `<p data-fc-node-id='${A}' data-fc-node-kind="paragraph">一</p>\n<h2 data-fc-node-id="${A}" data-fc-node-kind="heading">二</h2>`
        const result = normalizeManagedNodeIdentities(source, () => B)
        assert.equal(
            result.source,
            `<p data-fc-node-id='${A}' data-fc-node-kind="paragraph">一</p>\n<h2 data-fc-node-id="${B}" data-fc-node-kind="heading">二</h2>`,
        )
        assert.equal(result.diagnostics[0]?.code, 'duplicate_node_id_reassigned')
        assert.deepEqual(result.diagnostics[0]?.details, {
            duplicateNodeId: A,
            assignedNodeId: B,
        })
    })

    it('分配器不得复用现有或退休身份', () => {
        const allocated = [A, B, C]
        const result = normalizeManagedNodeIdentities(
            '<p data-fc-node-kind="paragraph">正文</p>',
            () => allocated.shift() ?? C,
            [A, B],
        )
        assert.match(result.source, new RegExp(C, 'u'))
    })

    it('合法身份不改写，非法显式身份仍交给原契约拒绝', () => {
        const valid = `<p data-fc-node-id="${A}" data-fc-node-kind="paragraph">正文</p>`
        assert.deepEqual(normalizeManagedNodeIdentities(valid, () => B), {
            source: valid,
            changed: false,
            diagnostics: [],
        })
        const invalid = '<p data-fc-node-id="not-a-uuid" data-fc-node-kind="paragraph">正文</p>'
        assert.equal(normalizeManagedNodeIdentities(invalid, () => B).source, invalid)
    })
})
