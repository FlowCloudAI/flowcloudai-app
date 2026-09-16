// 本测试固定画布输入只映射为文本范围意图，并验证连续调度、立即提交与尾帧语义。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {
    PAGE_DOCUMENT_CANVAS_CHANNEL,
    PAGE_DOCUMENT_CANVAS_VERSION,
    type CanvasInputIntentMessage,
    type CanvasInputType,
} from '../canvas/protocol/index.ts'
import type {ComponentHandle} from '../domain/kernel/index.ts'
import {createCanvasInputCommitScheduler} from './canvasInputCommitScheduler.ts'
import {
    applyCanvasInputToText,
    createCanvasInputKernelRequest,
    readCanvasInputTargetText,
} from './canvasInputOperation.ts'

const NODE_ID = '018f47a2-3b4c-7d5e-8f90-123456789abc'

function intent(
    intentId: string,
    inputType: CanvasInputType,
    from: number,
    to: number,
    expected: string,
    text: string,
): CanvasInputIntentMessage {
    return {
        channel: PAGE_DOCUMENT_CANVAS_CHANNEL,
        version: PAGE_DOCUMENT_CANVAS_VERSION,
        sessionToken: 'a'.repeat(64),
        sequence: 1,
        type: 'input-intent',
        intentId,
        nodeId: NODE_ID,
        inputType,
        from,
        to,
        expected,
        text,
    }
}

describe('canvas input operation', () => {
    it('输入意图映射为 current-candidate replace-text 且不携带 HTML', () => {
        const message = intent('11111111-1111-7111-8111-111111111111', 'insertText', 2, 4, '旧文', '新文')
        const request = createCanvasInputKernelRequest([message], 'canvas-input-history:test')
        const handle = {nodeId: NODE_ID} as ComponentHandle
        const intents = request.createIntents(new Map([[NODE_ID, handle]]))

        assert.equal(intents.length, 1)
        assert.deepEqual(intents[0], {
            kind: 'replace-text',
            target: {
                kind: 'text-range',
                component: handle,
                range: {unit: 'utf16-code-unit', from: 2, to: 4},
                expected: '旧文',
            },
            coordinateSpace: 'current-candidate',
            text: '新文',
        })
        assert.equal('html' in message, false)
    })

    it('区间、expected 或 UTF-16 边界不匹配时拒绝暂存文本', () => {
        const drifted = intent('22222222-2222-7222-8222-222222222222', 'insertText', 1, 2, '错', '中')
        assert.deepEqual(applyCanvasInputToText('正文', drifted), {
            accepted: false,
            text: '正文',
            reason: 'invalid-selection',
        })
        const splitPair = intent('33333333-3333-7333-8333-333333333333', 'deleteContentBackward', 1, 2, '\ud83d', '')
        assert.equal(applyCanvasInputToText('😀', splitPair).accepted, false)
    })

    it('节点不在当前受管可编辑投影时宿主拒绝且不读取 iframe 文本', () => {
        const html = `<template data-fc-entry-patch><template data-fc-fill="entry-body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph">正文</p><div data-fc-node-id="77777777-7777-7777-8777-777777777777" data-fc-node-kind="container">容器</div></template></template>`
        assert.equal(readCanvasInputTargetText(html, NODE_ID), '正文')
        assert.equal(readCanvasInputTargetText(html, '77777777-7777-7777-8777-777777777777'), null)
        assert.equal(readCanvasInputTargetText(html, '88888888-8888-7888-8888-888888888888'), null)
    })

    it('连续非立即输入在一个窗口只提交一次且冲刷时不丢尾帧', async () => {
        const commits: CanvasInputIntentMessage[][] = []
        const scheduler = createCanvasInputCommitScheduler({
            delayMs: 10_000,
            readNodeText: () => '原',
            commit: async messages => {
                commits.push([...messages])
                return true
            },
            createHistoryGroupId: () => 'canvas-input-history:typing',
        })
        const first = scheduler.schedule(intent('44444444-4444-7444-8444-444444444444', 'insertText', 1, 1, '', '中'))
        const last = scheduler.schedule(intent('55555555-5555-7555-8555-555555555555', 'insertText', 2, 2, '', '文'))

        const flushed = scheduler.flush()
        assert.deepEqual(await Promise.all([first, last, flushed]), [true, true, true])
        assert.equal(commits.length, 1)
        assert.deepEqual(commits[0].map(message => message.text), ['中', '文'])
    })

    it('交互结束后丢弃暂存快照，下次输入以最新草稿为准', async () => {
        let sourceText = '原'
        const scheduler = createCanvasInputCommitScheduler({
            delayMs: 10_000,
            readNodeText: () => sourceText,
            commit: async messages => {
                for (const message of messages) {
                    const update = applyCanvasInputToText(sourceText, message)
                    assert.equal(update.accepted, true)
                    sourceText = update.text
                }
                return true
            },
            createHistoryGroupId: () => 'canvas-input-history:fresh-source',
        })

        void scheduler.schedule(intent('77777777-7777-7777-8777-777777777777', 'insertText', 1, 1, '', '中'))
        assert.equal(await scheduler.endInteraction(), true)
        sourceText = '新'

        const accepted = await scheduler.schedule(
            intent('88888888-8888-7888-8888-888888888888', 'insertReplacementText', 0, 1, '新', '更'),
            {immediate: true},
        )

        assert.equal(accepted, true)
        assert.equal(sourceText, '更')
    })

    it('组合结束的立即输入直接提交并只建立一个历史组', async () => {
        const groups: Array<string | undefined> = []
        const scheduler = createCanvasInputCommitScheduler({
            delayMs: 10_000,
            readNodeText: () => '原文',
            commit: async (_messages, metadata) => {
                groups.push(metadata.historyGroupId)
                return true
            },
            createHistoryGroupId: () => 'canvas-input-history:composition',
        })

        const accepted = await scheduler.schedule(
            intent('66666666-6666-7666-8666-666666666666', 'insertCompositionText', 2, 2, '', '中文'),
            {immediate: true},
        )

        assert.equal(accepted, true)
        assert.deepEqual(groups, ['canvas-input-history:composition'])
    })
})
