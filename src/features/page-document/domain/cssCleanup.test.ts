// 本模块验证 CSS 清理预览、执行与直接源码 guard；组件编辑回归由 DocumentKernel 测试负责。
import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import type {SourceFileSet} from './contract.ts'
import {analyzeCssCleanup, collectLiveManagedNodeIds} from './engine/cssCleanupAnalysis.ts'
import {
    applyAutomaticCssCleanupPreview,
    createAutomaticCssCleanupPreview,
} from './engine/cssCleanupExecution.ts'
import {guardDocumentSources} from './engine/guard.ts'
import {parseHtmlSource} from './engine/htmlParser.ts'

const ENTRY_ID = '11111111-1111-4111-8111-111111111111'
const ROOT_ID = '22222222-2222-4222-8222-222222222222'
const PARAGRAPH_ID = '33333333-3333-4333-8333-333333333333'

function entrySources(): SourceFileSet {
    return {
        'article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="entry-body"><div data-fc-node-id="${ROOT_ID}" data-fc-node-kind="container" data-fc-editor-root><p data-fc-node-id="${PARAGRAPH_ID}" data-fc-node-kind="paragraph">原文</p></div></template></template>`,
        'style.css': `@layer fc-entry { [data-fc-entry-id="${ENTRY_ID}"] { --fc-entry-text: #111111; } }\n@layer fc-node {}`,
    }
}

