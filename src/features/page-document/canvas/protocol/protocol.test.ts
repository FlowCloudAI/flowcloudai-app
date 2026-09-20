// 这些测试固定隔离画布的信封、来源、序号、预算与只读/输入消息形状。

import assert from 'node:assert/strict'
import test from 'node:test'
import {
    CANVAS_MESSAGE_MAX_BYTES,
    createCanvasHostCommandFactory,
    createCanvasRuntimeMessageGate,
    createCanvasSessionToken,
    PAGE_DOCUMENT_CANVAS_CHANNEL,
    PAGE_DOCUMENT_CANVAS_VERSION,
    parseCanvasHostCommand,
    parseCanvasRuntimeMessage,
} from './index.ts'

const TOKEN = 'a'.repeat(64)
const OTHER_TOKEN = 'b'.repeat(64)
const NODE_ID = '018f47a2-3b4c-7d5e-8f90-123456789abc'
const REQUEST_ID = '44444444-4444-4444-8444-444444444444'

function message(type: string, fields: Record<string, unknown> = {}, sequence = 1) {
    return {
        channel: PAGE_DOCUMENT_CANVAS_CHANNEL,
        version: PAGE_DOCUMENT_CANVAS_VERSION,
        sessionToken: TOKEN,
        sequence,
        type,
        ...fields,
    }
}

test('宿主命令工厂绑定随机会话并生成单调序号', () => {
    const token = createCanvasSessionToken(bytes => {
        bytes.fill(0xab)
        return bytes
    })
    assert.equal(token, 'ab'.repeat(32))
    const create = createCanvasHostCommandFactory(token)
    const first = create({type: 'set-selection', nodeId: NODE_ID})
    const second = create({type: 'viewport', width: 390, height: 844, pixelRatio: 3})
    assert.equal(first.sequence, 1)
    assert.equal(second.sequence, 2)
    assert.equal(first.sessionToken, token)
})

test('宿主命令严格校验渲染、选择、编辑权限、输入回执与视口', () => {
    const render = message('render', {requestId: REQUEST_ID, html: '<p>正文</p>', css: ''})
    assert.equal(parseCanvasHostCommand(render, TOKEN)?.type, 'render')
    assert.equal(parseCanvasHostCommand({...render, requestId: 'latest'}, TOKEN), null)
    assert.equal(parseCanvasHostCommand({...render, extra: true}, TOKEN), null)
    assert.equal(parseCanvasHostCommand({...render, sessionToken: OTHER_TOKEN}, TOKEN), null)
    assert.equal(
        parseCanvasHostCommand(message('set-selection', {nodeId: null}), TOKEN)?.type,
        'set-selection',
    )
    assert.equal(parseCanvasHostCommand(message('set-selection', {nodeId: 'source'}), TOKEN), null)
    assert.equal(
        parseCanvasHostCommand(message('viewport', {width: 390, height: 844, pixelRatio: 3}), TOKEN)?.type,
        'viewport',
    )
    assert.equal(
        parseCanvasHostCommand(message('viewport', {width: 390, height: -1, pixelRatio: 3}), TOKEN),
        null,
    )
    assert.equal(
        parseCanvasHostCommand(message('set-editing', {enabled: true}), TOKEN)?.type,
        'set-editing',
    )
    assert.equal(parseCanvasHostCommand(message('set-editing', {enabled: 'yes'}), TOKEN), null)
    assert.equal(
        parseCanvasHostCommand(message('resolve-input', {
            intentId: REQUEST_ID,
            accepted: false,
            selection: null,
        }), TOKEN)?.type,
        'resolve-input',
    )
    assert.equal(
        parseCanvasHostCommand(message('resolve-input', {
            intentId: REQUEST_ID,
            accepted: true,
            selection: {nodeId: NODE_ID, offset: 2},
        }), TOKEN)?.type,
        'resolve-input',
    )
    assert.equal(parseCanvasHostCommand(message('resolve-input', {
        intentId: 'latest',
        accepted: true,
        selection: null,
    }), TOKEN), null)
})

