// 本模块验证不同 HTML/CSS 语法上下文共享错误边界，同时不会把声明列表当成完整样式表。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {sourceKey} from '../contracts/source.ts'
import {
    parseDeclarationListSyntax,
    parseHtmlSyntax,
    parsePropertyValueSyntax,
    parseSelectorListSyntax,
    parseStylesheetSyntax,
} from './index.ts'

const PROJECT_CSS = sourceKey('project', 'style.css')
const ENTRY_CSS = sourceKey('entry', 'style.css')
const ENTRY_HTML = sourceKey('entry', 'article.html')

describe('document kernel syntax', () => {
    it('rejects the same unescaped newline in stylesheets, declaration lists and values', () => {
        const value = '"A\nB"'
        const stylesheet = parseStylesheetSyntax(`a{font-family:${value};width:37%}`, ENTRY_CSS)
        const declarations = parseDeclarationListSyntax(
            `font-family:${value};width:37%`,
            ENTRY_HTML,
        )
        const property = parsePropertyValueSyntax('font-family', value, ENTRY_HTML)

        for (const parsed of [stylesheet, declarations, property]) {
            assert.equal(parsed.root, null)
            assert.equal(parsed.diagnostics[0]?.code, 'css_syntax_error')
        }
    })

    it('keeps stylesheet and declaration-list grammars separate', () => {
        assert.ok(parseStylesheetSyntax('@layer fc-project { p { color: red } }', PROJECT_CSS).root)
        assert.ok(parseDeclarationListSyntax('color:red; width:37%', ENTRY_HTML).root)
        assert.equal(parseDeclarationListSyntax('color:red} .x{width:37%', ENTRY_HTML).root, null)
        assert.equal(parsePropertyValueSyntax('color', 'red; width:37%', ENTRY_HTML).root, null)
    })

    it('parses selectors and both HTML contexts through explicit entry points', () => {
        assert.ok(parseSelectorListSyntax('.card > p, [data-x="1"]', ENTRY_CSS).selectors)
        assert.equal(parseSelectorListSyntax('.card:has(', ENTRY_CSS).selectors, null)
        assert.equal(
            parseHtmlSyntax('<p>甲</p>', {mode: 'fragment', sourceKey: ENTRY_HTML}).kind,
            'fragment',
        )
        assert.equal(
            parseHtmlSyntax('<!doctype html><html><body></body></html>', {
                mode: 'document',
                sourceKey: sourceKey('project', 'article.html'),
            }).kind,
            'document',
        )
    })
})
