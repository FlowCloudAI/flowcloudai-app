// 本模块验证主题令牌只修改规范作用域根的目标声明，并保留其他作者 CSS 与声明优先级。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {parseSourceSnapshot, sourceKey, type SourceDocument} from '../contracts/index.ts'
import {applySourcePatches} from './sourcePatches.ts'
import {createThemeTokenPatches} from './themeTokenPatches.ts'

const ENTRY_ID = '11111111-1111-4111-8111-111111111111'

function document(scope: 'project' | 'entry', content: string): SourceDocument {
    return Object.freeze({
        key: sourceKey(scope, 'style.css'),
        content,
        contentHash: 'fixture',
        persistentRevision: 3,
    })
}

function apply(input: SourceDocument, property: string, value: string | null): string {
    const planned = createThemeTokenPatches(input, ENTRY_ID, property, value)
    if (planned.status === 'unchanged') return input.content
    assert.equal(planned.status, 'ready')
    if (planned.status !== 'ready') return input.content
    const result = applySourcePatches(
        parseSourceSnapshot({
            id: 'snapshot:theme-token',
            templateVersion: 1,
            documents: [input],
        }),
        planned.patches,
    )
    assert.notEqual(result.status, 'rejected')
    return result.snapshot.documents[0].content
}

describe('theme token patches', () => {
    it('只更新目标令牌并保留相邻声明、注释和非规范规则', () => {
        const css = `@layer fc-entry {
  [data-fc-entry-id='${ENTRY_ID}'] {
    --fc-entry-text: #111111;
    /* keep */ --fc-entry-accent: #812345;
  }
  .special { --fc-entry-text: #999999; }
}`
        const result = apply(document('entry', css), '--fc-entry-text', '#222222')

        assert.match(result, /--fc-entry-text: #222222/u)
        assert.match(result, /\/\* keep \*\/ --fc-entry-accent: #812345/u)
        assert.match(result, /\.special \{ --fc-entry-text: #999999/u)
    })

    it('清除本级设置只删除规范根中的同名声明', () => {
        const css = `@layer fc-project {
  :root { --fc-entry-text: #111; --fc-entry-text: #222; }
  :root.theme-dark { --fc-entry-text: #fff; }
}`
        const result = apply(document('project', css), '--fc-entry-text', null)

        assert.doesNotMatch(result, /#111|#222/u)
        assert.match(result, /:root\.theme-dark \{ --fc-entry-text: #fff/u)
    })

    it('合并重复规范声明并保留胜出声明的 important 优先级', () => {
        const css = `@layer fc-project {
  :root { --fc-entry-accent: red !important; }
}
@layer fc-project {
  :root { --fc-entry-accent: blue; --fc-entry-text: black; }
}`
        const result = apply(document('project', css), '--fc-entry-accent', 'purple')

        assert.equal((result.match(/--fc-entry-accent/g) ?? []).length, 1)
        assert.match(result, /--fc-entry-accent: purple !important/u)
        assert.match(result, /--fc-entry-text: black/u)
    })

    it('没有规范 layer 时创建目标规则，重复相同修改不增长源码', () => {
        const first = apply(document('entry', '/* author */'), '--fc-entry-surface', '#fefefe')
        const second = apply(document('entry', first), '--fc-entry-surface', '#fefefe')

        assert.equal(second, first)
        assert.match(second, /@layer fc-entry/u)
        assert.match(second, new RegExp(`data-fc-entry-id="${ENTRY_ID}"`, 'u'))
    })

    it('拒绝越界属性和值结构', () => {
        assert.equal(
            createThemeTokenPatches(document('entry', ''), ENTRY_ID, 'color', 'red').status,
            'rejected',
        )
        assert.equal(
            createThemeTokenPatches(
                document('entry', ''),
                ENTRY_ID,
                '--fc-entry-text',
                'red; color: blue',
            ).status,
            'rejected',
        )
    })
})
