// 固定桌面词条编辑页沿用外壳正文区的留白，避免误把间距补到隔离画布内部。

import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import postcss from 'postcss'

test('桌面编辑模式不清零词条页外壳的正文内边距', () => {
    const css = readFileSync(new URL('../entries/components/EntryEditor.css', import.meta.url), 'utf8')
    const stylesheet = postcss.parse(css)
    const base = stylesheet.nodes.find(node => node.type === 'rule' && node.selector === '.entry-editor-workspace__body')
    const editing = stylesheet.nodes.find(node => node.type === 'rule'
        && node.selector === '.entry-editor-workspace.is-editing .entry-editor-workspace__body')

    assert.ok(base && base.type === 'rule')
    assert.ok(editing && editing.type === 'rule')
    assert.ok(base.nodes.some(node => node.type === 'decl' && node.prop === 'padding' && node.value !== '0'))
    assert.equal(editing.nodes.some(node => node.type === 'decl' && node.prop === 'padding'), false)
})