test('受管图片像素帧只接受当前会话的有界 RGBA 数据', () => {
    const valid = message('asset-frame', {
        requestId: REQUEST_ID,
        assetId: NODE_ID,
        status: 'ready',
        width: 1,
        height: 1,
        originalWidth: 2048,
        originalHeight: 1024,
        rgbaBase64: 'AQIDBA==',
    })
    assert.equal(parseCanvasHostCommand(valid, TOKEN)?.type, 'asset-frame')
    assert.equal(parseCanvasHostCommand({...valid, sessionToken: OTHER_TOKEN}, TOKEN), null)
    assert.equal(parseCanvasHostCommand({...valid, rgbaBase64: 'not-image'}, TOKEN), null)
    assert.equal(parseCanvasHostCommand({...valid, width: 513}, TOKEN), null)
    assert.equal(parseCanvasHostCommand({...valid, originalWidth: 0}, TOKEN), null)
    assert.equal(parseCanvasHostCommand({...valid, originalHeight: 24_000_001}, TOKEN), null)
    assert.equal(parseCanvasHostCommand({...valid, originalWidth: 24_000_000, originalHeight: 2}, TOKEN), null)
    assert.equal(parseCanvasHostCommand({...valid, assetId: '/tmp/image.png'}, TOKEN), null)
    assert.equal(parseCanvasHostCommand({...valid, url: 'file:///tmp/image.png'}, TOKEN), null)
    assert.equal(parseCanvasHostCommand({...valid, rgbaBase64: 'A'.repeat(CANVAS_MESSAGE_MAX_BYTES)}, TOKEN), null)
    assert.equal(parseCanvasHostCommand(message('asset-frame', {
        requestId: REQUEST_ID, assetId: NODE_ID, status: 'unavailable',
        width: 0, height: 0, originalWidth: 0, originalHeight: 0, rgbaBase64: '',
    }), TOKEN)?.type, 'asset-frame')
})