describe('CSS cleanup analysis', () => {
    const DEAD_ID = '99999999-9999-4999-8999-999999999999'

    function liveNodeIds(): Set<string> {
        const parsed = parseHtmlSource(entrySources()['article.html'], {
            mode: 'fragment',
            scope: 'entry',
        })
        return collectLiveManagedNodeIds(parsed)
    }

    it('只把经过真实节点集合证明的孤儿规则列为自动清理', () => {
        const css = `@layer fc-entry { [data-fc-entry-id="${ENTRY_ID}"] { --fc-entry-text: #111; } }
@layer fc-node {
  [data-fc-node-id="${PARAGRAPH_ID}"] { color: red; }
  [data-fc-node-id="${DEAD_ID}"] { color: blue; }
  [data-fc-node-id="${DEAD_ID}"], [data-fc-node-id="${PARAGRAPH_ID}"] { padding: 1rem; }
  [data-fc-node-id="${PARAGRAPH_ID}"] > span { font-weight: 700; }
  @media (max-width: 40rem) { [data-fc-node-id="${PARAGRAPH_ID}"] { gap: 2rem; } }
}`
        const result = analyzeCssCleanup({
            styleCss: css,
            scope: 'entry',
            entryId: ENTRY_ID,
            liveManagedNodeIds: liveNodeIds(),
        })

        assert.equal(result.canApplyAutomaticCleanup, true)
        assert.equal(
            result.findings.filter(item => item.code === 'orphan-managed-node-rule').length,
            1,
        )
        assert.deepEqual(
            result.findings.find(item => item.code === 'orphan-managed-node-selector')?.selectors,
            [`[data-fc-node-id="${DEAD_ID}"]`],
        )
        assert.ok(result.findings.some(item => item.code === 'source-only-managed-rule'))
        assert.equal(css.includes(DEAD_ID), true, '只读分析不能修改传入源码')
    })

    it('识别空块、完全相邻重复规则和同规则内的完全重复声明', () => {
        const css = `@layer fc-entry {
  [data-fc-entry-id="${ENTRY_ID}"] {
    --fc-entry-text: #111;
    --fc-entry-text: #111;
  }
}
@layer fc-node {
  @media (min-width: 80rem) {}
  [data-fc-node-id="${PARAGRAPH_ID}"] { color: red; color: red; }
  [data-fc-node-id="${PARAGRAPH_ID}"] { margin: 0; }
  [data-fc-node-id="${PARAGRAPH_ID}"] { margin: 0; }
}`
        const result = analyzeCssCleanup({
            styleCss: css,
            scope: 'entry',
            entryId: ENTRY_ID,
            liveManagedNodeIds: liveNodeIds(),
        })

        assert.ok(result.findings.some(item => item.code === 'empty-css-block'))
        assert.ok(result.findings.some(item => item.code === 'duplicate-css-rule'))
        assert.ok(result.findings.some(item => item.code === 'duplicate-css-declaration'))
        assert.ok(result.findings.some(item => item.code === 'duplicate-theme-token'))
        assert.equal(result.summary.confirmation, 0)
    })

    it('把会压过标准入口的主题声明列为确认项', () => {
        const css = `@layer fc-entry {
  [data-fc-entry-id="${ENTRY_ID}"] { --fc-entry-accent: #812; }
  [data-fc-entry-id][data-fc-slot].fc-entry.fc-entry.fc-entry {
    --fc-entry-accent: #246;
    --fc-entry-content-width: 66rem;
  }
}`
        const result = analyzeCssCleanup({styleCss: css, scope: 'entry', entryId: ENTRY_ID})
        const conflicts = result.findings.filter(item => item.code === 'competing-theme-token')

        assert.deepEqual(
            conflicts.map(item => item.properties?.[0]),
            ['--fc-entry-accent', '--fc-entry-content-width'],
        )
        assert.ok(conflicts.every(item => item.disposition === 'confirmation'))
        assert.equal(result.summary.confirmation, 2)
    })

    it('损坏字符串阻断自动执行，并且不分析浏览器安全边界后的规则', () => {
        const css = `@layer fc-entry { [data-fc-entry-id="${ENTRY_ID}"] { --fc-entry-text: #111; } }
@layer fc-node {
  [data-fc-node-id="${PARAGRAPH_ID}"] { color: red; }
  [data-fc-node-id="${DEAD_ID}"] { content: "损坏
字符串"; }
  [data-fc-node-id="${DEAD_ID}"] { color: blue; }
}`
        const result = analyzeCssCleanup({
            styleCss: css,
            scope: 'entry',
            entryId: ENTRY_ID,
            liveManagedNodeIds: liveNodeIds(),
        })

        assert.equal(result.canApplyAutomaticCleanup, false)
        assert.ok(result.findings.some(item => item.code === 'browser-incompatible-string'))
        assert.equal(
            result.findings.some(item => item.code === 'orphan-managed-node-rule'),
            false,
        )
        assert.ok(result.browserSafePrefixEnd < css.length)
    })

    it('没有真实节点集合时保留复杂作者规则且不猜测孤儿', () => {
        const css = `@layer fc-entry { [data-fc-entry-id="${ENTRY_ID}"] { --fc-entry-text: #111; } }
@layer fc-node {
  @supports (display: grid) {
    [data-fc-node-id="${DEAD_ID}"]:hover > span { filter: grayscale(1); }
  }
}`
        const result = analyzeCssCleanup({styleCss: css, scope: 'entry', entryId: ENTRY_ID})

        assert.equal(
            result.findings.some(item => item.code.startsWith('orphan-managed-node')),
            false,
        )
        assert.equal(
            result.findings.find(item => item.code === 'source-only-managed-rule')?.disposition,
            'preserve',
        )
    })
})

