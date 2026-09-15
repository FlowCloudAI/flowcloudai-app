// 本模块只为显式开关入口读取共享契约样例，并把 entry-body 模板内容投影成可见画布片段。

import {parseFragment, serialize, type DefaultTreeAdapterTypes} from 'parse5'
import fixtureHtml from '../../../../../tests/fixtures/page-document/v1/entry/article.html?raw'
import fixtureCss from '../../../../../tests/fixtures/page-document/v1/entry/style.css?raw'
import projectHtml from '../../../../../tests/fixtures/page-document/v1/project/article.html?raw'
import projectCss from '../../../../../tests/fixtures/page-document/v1/project/style.css?raw'
import manifest from '../../../../../tests/fixtures/page-document/v1/manifest.json'
import maliciousFixture from '../../../../../tests/fixtures/page-document/v1/malicious-cases.json'

interface MaliciousFixtureCase {
    id: string
    file: string
    replace: {needle: string; value: string}
}

export interface CanvasProbeCase {
    id: string
    label: string
    validationHtml: string
    html: string
    css: string
    assetIds: string[]
}

type HtmlNode = DefaultTreeAdapterTypes.Node
type HtmlElement = DefaultTreeAdapterTypes.Element

function isElement(node: HtmlNode): node is HtmlElement {
    return 'tagName' in node && 'attrs' in node
}

function findEntryBody(node: HtmlNode): DefaultTreeAdapterTypes.DocumentFragment | null {
    if (isElement(node) && node.tagName === 'template') {
        const fill = node.attrs.find(attribute => attribute.name === 'data-fc-fill')?.value
        if (fill === 'entry-body' && 'content' in node) return node.content
    }
    const children = 'childNodes' in node ? node.childNodes : []
    for (const child of children) {
        const found = findEntryBody(child)
        if (found) return found
    }
    if (isElement(node) && node.tagName === 'template' && 'content' in node) {
        for (const child of node.content.childNodes) {
            const found = findEntryBody(child)
            if (found) return found
        }
    }
    return null
}

export function extractCanvasRenderableHtml(source: string): string {
    const fragment = parseFragment(source, {scriptingEnabled: false})
    return serialize(findEntryBody(fragment) ?? fragment)
}

function mutate(source: string, item: MaliciousFixtureCase): string {
    if (!source.includes(item.replace.needle)) throw new Error(`恶意样例 ${item.id} 的替换锚点不存在。`)
    return source.replace(item.replace.needle, item.replace.value)
}

const maliciousCases = (maliciousFixture as {cases: MaliciousFixtureCase[]}).cases

export const CANVAS_PROBE_CASES: readonly CanvasProbeCase[] = [
    {
        id: 'legal-shared-fixture',
        label: '合法共享样例',
        validationHtml: fixtureHtml,
        html: extractCanvasRenderableHtml(fixtureHtml),
        css: fixtureCss,
        assetIds: manifest.assets.map(asset => asset.id),
    },
    ...maliciousCases.map(item => {
        const html = item.file.endsWith('.css') ? fixtureHtml : mutate(fixtureHtml, item)
        const css = item.file.endsWith('.css') ? mutate(fixtureCss, item) : fixtureCss
        return {
            id: item.id,
            label: `恶意：${item.id}`,
            validationHtml: html,
            html: extractCanvasRenderableHtml(html),
            css,
            assetIds: manifest.assets.map(asset => asset.id),
        }
    }),
]

export const CANVAS_PROBE_PROJECT = {
    html: projectHtml,
    css: projectCss,
    metadata: manifest.entry,
} as const
