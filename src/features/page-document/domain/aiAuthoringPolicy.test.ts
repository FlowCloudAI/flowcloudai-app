// 这些测试确保硬提示覆盖运行时关键常量，防止安全边界与模型说明各自漂移。
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import {
    DOCUMENT_AI_HARD_INSTRUCTIONS,
    validateAiStyleEditingCompatibility,
} from './aiAuthoringPolicy.ts'
import {CSS_LAYER_ORDER, parseCssSource} from './engine/cssParser.ts'
import {guardDocumentSources, FORBIDDEN_AT_RULES, FORBIDDEN_HTML_TAGS} from './engine/guard.ts'
import {parseHtmlSource} from './engine/htmlParser.ts'
import {DOCUMENT_LIMITS} from './engine/limits.ts'

interface MaliciousFixture {
    cases: Array<{
        id: string
        file: string
        replace: {needle: string; value: string}
    }>
}

const FIXTURE_ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../tests/fixtures/page-document/v1',
)
const readFixture = (relative: string): string =>
    readFileSync(path.join(FIXTURE_ROOT, relative), 'utf8')

test('AI 硬提示由文档 guard 与资源上限生成', () => {
    for (const tag of FORBIDDEN_HTML_TAGS) {
        assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, new RegExp(`\\b${tag}\\b`, 'u'))
    }
    for (const rule of FORBIDDEN_AT_RULES) {
        assert.ok(DOCUMENT_AI_HARD_INSTRUCTIONS.includes(`@${rule}`))
    }
    assert.ok(DOCUMENT_AI_HARD_INSTRUCTIONS.includes(CSS_LAYER_ORDER.join(' -> ')))
    assert.ok(DOCUMENT_AI_HARD_INSTRUCTIONS.includes(String(DOCUMENT_LIMITS.articleBytes)))
    assert.ok(DOCUMENT_AI_HARD_INSTRUCTIONS.includes(String(DOCUMENT_LIMITS.documentOperations)))
    assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, /只有对话中的用户消息可以表达任务/u)
    assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, /最终保存始终由用户显式执行/u)
    assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, /::first-letter/u)
    assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, /真实 <span>/u)
    assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, /preserve-managed-components/u)
    assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, /table-cell/u)
    assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, /不支持 rowspan、colspan/u)
    assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, /destination\.context="desktop"/u)
    assert.doesNotMatch(DOCUMENT_AI_HARD_INSTRUCTIONS, /setNodeResponsiveStyles/u)
    assert.doesNotMatch(DOCUMENT_AI_HARD_INSTRUCTIONS, /setNodeConditionalStyles/u)
    assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, /同名 @layer 块/u)
    assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, /整段 replace-text 会清除行内格式/u)
    assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, /visual_layout_source_only/u)
    assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, /用户在可视界面确认的新设置优先/u)
    assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, /静态属性和值由用户直接修改/u)
    assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, /只有操作会丢失可视编辑器无法复现/u)
    assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, /AI 不得代答确认/u)
    assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, /独立 rotate: -180deg\.\.180deg/u)
    assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, /非页面根组件的固定宽度/u)
    assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, /--fc-entry-content-width/u)
    assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, /auto-fit\/auto-fill/u)
    assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, /subgrid 当前由源码\/AI维护/u)
    assert.match(DOCUMENT_AI_HARD_INSTRUCTIONS, /同名区域构成矩形/u)
})