test('运行时只读消息只接受当前 token、版本与有界字段', () => {
    assert.equal(
        parseCanvasRuntimeMessage(message('rendered', {requestId: REQUEST_ID, managedNodeCount: 3, missingAssetIds: [NODE_ID]}), TOKEN)?.type,
        'rendered',
    )
    assert.equal(parseCanvasRuntimeMessage(message('rendered', {
        requestId: REQUEST_ID, managedNodeCount: 3, missingAssetIds: [NODE_ID, NODE_ID],
    }), TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage(message('rendered', {
        requestId: REQUEST_ID, managedNodeCount: 3, missingAssetIds: ['file:///tmp/a.png'],
    }), TOKEN), null)
    assert.equal(
        parseCanvasRuntimeMessage(message('render-error', {requestId: REQUEST_ID, code: 'invalid-document', message: '拒绝'}), TOKEN)?.type,
        'render-error',
    )
    assert.equal(parseCanvasRuntimeMessage(message('size', {width: 700, height: 320}), TOKEN)?.type, 'size')
    assert.equal(parseCanvasRuntimeMessage(message('selection', {nodeId: NODE_ID}), TOKEN)?.type, 'selection')
    assert.equal(
        parseCanvasRuntimeMessage(message('navigation-intent', {href: '#section', nodeId: NODE_ID}), TOKEN)?.type,
        'navigation-intent',
    )
    assert.equal(parseCanvasRuntimeMessage({...message('selection', {nodeId: NODE_ID}), version: 2}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage({...message('selection', {nodeId: NODE_ID}), sequence: 0}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage(message('size', {width: Number.NaN, height: 1}), TOKEN), null)
})

test('文字选区消息固定纯文本 UTF-16 区间与空选区形状', () => {
    const selection = message('text-selection', {
        nodeId: NODE_ID,
        from: 1,
        to: 3,
        expected: '😀',
    })
    assert.equal(parseCanvasRuntimeMessage(selection, TOKEN)?.type, 'text-selection')
    assert.equal(parseCanvasRuntimeMessage(message('text-selection', {
        nodeId: null, from: 0, to: 0, expected: '',
    }), TOKEN)?.type, 'text-selection')
    assert.equal(parseCanvasRuntimeMessage({...selection, nodeId: 'invalid'} , TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage({...selection, from: -1}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage({...selection, to: 65_537}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage({...selection, expected: '字'.repeat(65_537)}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage({...selection, html: '<b>禁止</b>'}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage(message('text-selection', {
        nodeId: null, from: 1, to: 1, expected: '',
    }), TOKEN), null)
})

test('文字选区消息拒绝伪造来源、错误 token、过期序号与超长载荷', () => {
    const source = {}
    const gate = createCanvasRuntimeMessageGate(source, TOKEN)
    const selection = message('text-selection', {
        nodeId: NODE_ID, from: 0, to: 2, expected: '文字',
    }, 3)
    assert.equal(gate.accept({source: {}, data: selection}), null)
    assert.equal(gate.accept({source, data: {...selection, sessionToken: OTHER_TOKEN}}), null)
    assert.equal(gate.accept({source, data: selection})?.type, 'text-selection')
    assert.equal(gate.accept({source, data: {...selection, sequence: 2}}), null)
    assert.equal(gate.accept({source, data: {
        ...selection, sequence: 4, expected: '字'.repeat(CANVAS_MESSAGE_MAX_BYTES),
    }}), null)
})

test('link-hover 只接受成对的进入或离开状态以及有界画布矩形', () => {
    const rect = {top: -12, left: 30, width: 90, height: 18}
    const enter = message('link-hover', {href: `entry://${NODE_ID}`, nodeId: NODE_ID, rect})
    assert.equal(parseCanvasRuntimeMessage(enter, TOKEN)?.type, 'link-hover')
    assert.equal(parseCanvasRuntimeMessage(message('link-hover', {href: null, nodeId: null, rect: null}), TOKEN)?.type, 'link-hover')
    assert.equal(parseCanvasRuntimeMessage({...enter, rect: {...rect, top: Number.NaN}}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage({...enter, rect: {...rect, left: Number.POSITIVE_INFINITY}}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage({...enter, rect: {...rect, width: 100_001}}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage({...enter, rect: {...rect, height: -1}}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage({...enter, rect: {...rect, left: -100_001}}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage({...enter, rect: {...rect, extra: 1}}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage({...enter, href: null}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage({...enter, href: 'x'.repeat(2_049)}, TOKEN), null)
})

test('link-hover 同样拒绝伪造来源、旧 token、重放与超限信封', () => {
    const source = {}
    const gate = createCanvasRuntimeMessageGate(source, TOKEN)
    const enter = message('link-hover', {
        href: `entry://${NODE_ID}`, nodeId: null,
        rect: {top: 1, left: 2, width: 3, height: 4},
    }, 2)
    assert.equal(gate.accept({source: {}, data: enter}), null)
    assert.equal(gate.accept({source, data: {...enter, sessionToken: OTHER_TOKEN}}), null)
    assert.equal(gate.accept({source, data: enter})?.type, 'link-hover')
    assert.equal(gate.accept({source, data: enter}), null)
    assert.equal(gate.accept({source, data: message('link-hover', {href: null, nodeId: null, rect: null}, 1)}), null)
    assert.equal(gate.accept({source, data: {...enter, sequence: 3, href: '你'.repeat(CANVAS_MESSAGE_MAX_BYTES)}}), null)
})

test('输入消息沿用纯文本、UUID、UTF-16 区间与 inputType 白名单', () => {
    const intent = message('input-intent', {
        intentId: REQUEST_ID,
        nodeId: NODE_ID,
        inputType: 'insertCompositionText',
        from: 1,
        to: 3,
        expected: '😀',
        text: '中文',
    })
    assert.equal(parseCanvasRuntimeMessage(intent, TOKEN)?.type, 'input-intent')
    assert.equal(parseCanvasRuntimeMessage({...intent, inputType: 'formatBold'}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage({...intent, from: 4}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage({...intent, html: '<b>禁止</b>'}, TOKEN), null)
    assert.equal(
        parseCanvasRuntimeMessage({...intent, inputType: 'insertLineBreak', text: '\n'}, TOKEN)?.type,
        'input-intent',
    )
    assert.equal(
        parseCanvasRuntimeMessage({...intent, inputType: 'insertParagraph', from: 1, to: 1, expected: '', text: ''}, TOKEN)?.type,
        'input-intent',
    )
    assert.equal(
        parseCanvasRuntimeMessage({...intent, inputType: 'insertFromPaste', text: '<b>只作为纯文本</b>'}, TOKEN)?.type,
        'input-intent',
    )
    assert.equal(parseCanvasRuntimeMessage({...intent, newNodeId: NODE_ID}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage({...intent, inputType: 'insertParagraph', text: '\n'}, TOKEN), null)
    assert.equal(
        parseCanvasRuntimeMessage(message('input-blocked', {
            nodeId: NODE_ID,
            inputType: 'insertFromDrop',
            reason: 'unsupported-input-type',
        }), TOKEN)?.type,
        'input-blocked',
    )
    assert.equal(
        parseCanvasRuntimeMessage(message('input-flush', {nodeId: NODE_ID}), TOKEN)?.type,
        'input-flush',
    )
    assert.equal(parseCanvasRuntimeMessage(message('input-flush', {nodeId: 'source'}), TOKEN), null)
    assert.equal(
        parseCanvasRuntimeMessage({...intent, text: '你'.repeat(65_537)}, TOKEN),
        null,
    )
})

test('画布快捷键意图只接受保存、撤销重做与打开查找的冻结形状', () => {
    for (const action of ['undo', 'redo', 'save']) {
        assert.equal(
            parseCanvasRuntimeMessage(message('history-intent', {action}), TOKEN)?.type,
            'history-intent',
        )
    }
    assert.equal(parseCanvasRuntimeMessage(message('history-intent', {action: 'find'}), TOKEN), null)
    assert.equal(
        parseCanvasRuntimeMessage(message('find-intent', {action: 'open'}), TOKEN)?.type,
        'find-intent',
    )
    assert.equal(parseCanvasRuntimeMessage(message('find-intent', {action: 'close'}), TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage(message('find-intent', {action: 'open', query: 'x'}), TOKEN), null)
})

test('消息超过统一字节预算时拒绝', () => {
    const oversized = message('navigation-intent', {
        href: `https://example.invalid/${'你'.repeat(CANVAS_MESSAGE_MAX_BYTES)}`,
        nodeId: null,
    })
    assert.equal(parseCanvasRuntimeMessage(oversized, TOKEN), null)
})

test('伪造来源、重放、乱序与销毁后的消息被拒绝', () => {
    const source = {}
    const forgedSource = {}
    const gate = createCanvasRuntimeMessageGate(source, TOKEN)
    const first = message('selection', {nodeId: NODE_ID}, 2)
    assert.equal(gate.accept({source: forgedSource, data: first}), null)
    assert.equal(gate.accept({source, data: first})?.type, 'selection')
    assert.equal(gate.accept({source, data: first}), null)
    assert.equal(gate.accept({source, data: message('size', {width: 1, height: 1}, 1)}), null)
    assert.equal(gate.accept({source, data: {...first, sessionToken: OTHER_TOKEN, sequence: 3}}), null)
    gate.destroy()
    assert.equal(gate.accept({source, data: message('size', {width: 1, height: 1}, 4)}), null)
})

test('输入意图同样受来源 Window、token、序号与统一大小上限约束', () => {
    const source = {}
    const gate = createCanvasRuntimeMessageGate(source, TOKEN)
    const intent = message('input-intent', {
        intentId: REQUEST_ID,
        nodeId: NODE_ID,
        inputType: 'insertText',
        from: 0,
        to: 0,
        expected: '',
        text: '中',
    }, 4)

    assert.equal(gate.accept({source: {}, data: intent}), null)
    assert.equal(gate.accept({source, data: {...intent, sessionToken: OTHER_TOKEN}}), null)
    assert.equal(gate.accept({source, data: intent})?.type, 'input-intent')
    assert.equal(gate.accept({source, data: intent}), null)
    assert.equal(gate.accept({source, data: {...intent, sequence: 5, text: '你'.repeat(65_537)}}), null)
})

test('双链候选意图校验 UUID、查询长度与有界 UTF-16 区间', () => {
    const intent = message('link-candidate-intent', {
        intentId: REQUEST_ID, nodeId: NODE_ID, query: '中文词条', from: 2, to: 6,
    })
    assert.equal(parseCanvasRuntimeMessage(intent, TOKEN)?.type, 'link-candidate-intent')
    assert.equal(parseCanvasRuntimeMessage({...intent, query: null}, TOKEN)?.type, 'link-candidate-intent')
    assert.equal(parseCanvasRuntimeMessage({...intent, query: ''}, TOKEN)?.type, 'link-candidate-intent')
    assert.equal(parseCanvasRuntimeMessage({...intent, intentId: 'invalid'}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage({...intent, nodeId: 'invalid'}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage({...intent, query: '字'.repeat(201)}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage({...intent, from: -1}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage({...intent, to: 1}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage({...intent, to: 65_537}, TOKEN), null)
    assert.equal(parseCanvasRuntimeMessage({...intent, html: '<b>禁止</b>'}, TOKEN), null)
})

test('双链候选意图拒绝伪造来源、旧 token、重放与超限消息', () => {
    const source = {}
    const gate = createCanvasRuntimeMessageGate(source, TOKEN)
    const intent = message('link-candidate-intent', {
        intentId: REQUEST_ID, nodeId: NODE_ID, query: '词条', from: 0, to: 4,
    }, 2)
    assert.equal(gate.accept({source: {}, data: intent}), null)
    assert.equal(gate.accept({source, data: {...intent, sessionToken: OTHER_TOKEN}}), null)
    assert.equal(gate.accept({source, data: intent})?.type, 'link-candidate-intent')
    assert.equal(gate.accept({source, data: intent}), null)
    assert.equal(gate.accept({source, data: {...intent, sequence: 3, query: '字'.repeat(CANVAS_MESSAGE_MAX_BYTES)}}), null)
})

test('切换文档后旧 token 即使沿用同一 Window 也失效', () => {
    const source = {}
    const oldGate = createCanvasRuntimeMessageGate(source, TOKEN)
    oldGate.destroy()
    const nextGate = createCanvasRuntimeMessageGate(source, OTHER_TOKEN)
    assert.equal(nextGate.accept({source, data: message('selection', {nodeId: NODE_ID}, 1)}), null)
    const current = {...message('selection', {nodeId: NODE_ID}, 1), sessionToken: OTHER_TOKEN}
    assert.equal(nextGate.accept({source, data: current})?.type, 'selection')
})
