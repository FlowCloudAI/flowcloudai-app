// 本测试用 CSS 语法树锁定画布默认层与未分层安全标记，避免作者主题再次被运行时基线压过。

import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import postcss, {type ChildNode} from 'postcss'

const DEFAULT_LAYER = 'fc-canvas-defaults'

function containingLayer(node: ChildNode): string | null {
    let current = node.parent
    while (current) {
        if (current.type === 'atrule' && current.name.toLowerCase() === 'layer') {
            return current.params.trim()
        }
        current = current.parent
    }
    return null
}

test('运行时主题与排版基线位于首个默认层，安全标记保持未分层', () => {
    const source = readFileSync(new URL('./runtime.css', import.meta.url), 'utf8')
    const root = postcss.parse(source, {from: 'runtime.css'})
    const layers: string[] = []
    const baselineSelectors = new Set([':root', 'html', 'body', '#page-document-canvas-root'])
    const seenBaselineSelectors = new Set<string>()
    const safetySelectors = new Set([
        '[data-fc-node-id][data-fc-canvas-selected]',
        '[data-fc-asset-placeholder]',
    ])
    const seenSafetySelectors = new Set<string>()
    let themeDeclarationCount = 0

    root.walkAtRules('layer', rule => layers.push(rule.params.trim()))
    assert.equal(layers[0], DEFAULT_LAYER)

    root.walkDecls(declaration => {
        if (!declaration.prop.startsWith('--fc-entry-')) return
        themeDeclarationCount += 1
        assert.equal(containingLayer(declaration), DEFAULT_LAYER, declaration.prop)
    })
    assert.ok(themeDeclarationCount > 0)

    root.walkRules(rule => {
        for (const selector of rule.selectors.map(candidate => candidate.trim())) {
            if (baselineSelectors.has(selector)) {
                seenBaselineSelectors.add(selector)
                assert.equal(containingLayer(rule), DEFAULT_LAYER, selector)
            }
            if (safetySelectors.has(selector)) {
                seenSafetySelectors.add(selector)
                assert.equal(containingLayer(rule), null, selector)
            }
        }
    })

    assert.deepEqual(seenBaselineSelectors, baselineSelectors)
    assert.deepEqual(seenSafetySelectors, safetySelectors)
})
