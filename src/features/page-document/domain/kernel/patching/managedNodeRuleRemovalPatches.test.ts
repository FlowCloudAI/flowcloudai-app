// 这些测试确保删除组件时仅回收 fc-node layer 中可证明独占的规则，不误删共享或语义部位选择器。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {parseSourceSnapshot, sourceKey, type SourceDocument} from '../contracts/index.ts'
import {applySourcePatches} from './sourcePatches.ts'
import {createManagedNodeRuleRemovalPatches} from './managedNodeRuleRemovalPatches.ts'

const NODE_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ID = '33333333-3333-4333-8333-333333333333'

function document(content: string): SourceDocument {
    return Object.freeze({
        key: sourceKey('entry', 'style.css'),
        content,
        contentHash: 'fixture',
        persistentRevision: 1,
    })
}

function apply(source: SourceDocument, patches: Parameters<typeof applySourcePatches>[1]): string {
    const snapshot = parseSourceSnapshot({
        id: 'snapshot:managed-node-cleanup',
        templateVersion: 1,
        documents: [source],
    })
    const result = applySourcePatches(snapshot, patches)
    assert.equal(result.status, 'applied')
    return result.snapshot.documents[0].content
}

describe('managed node rule removal patches', () => {
    it('回收基础、交互、断点和旧式精确规则，保留共享规则与其他节点', () => {
        const selector = `[data-fc-node-id="${NODE_ID}"][data-fc-node-kind="table-cell"]`
        const legacy = `[data-fc-node-id="${NODE_ID}"]`
        const other = `[data-fc-node-id="${OTHER_ID}"][data-fc-node-kind="table-cell"]`
        const source = document(`
${selector} { color: outside; }
@layer fc-node {
  ${selector} { color: red; }
  ${selector}:where(:hover) { color: blue; }
  ${selector}:hover { opacity: 0.8; }
  ${selector}:focus-within { outline: none; }
  ${legacy} { width: 10px; }
  ${selector}, ${other} { border: 1px solid; }
  ${selector} strong { font-weight: 700; }
  ${other} { color: green; }
  @media (min-width: 48rem) { ${selector} { padding: 8px; } }
}`)
        const planned = createManagedNodeRuleRemovalPatches(source, [NODE_ID])

        assert.equal(planned.status, 'ready')
        if (planned.status !== 'ready') return
        const changed = apply(source, planned.patches)
        assert.match(changed, new RegExp(`${escapeRegExp(selector)} \\{ color: outside`, 'u'))
        assert.doesNotMatch(changed, /color: red/u)
        assert.doesNotMatch(changed, /color: blue/u)
        assert.doesNotMatch(changed, /opacity: 0\.8/u)
        assert.doesNotMatch(changed, /outline: none/u)
        assert.doesNotMatch(changed, /width: 10px/u)
        assert.doesNotMatch(changed, /padding: 8px/u)
        assert.match(changed, new RegExp(`${escapeRegExp(selector)},`, 'u'))
        assert.match(changed, new RegExp(`${escapeRegExp(selector)} strong`, 'u'))
        assert.match(changed, /color: green/u)
    })

    it('无匹配时不制造补丁，语法损坏时拒绝清理', () => {
        assert.equal(
            createManagedNodeRuleRemovalPatches(
                document(`@layer fc-node { [data-fc-node-id="${OTHER_ID}"] { color: red; } }`),
                [NODE_ID],
            ).status,
            'unchanged',
        )
        const rejected = createManagedNodeRuleRemovalPatches(
            document('@layer fc-node { [data-fc-node-id="broken] { color: red; }'),
            [NODE_ID],
        )
        assert.equal(rejected.status, 'rejected')
    })
})

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
