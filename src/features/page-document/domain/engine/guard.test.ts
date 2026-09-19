import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {guardDocumentSources} from './guard.ts'
import {parseCssSource} from './cssParser.ts'

describe('fc-component 作者 CSS scope', () => {
    it('词条作者 CSS 拒绝 fc-component 选择器', () => {
        const result = guardDocumentSources([], [parseCssSource('@layer fc-component { [data-fc-component="card"] { display: grid; } }', 'entry')])
        assert.ok(result.diagnostics.some(item => item.code === 'selector_scope_violation'))
    })

    it('项目作者 CSS 拒绝 fc-component 选择器', () => {
        const result = guardDocumentSources([], [parseCssSource('@layer fc-component { [data-fc-component="card"] { display: grid; } }', 'project')])
        assert.ok(result.diagnostics.some(item => item.code === 'selector_scope_violation'))
    })

    it('编译期 component scope 允许以公共组件根为起点的选择器', () => {
        const result = guardDocumentSources([], [parseCssSource('@layer fc-component { [data-fc-component="card"] { display: grid; } }', 'component')])
        assert.deepEqual(result.diagnostics, [])
    })
})
