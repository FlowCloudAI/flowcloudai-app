// 本测试读取共享样例但不修改它，验证合法行内样式探针能连续通过宿主编译与画布隔离层。

import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {compileCanvasPreview} from '../host/compiledPreview.ts'
import {isolatePageDocument} from '../runtime/isolationPolicy.ts'
import {createCanvasProbeCases, type CanvasProbeMutation} from './probeCases.ts'

const fixtureRoot = new URL('../../../../../tests/fixtures/page-document/v1/', import.meta.url)
const fixtureHtml = readFileSync(new URL('entry/article.html', fixtureRoot), 'utf8')
const fixtureCss = readFileSync(new URL('entry/style.css', fixtureRoot), 'utf8')
const projectHtml = readFileSync(new URL('project/article.html', fixtureRoot), 'utf8')
const projectCss = readFileSync(new URL('project/style.css', fixtureRoot), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('manifest.json', fixtureRoot), 'utf8')) as {
    entry: {id: string; title: string; summary: string; tags: string[]}
    assets: Array<{id: string}>
}
const malicious = JSON.parse(readFileSync(new URL('malicious-cases.json', fixtureRoot), 'utf8')) as {
    cases: CanvasProbeMutation[]
}

function createCases(html = fixtureHtml) {
    return createCanvasProbeCases({
        fixtureHtml: html,
        fixtureCss,
        projectCss,
        assetIds: manifest.assets.map(asset => asset.id),
        maliciousCases: malicious.cases,
    })
}

test('合法行内样式探针依次通过宿主编译与画布隔离层并保留 style', () => {
    const cases = createCases()
    assert.equal(cases[0]?.id, 'legal-shared-fixture')
    assert.equal(cases[1]?.id, 'legal-inline-style')
    assert.ok(cases[2]?.id && cases[2].id !== 'legal-inline-style')
    const probe = cases[1]
    assert.ok(probe)
    assert.equal(probe.label, '合法：行内样式')

    const compiled = compileCanvasPreview({
        projectArticleHtml: projectHtml,
        projectStyleCss: projectCss,
        entryArticleHtml: probe.validationHtml,
        entryStyleCss: probe.css,
        metadata: manifest.entry,
        assetIds: probe.assetIds,
    })
    assert.equal(compiled.diagnostics.filter(diagnostic => diagnostic.severity === 'error').length, 0)
    assert.ok(compiled.html)
    assert.ok(compiled.css)
    const expectedStyle = 'border-inline-start: 0.25rem solid var(--fc-entry-accent); padding-inline-start: 0.75rem'
    assert.match(compiled.html, new RegExp(`style="${expectedStyle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}"`, 'u'))

    const isolated = isolatePageDocument(compiled.html, compiled.css)
    assert.deepEqual(isolated.errors, [])
    assert.ok(isolated.artifact)
    assert.match(isolated.artifact.html, new RegExp(`style="${expectedStyle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}"`, 'u'))
})

test('合法行内样式探针缺少共享锚点时拒绝生成', () => {
    assert.throws(
        () => createCases(fixtureHtml.replace('id="linked-section"', '')),
        /合法样例 legal-inline-style 的替换锚点不存在。/u,
    )
})

test('公共组件探针保留引用字段且允许不同实例使用同名 part', () => {
    const probe = createCases().find(item => item.id === 'legal-public-component')
    assert.ok(probe)
    const compiled = compileCanvasPreview({
        projectArticleHtml: projectHtml,
        projectStyleCss: projectCss,
        entryArticleHtml: probe.validationHtml,
        entryStyleCss: probe.css,
        metadata: manifest.entry,
        assetIds: probe.assetIds,
    })
    assert.equal(compiled.diagnostics.filter(item => item.severity === 'error').length, 0)
    assert.match(compiled.html ?? '', /data-fc-node-kind="component"/u)
    assert.equal(compiled.html?.match(/data-fc-part="avatar"/gu)?.length, 2)
    assert.match(compiled.html ?? '', /data-fc-component-revision="latest"/u)

    const isolated = isolatePageDocument(compiled.html ?? '', compiled.css ?? '')
    assert.deepEqual(isolated.errors, [])
    assert.equal(isolated.artifact?.html.match(/data-fc-part="avatar"/gu)?.length, 2)
})

test('图片上下文功能区探针保留受管 asset 节点身份', () => {
    const probe = createCases().find(item => item.id === 'legal-contextual-ribbon')
    assert.ok(probe)
    assert.match(probe.validationHtml, /data-fc-ribbon-context="picture"/u)
    const compiled = compileCanvasPreview({
        projectArticleHtml: projectHtml,
        projectStyleCss: projectCss,
        entryArticleHtml: probe.validationHtml,
        entryStyleCss: probe.css,
        metadata: manifest.entry,
        assetIds: probe.assetIds,
    })
    assert.equal(compiled.diagnostics.filter(item => item.severity === 'error').length, 0)
    assert.match(compiled.html ?? '', /data-fc-node-kind="asset"/u)
})

test('项目主题令牌探针通过 fc-project 根规则编译', () => {
    const probe = createCases().find(item => item.id === 'legal-project-theme-token')
    assert.ok(probe)
    assert.match(probe.projectCss, /--fc-entry-accent: #a45a32;/u)
    const compiled = compileCanvasPreview({
        projectArticleHtml: projectHtml,
        projectStyleCss: probe.projectCss,
        entryArticleHtml: probe.validationHtml,
        entryStyleCss: probe.css,
        metadata: manifest.entry,
        assetIds: probe.assetIds,
    })
    assert.equal(compiled.diagnostics.filter(item => item.severity === 'error').length, 0)
    assert.match(compiled.css ?? '', /--fc-entry-accent: #a45a32;/u)
})
