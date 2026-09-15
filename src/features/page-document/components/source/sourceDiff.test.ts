// 本测试固定源码工作台相对保存基线的逐行差异与有界截断行为。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {createSourceDiff} from './sourceDiff.ts'

describe('page document source diff', () => {
    it('区分新增与删除行并保留双侧行号', () => {
        const result = createSourceDiff('第一行\n旧行\n', '第一行\n新行\n')
        assert.equal(result.addedLines, 1)
        assert.equal(result.removedLines, 1)
        assert.ok(result.rows.some(row => row.kind === 'removed' && row.oldLine === 2))
        assert.ok(result.rows.some(row => row.kind === 'added' && row.newLine === 2))
    })

    it('超出视图上限时保留首尾并插入省略行', () => {
        const before = Array.from({length: 20}, (_, index) => `旧 ${index}`).join('\n')
        const after = Array.from({length: 20}, (_, index) => `新 ${index}`).join('\n')
        const result = createSourceDiff(before, after, 7)
        assert.equal(result.truncated, true)
        assert.equal(result.rows.length, 7)
        assert.equal(result.rows[3]?.kind, 'omitted')
    })
})
