// 这些测试固定查询单元的语义边界；只消费解析结果，不能修改作者源码或额外注入定位标记。
import assert from 'node:assert/strict'
import test from 'node:test'
import {parseHtmlSource} from './engine/htmlParser.ts'
import {createTextBlocks} from './engine/textBlocks.ts'

function blocks(body: string) {
    return createTextBlocks(
        parseHtmlSource(
            `<!doctype html><html><head><title>忽略 head</title></head><body>${body}</body></html>`,
            {mode: 'document', scope: 'project'},
        ),
    )
}

test('嵌套容器不重复计数，显式换行和源码换行都留在同一段落内', () => {
    const result = blocks(
        '<main><div><p data-fc-node-id="AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA">甲<br>乙\n丙</p><section><p>第二段</p></section></div></main>',
    )
    assert.deepEqual(
        result.map(block => block.text),
        ['甲\n乙\n丙', '第二段'],
    )
    assert.equal(result[0].nodeId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    assert.deepEqual(
        result.map(block => block.ordinal),
        [0, 1],
    )
})

test('列表项、嵌套列表和表格单元格保持文档序，不把整行或父列表重复收录', () => {
    const result = blocks(
        '<ul><li>父项<ul><li>子项</li></ul>尾部</li><li>第二项</li></ul><table><thead><tr><th>名称</th><th>状态</th></tr></thead><tbody><tr><td>雾港</td><td>开放</td></tr></tbody></table>',
    )
    assert.deepEqual(
        result.map(block => block.text),
        ['父项', '子项', '尾部', '第二项', '名称', '状态', '雾港', '开放'],
    )
    assert.deepEqual(
        result.slice(4).map(block => block.tag),
        ['th', 'th', 'td', 'td'],
    )
})

test('行内格式、链接、实体与 emoji 抽取为文字，不产生额外的 span 查询行', () => {
    const html = '<p>雾<span style="color:red">港🙂</span><a href="#"> &amp; &lt;潮汐&gt;</a></p>'
    const parsed = parseHtmlSource(html, {mode: 'fragment', scope: 'entry'})
    assert.deepEqual(
        createTextBlocks(parsed).map(block => block.text),
        ['雾港🙂 & <潮汐>'],
    )
    assert.equal(parsed.source, html)
})

test('标题摘要绑定可区分，图片替代文本和图注定位到已有素材节点', () => {
    const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const result = blocks(
        `<header><h1 data-fc-bind="title">标题</h1><p data-fc-bind="summary">简介</p></header><figure data-fc-node-id="${id}"><img alt="海图"><figcaption>图注<br>第二行</figcaption></figure>`,
    )
    assert.deepEqual(
        result.map(block => block.binding),
        ['title', 'summary', null, null],
    )
    assert.deepEqual(
        result.slice(2).map(block => [block.nodeId, block.tag, block.text]),
        [
            [id, 'img', '海图'],
            [id, 'figcaption', '图注\n第二行'],
        ],
    )
})

test('隐藏子树、模板、脚本、样式与空白均不进入查询；源码节点无需注入 ID', () => {
    const result = blocks(
        '<section hidden><p>隐藏</p></section><template><p>不渲染</p></template><script>不执行</script><style>不索引</style><div>直接文字<em>行内</em><p>段落</p>末尾</div><p>  \n </p>',
    )
    assert.deepEqual(
        result.map(block => block.text),
        ['直接文字行内', '段落', '末尾'],
    )
    assert.ok(result.every(block => block.nodeId === null))
})
