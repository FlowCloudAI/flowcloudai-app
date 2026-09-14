// 这些测试固定只读图层投影对托管节点、操作组和不透明源码的边界。
import assert from 'node:assert/strict'
import test from 'node:test'
import {createLayerProjection} from './layerProjection.ts'

test('词条 patch 投影保留 operation 分组、托管容器层级和不透明源码节点', () => {
    const projection = createLayerProjection(`<template
  data-fc-entry-patch
  data-fc-document-version="1"
  data-fc-entry-id="11111111-1111-4111-8111-111111111111"
  data-fc-base-template-version="1"
>
  <template data-fc-fill="entry-body">
    <div data-custom-wrapper>
      <section data-fc-node-id="22222222-2222-4222-8222-222222222222" data-fc-node-kind="container">
        <p data-fc-node-id="33333333-3333-4333-8333-333333333333" data-fc-node-kind="paragraph">雾港<span>文本</span></p>
      </section>
    </div>
  </template>
</template>`)

    assert.equal(projection.nodes[0].kind, 'operation')
    assert.equal(projection.nodes[0].children[0].kind, 'source')
    assert.equal(projection.nodes[0].children[0].children[0].kind, 'container')
    assert.equal(projection.nodes[0].children[0].children[0].children[0].kind, 'paragraph')
    assert.match(projection.nodes[0].children[0].children[0].children[0].label, /雾港文本/u)
    assert.equal(projection.managedNodeCount, 2)
    assert.equal(projection.sourceNodeCount, 1)
})

test('已删除的信息 kind 与普通 aside 都作为不透明源码保留', () => {
    const projection = createLayerProjection(`<template data-fc-entry-patch>
  <template data-fc-fill="entry-body">
    <aside data-fc-node-id="33333333-3333-4333-8333-333333333333" data-fc-node-kind="info">旧信息块</aside>
    <aside>普通补充内容</aside>
  </template>
</template>`)
    const body = projection.nodes[0]
    assert.deepEqual(
        body.children.map(node => [node.kind, node.tagName]),
        [
            ['source', 'aside'],
            ['source', 'aside'],
        ],
    )
    assert.equal(projection.managedNodeCount, 0)
    assert.equal(projection.sourceNodeCount, 2)
})

test('非容器托管节点内部 span 不作为独立图层泄漏', () => {
    const projection = createLayerProjection(`<template data-fc-entry-patch>
  <template data-fc-fill="entry-body">
    <p data-fc-node-id="33333333-3333-4333-8333-333333333333" data-fc-node-kind="paragraph">
      正文<span style="color:red">格式</span>
    </p>
  </template>
</template>`)
    const paragraph = projection.nodes[0].children[0]
    assert.equal(paragraph.kind, 'paragraph')
    assert.deepEqual(paragraph.children, [])
})

test('段内 br 在图层纯文本中投影为一个换行字符', () => {
    const projection = createLayerProjection(`<template data-fc-entry-patch>
  <template data-fc-fill="entry-body">
    <p data-fc-node-id="33333333-3333-4333-8333-333333333333" data-fc-node-kind="paragraph">上<br>下</p>
  </template>
</template>`)
    const paragraph = projection.nodes[0].children[0]
    assert.equal(paragraph.textContent, '上\n下')
})

test('列表投影暴露独立列表项并允许整体折叠所需的层级', () => {
    const projection = createLayerProjection(`<template data-fc-entry-patch>
  <template data-fc-fill="entry-body">
    <ul data-fc-node-id="44444444-4444-4444-8444-444444444444" data-fc-node-kind="list">
      <li data-fc-node-id="55555555-5555-4555-8555-555555555555" data-fc-node-kind="list-item">第一项</li>
      <li data-fc-node-id="66666666-6666-4666-8666-666666666666" data-fc-node-kind="list-item">第二项</li>
    </ul>
  </template>
</template>`)
    const list = projection.nodes[0].children[0]
    assert.equal(list.kind, 'list')
    assert.deepEqual(
        list.children.map(node => node.kind),
        ['list-item', 'list-item'],
    )
    assert.deepEqual(
        list.children.map(node => node.textContent),
        ['第一项', '第二项'],
    )
    assert.equal(projection.managedNodeCount, 3)
})

test('表格投影隐藏 thead/tbody/tr 结构噪音并暴露稳定单元格', () => {
    const projection = createLayerProjection(`<template data-fc-entry-patch>
  <template data-fc-fill="entry-body">
    <table data-fc-node-id="44444444-4444-4444-8444-444444444444" data-fc-node-kind="table">
      <thead><tr><th data-fc-node-id="55555555-5555-4555-8555-555555555555" data-fc-node-kind="table-cell">名称</th></tr></thead>
      <tbody><tr><td data-fc-node-id="66666666-6666-4666-8666-666666666666" data-fc-node-kind="table-cell">雾港</td></tr></tbody>
    </table>
  </template>
</template>`)
    const table = projection.nodes[0].children[0]
    assert.equal(table.kind, 'table')
    assert.deepEqual(
        table.children.map(node => [node.kind, node.tagName, node.textContent]),
        [
            ['table-cell', 'th', '名称'],
            ['table-cell', 'td', '雾港'],
        ],
    )
    assert.equal(projection.sourceNodeCount, 0)
    assert.equal(projection.managedNodeCount, 3)
})
