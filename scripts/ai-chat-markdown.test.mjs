/**
 * AI 回复可渲染化管线：桌面端与移动端共用同一份实现，这里钉住它的行为。
 *
 * 这条管线在 2026-08 之前只存在于桌面端 AIChatContent.tsx 内部，移动端渲染的是原始文本，
 * 于是 `[[标题]]` 在手机上是一段字面量、`fc://` 链接点下去没反应。抽到
 * features/ai-chat/lib/aiChatMarkdown.ts 之后两端共用，本测试防止它再被拆回去或改坏。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
    AI_CHAT_ENTRY_LINK_PREFIX,
    buildRenderableAiChatBlocks,
    buildRenderableAiChatMarkdown,
    parseAiChatEntryHref,
} from '../src/features/ai-chat/lib/aiChatMarkdown.ts'

test('[[双链]] 被改写成同文档 hash 链接，而不是留成字面量', () => {
    const output = buildRenderableAiChatMarkdown('参见 [[纪远舟]] 的设定。')
    assert.match(output, /\[纪远舟]\(#fc-entry-link\?/)
    // 关键点：改写结果必须是 # 开头的同文档链接，否则会触发顶层导航把应用打没。
    assert.ok(output.includes(AI_CHAT_ENTRY_LINK_PREFIX))
})

test('fc:// 词条链接被改写，且能原样解析回项目与词条 ID', () => {
    const href = 'fc://proj-1/entry/entry-9'
    const output = buildRenderableAiChatMarkdown(`见 [纪远舟](${href})`)
    const rewritten = output.match(/\((#fc-entry-link\?[^)]*)\)/)?.[1]
    assert.ok(rewritten, '未生成改写后的链接')

    const link = parseAiChatEntryHref(rewritten, '')
    assert.equal(link?.projectId, 'proj-1')
    assert.equal(link?.entryId, 'entry-9')
    assert.equal(link?.title, '纪远舟')
})

test('普通外链与代码不受影响', () => {
    const source = '见 [官网](https://example.com) 与 `[[不是链接]]`'
    // 只改写词条协议与 [[]]，http 链接原样保留。
    assert.match(buildRenderableAiChatMarkdown(source), /\[官网]\(https:\/\/example\.com\)/)
})

test('parseAiChatEntryHref 对非词条链接返回 null', () => {
    assert.equal(parseAiChatEntryHref('https://example.com', ''), null)
    assert.equal(parseAiChatEntryHref('#heading', ''), null)
})

test('会话结束后给悬挂的工具调用收尾，进行中的不动', () => {
    const blocks = [
        {type: 'tool', tool: {name: 'search', result: null}},
        {type: 'tool_use', tools: [{name: 'write', result: null}]},
    ]

    const finalized = buildRenderableAiChatBlocks(blocks, true)
    assert.equal(finalized[0].tool.result, '会话已结束，未返回工具结果。')
    assert.equal(finalized[1].tools[0].result, '会话已结束，未返回工具结果。')

    // 续写进行中时不能收尾，否则活着的工具调用会被标成「已结束」。
    const streaming = buildRenderableAiChatBlocks(blocks, false)
    assert.equal(streaming[0].tool.result, null)
    assert.equal(streaming[1].tools[0].result, null)
})

test('content 块里的词条链接同样被改写', () => {
    const blocks = [{type: 'content', content: '参见 [[纪远舟]]', streaming: true}]
    const [block] = buildRenderableAiChatBlocks(blocks, true)
    assert.match(block.content, /#fc-entry-link\?/)
    assert.equal(block.streaming, false)
})