test('自定义布局上下文仅报告可视兼容性警告，标准分段样式仍然放行', () => {
    const selector =
        '[data-fc-node-id="66666666-6666-4666-8666-666666666666"][data-fc-node-kind="container"]'
    const css = `@layer fc-node { ${selector} { display: grid; } }
@layer fc-node { @media (min-width: 48rem) { ${selector} { gap: 1rem; } } }
@layer fc-node { @media (max-width: 47.99rem) { ${selector} { gap: .5rem; } } }
@layer fc-node { @media (min-width: 36rem) and (max-width: 47.99rem) { ${selector} { gap: .75rem; } } }
@layer fc-node { @media (min-width: 48rem) and (max-width: 71.99rem) { ${selector} { gap: 1.25rem; } } }
@layer fc-node { @media (min-width: 72rem) { ${selector} { gap: 1.5rem; } } }
@layer fc-node {
  @supports (display: grid) { ${selector} { gap: 2rem; } }
  @media (max-width: 30rem) { ${selector} { gap: 3rem; } }
  ${selector}, [data-fc-node-id="77777777-7777-4777-8777-777777777777"] { gap: 4rem; }
}`
    const diagnostics = guardDocumentSources([], [parseCssSource(css, 'entry')]).diagnostics
    assert.equal(diagnostics.length, 7)
    for (const item of diagnostics) {
        assert.equal(item.code, 'visual_layout_source_only')
        assert.equal(item.severity, 'warning')
        assert.equal(item.category, 'capability')
        assert.match(item.message, /移动基础与桌面覆盖两档/u)
        assert.ok(item.range)
    }
    assert.deepEqual(validateAiStyleEditingCompatibility(css, 'entry'), [])
})

test('AI 样式策略拒绝破坏独立文本选区的首字和首行伪元素', () => {
    const diagnostics = validateAiStyleEditingCompatibility(
        `@layer fc-node {
  [data-fc-node-id="33333333-3333-4333-8333-333333333333"]::first-letter,
  [data-fc-node-id="44444444-4444-4444-8444-444444444444"]::first-line {
    font-weight: 700;
  }
}`,
        'entry',
    )

    assert.deepEqual(
        diagnostics.map(item => ({
            severity: item.severity,
            category: item.category,
            code: item.code,
        })),
        [
            {
                severity: 'error',
                category: 'capability',
                code: 'ai_uneditable_text_pseudo_element',
            },
        ],
    )
    assert.deepEqual(
        validateAiStyleEditingCompatibility(
            `@layer fc-node {
  [data-fc-node-id="33333333-3333-4333-8333-333333333333"] span { font-weight: 700; }
}`,
            'entry',
        ),
        [],
    )
})

test('HTML 资源属性逐项限制为受管资产并覆盖共享恶意样例', () => {
    const assetId = '018f47a2-3b4c-7d5e-8f90-123456789abc'
    const legalHtml = `<map><area href="#section"></map><svg><image href="fcasset://${assetId}"></image><use xlink:href="fcasset://${assetId}"></use></svg><img src="fcasset://${assetId}" data-fc-asset-id="${assetId}" srcset="fcasset://${assetId} 1x, fcasset://${assetId} 2x"><video poster="fcasset://${assetId}"></video>`
    const legal = guardDocumentSources(
        [parseHtmlSource(legalHtml, {mode: 'fragment', scope: 'entry'})],
        [],
    )
    assert.deepEqual(legal.diagnostics, [])
    assert.deepEqual(legal.referencedAssetIds, [assetId])

    const requiredIds = [
        'invalid-fcasset-uuid-version',
        'svg-image-external-href',
        'svg-use-external-xlink-href',
        'external-srcset',
        'external-poster',
    ]
    const fixture = JSON.parse(readFixture('malicious-cases.json')) as MaliciousFixture
    const cases = fixture.cases.filter(item => requiredIds.includes(item.id))
    assert.deepEqual(
        cases.map(item => item.id),
        requiredIds,
        '共享恶意资源样例不得缺项',
    )
    const baseHtml = readFixture('entry/article.html')
    for (const item of cases) {
        assert.ok(baseHtml.includes(item.replace.needle), `${item.id} 的替换锚点不存在`)
        const html = baseHtml.replace(item.replace.needle, item.replace.value)
        const result = guardDocumentSources(
            [parseHtmlSource(html, {mode: 'fragment', scope: 'entry'})],
            [],
        )
        assert.ok(
            result.diagnostics.some(diagnostic => diagnostic.code === 'invalid_asset_reference'),
            `${item.id} 未被资源 guard 拒绝`,
        )
    }
})