describe('CSS cleanup preview and execution', () => {
    const DEAD_ID = '99999999-9999-4999-8999-999999999999'

    function cleanupInput(styleCss: string) {
        return {
            styleCss,
            scope: 'entry' as const,
            entryId: ENTRY_ID,
            liveManagedNodeIds: new Set([ROOT_ID, PARAGRAPH_ID]),
        }
    }

    it('分轮应用无重叠的安全清理，并保留复杂源码规则', () => {
        const sourceOnlyRule = `@supports (display: grid) {
    [data-fc-node-id="${PARAGRAPH_ID}"]:hover > span { filter: grayscale(1); }
  }`
        const css = `@layer fc-entry {
  [data-fc-entry-id="${ENTRY_ID}"] {
    --fc-entry-text: #111;
    --fc-entry-text: #111;
  }
}
@layer fc-node {
  @media (min-width: 80rem) {}
  [data-fc-node-id="${DEAD_ID}"] { padding: 1rem; }
  [data-fc-node-id="${DEAD_ID}"], [data-fc-node-id="${PARAGRAPH_ID}"] {
    color: red;
    color: red;
  }
  [data-fc-node-id="${PARAGRAPH_ID}"] { margin: 0; }
  [data-fc-node-id="${PARAGRAPH_ID}"] { margin: 0; }
  ${sourceOnlyRule}
}`
        const input = cleanupInput(css)
        const preview = createAutomaticCssCleanupPreview(input)

        assert.equal(preview.status, 'ready')
        assert.equal(preview.changed, true)
        assert.ok(preview.passes >= 2, '选择器替换与其内部声明清理应使用独立安全轮次')
        assert.equal(preview.remainingAnalysis.summary.automatic, 0)
        assert.equal(preview.remainingAnalysis.summary.repair, 0)
        assert.equal(preview.styleCss.includes(DEAD_ID), false)
        assert.equal(preview.styleCss.includes(sourceOnlyRule), true)
        assert.equal(preview.styleCss.match(/--fc-entry-text:\s*#111/gu)?.length, 1)
        assert.equal(preview.styleCss.match(/color:\s*red/gu)?.length, 1)
        assert.equal(preview.styleCss.match(/margin:\s*0/gu)?.length, 1)

        const result = applyAutomaticCssCleanupPreview(input, preview)
        assert.equal(result.reason, 'applied')
        assert.equal(result.applied, true)
        assert.equal(result.styleCss, preview.styleCss)
    })

    it('清理结果再次执行保持逐字不变', () => {
        const css = `@layer fc-entry {
  [data-fc-entry-id="${ENTRY_ID}"] { --fc-entry-text: #111; --fc-entry-text: #111; }
}
@layer fc-node {}`
        const first = createAutomaticCssCleanupPreview(cleanupInput(css))
        const second = createAutomaticCssCleanupPreview(cleanupInput(first.styleCss))

        assert.equal(first.status, 'ready')
        assert.equal(second.status, 'unchanged')
        assert.equal(second.passes, 0)
        assert.equal(second.styleCss, first.styleCss)
    })

    it('损坏字符串阻断候选和执行，不返回半清理源码', () => {
        const css = `@layer fc-entry { [data-fc-entry-id="${ENTRY_ID}"] { --fc-entry-text: #111; } }
@layer fc-node { [data-fc-node-id="${DEAD_ID}"] { content: "损坏
字符串"; } }`
        const input = cleanupInput(css)
        const preview = createAutomaticCssCleanupPreview(input)
        const result = applyAutomaticCssCleanupPreview(input, preview)

        assert.equal(preview.status, 'blocked')
        assert.equal(preview.block?.code, 'repair-required')
        assert.equal(preview.styleCss, css)
        assert.equal(preview.applied.length, 0)
        assert.equal(result.reason, 'preview-blocked')
        assert.equal(result.styleCss, css)
    })

    it('只清理自动项，竞争主题令牌和复杂条件保持原样', () => {
        const competingRule = `[data-fc-entry-id][data-fc-slot].fc-entry.fc-entry {
    --fc-entry-accent: #246;
  }`
        const sourceOnlyRule = `@supports (display: grid) {
    [data-fc-node-id="${PARAGRAPH_ID}"]:focus { outline: 1px solid; }
  }`
        const css = `@layer fc-entry {
  [data-fc-entry-id="${ENTRY_ID}"] { --fc-entry-accent: #812; }
  ${competingRule}
}
@layer fc-node {
  ${sourceOnlyRule}
}`
        const preview = createAutomaticCssCleanupPreview(cleanupInput(css))

        assert.equal(preview.status, 'unchanged')
        assert.equal(preview.styleCss, css)
        assert.equal(preview.remainingAnalysis.summary.confirmation, 1)
        assert.equal(preview.remainingAnalysis.summary.preserve, 1)
        assert.equal(preview.styleCss.includes(competingRule), true)
        assert.equal(preview.styleCss.includes(sourceOnlyRule), true)
    })

    it('源码或真实节点集合变化后拒绝旧预览', () => {
        const css = `@layer fc-entry {
  [data-fc-entry-id="${ENTRY_ID}"] { --fc-entry-text: #111; }
}
@layer fc-node {
  [data-fc-node-id="${DEAD_ID}"] { color: red; }
}`
        const input = cleanupInput(css)
        const preview = createAutomaticCssCleanupPreview(input)
        const changedSource = applyAutomaticCssCleanupPreview(cleanupInput(`${css}\n`), preview)
        const changedNodes = applyAutomaticCssCleanupPreview(
            {...input, liveManagedNodeIds: new Set([ROOT_ID, PARAGRAPH_ID, DEAD_ID])},
            preview,
        )

        assert.equal(preview.status, 'ready')
        assert.equal(changedSource.reason, 'stale-preview')
        assert.equal(changedSource.styleCss, `${css}\n`)
        assert.equal(changedNodes.reason, 'stale-preview')
        assert.equal(changedNodes.styleCss, css)
    })

    it('共享 guard 拒绝直接源码隐藏根节点或全部段落，但允许保留外部可见段落', () => {
        const rootHidden = entrySources()
        rootHidden['article.html'] = rootHidden['article.html'].replace(
            ' data-fc-editor-root>',
            ' data-fc-editor-root hidden>',
        )
        const rootDiagnostics = guardDocumentSources(
            [parseHtmlSource(rootHidden['article.html'], {scope: 'entry', mode: 'fragment'})],
            [],
        ).diagnostics
        assert.ok(rootDiagnostics.some(item => item.code === 'editor_root_hidden'))

        const paragraphHidden = entrySources()
        paragraphHidden['article.html'] = paragraphHidden['article.html'].replace(
            `data-fc-node-id="${PARAGRAPH_ID}"`,
            `hidden data-fc-node-id="${PARAGRAPH_ID}"`,
        )
        const paragraphDiagnostics = guardDocumentSources(
            [parseHtmlSource(paragraphHidden['article.html'], {scope: 'entry', mode: 'fragment'})],
            [],
        ).diagnostics
        assert.ok(paragraphDiagnostics.some(item => item.code === 'visible_paragraph_required'))

        paragraphHidden['article.html'] = paragraphHidden['article.html'].replace(
            '</div></template>',
            `<p data-fc-node-id="55555555-5555-4555-8555-555555555555" data-fc-node-kind="paragraph">备用</p></div></template>`,
        )
        const allowed = guardDocumentSources(
            [parseHtmlSource(paragraphHidden['article.html'], {scope: 'entry', mode: 'fragment'})],
            [],
        ).diagnostics
        assert.equal(
            allowed.some(item => item.code === 'visible_paragraph_required'),
            false,
        )

        const reservedRuntime = entrySources()
        reservedRuntime['article.html'] = reservedRuntime['article.html'].replace(
            `data-fc-node-id="${PARAGRAPH_ID}"`,
            `data-fc-preview-editing data-fc-node-id="${PARAGRAPH_ID}"`,
        )
        const reservedDiagnostics = guardDocumentSources(
            [parseHtmlSource(reservedRuntime['article.html'], {scope: 'entry', mode: 'fragment'})],
            [],
        ).diagnostics
        assert.ok(
            reservedDiagnostics.some(item => item.code === 'forbidden_preview_runtime_attribute'),
        )
    })
})
