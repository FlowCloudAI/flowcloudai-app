// 色板、画布运行时与内核分析使用的词条主题令牌必须一致：画布能画出而内核解析不了的令牌，
// 会让该颜色在内核验收中永远失败（2026-09-21 的 --fc-entry-muted 即如此）。

import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {CANVAS_BASE_PROJECT_CSS} from './compiledPreview.ts'

function tokenDeclarations(css: string): Map<string, string> {
    const tokens = new Map<string, string>()
    for (const match of css.matchAll(/(--fc-entry-[a-z-]+)\s*:\s*([^;]+);/gu)) tokens.set(match[1], match[2].trim())
    return tokens
}

const baseTokens = tokenDeclarations(CANVAS_BASE_PROJECT_CSS)

test('色板引用的每个词条主题令牌都在内核使用的基础项目样式中有定义', () => {
    const palette = readFileSync(new URL('../../components/properties/ColorPropertyControl.tsx', import.meta.url), 'utf8')
    const referenced = new Set([...palette.matchAll(/value: 'var\((--fc-entry-[a-z-]+)\)'/gu)].map(match => match[1]))
    assert.ok(referenced.size > 0)
    for (const token of referenced) assert.ok(baseTokens.has(token), `${token} 未在 CANVAS_BASE_PROJECT_CSS 中定义`)
})

test('画布运行时默认层的词条主题令牌与基础项目样式取值一致', () => {
    const runtimeCss = readFileSync(new URL('../runtime/runtime.css', import.meta.url), 'utf8')
    const defaults = runtimeCss.slice(runtimeCss.indexOf('@layer fc-canvas-defaults'))
    for (const [token, value] of tokenDeclarations(defaults)) {
        assert.equal(baseTokens.get(token), value, `${token} 在画布运行时为 ${value}，基础项目样式为 ${baseTokens.get(token)}`)
    }
})
