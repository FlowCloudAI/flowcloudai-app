// 这些测试固定组件树对托管节点与未纳入节点的作者用语，避免退回协议英文或源码标签。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {createLayerProjection} from '../../domain/layerProjection.ts'
import type {LayerProjectionNode} from '../../domain/layerProjection.ts'
import {pageDocumentLayerLabel} from './layerTreePresentation.ts'

describe('页面文档组件树文案', () => {
    it('托管节点显示中文类型与文字摘要', () => {
        const projection = createLayerProjection(
            '<p data-fc-node-id="0199f11b-e593-7a21-bf20-121688b899b8" data-fc-node-kind="paragraph">雾港正文</p>',
        )
        assert.equal(pageDocumentLayerLabel(projection.nodes[0]), '段落 · 雾港正文')
    })

    it('未纳入节点显示类型与文字摘要', () => {
        const projection = createLayerProjection('<p>仍由源码保留</p>')
        assert.equal(pageDocumentLayerLabel(projection.nodes[0]), '未纳入段落 · 仍由源码保留')
    })

    it('未知受管种类回退为通用作者措辞', () => {
        const unknown: LayerProjectionNode = {
            id: '11111111-1111-7111-8111-111111111111',
            label: 'component',
            kind: 'component',
            tagName: 'div',
            attributes: {},
            textContent: '',
            managed: true,
            range: null,
            children: [],
        }
        assert.equal(pageDocumentLayerLabel(unknown), '页面元素')
    })
})
