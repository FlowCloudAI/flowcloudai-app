// 这些测试锁定图层与隔离画布共享同一选中身份，并拒绝投影外节点。

import assert from 'node:assert/strict'
import test from 'node:test'
import {createLayerProjection} from '../domain/layerProjection.ts'
import {resolveVisualSelection} from './visualSelectionModel.ts'

const NODE_ID = '0199f11b-e593-7a21-bf20-121688b899b8'
const projection = createLayerProjection(`<template data-fc-entry-patch>
  <template data-fc-fill="entry-body">
    <p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph">同步目标</p>
  </template>
</template>`)

test('图层选择与画布选择解析为同一个托管节点身份', () => {
    assert.equal(resolveVisualSelection(projection.nodes, NODE_ID.toUpperCase(), 'layer'), NODE_ID)
    assert.equal(resolveVisualSelection(projection.nodes, NODE_ID, 'canvas'), NODE_ID)
})

test('图层投影外的画布身份不能污染宿主选中态', () => {
    assert.equal(
        resolveVisualSelection(projection.nodes, '0199f11b-e593-7a21-bf20-121688b899b9', 'canvas'),
        null,
    )
})
