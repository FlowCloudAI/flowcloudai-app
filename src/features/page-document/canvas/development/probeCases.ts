// 本模块从调用方提供的共享样例源码构造开发探针；文件读取留给 Vite 入口，纯构造逻辑供 Node 测试复用。

import {parseFragment, serialize, type DefaultTreeAdapterTypes} from 'parse5'

export interface CanvasProbeMutation {
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

interface CanvasProbeSources {
    fixtureHtml: string
    fixtureCss: string
    assetIds: string[]
    maliciousCases: CanvasProbeMutation[]
}

type HtmlNode = DefaultTreeAdapterTypes.Node
type HtmlElement = DefaultTreeAdapterTypes.Element

const LEGAL_INLINE_STYLE_MUTATION: CanvasProbeMutation = {
    id: 'legal-inline-style',
    file: 'entry/article.html',
    replace: {
        needle: 'id="linked-section"',
        value: 'id="linked-section" style="border-inline-start: 0.25rem solid var(--fc-entry-accent); padding-inline-start: 0.75rem"',
    },
}

const LEGAL_PUBLIC_COMPONENT_MUTATION: CanvasProbeMutation = {
    id: 'legal-public-component',
    file: 'entry/article.html',
    replace: {
        needle: '<p id="linked-section" data-fc-node-id="44444444-4444-4444-8444-444444444444" data-fc-node-kind="paragraph">交接样例正文。</p>',
        value: `<p id="linked-section" data-fc-node-id="44444444-4444-4444-8444-444444444444" data-fc-node-kind="paragraph">交接样例正文。</p>
      <div data-fc-node-id="c2000000-0000-4000-8000-000000000001" data-fc-node-kind="component" data-fc-component="c1000000-0000-4000-8000-000000000001" data-fc-component-revision="latest" data-fc-instance="c3000000-0000-4000-8000-000000000001" data-fc-prop-emphasis="true"><span data-fc-part="avatar">组件甲</span></div>
      <div data-fc-node-id="c2000000-0000-4000-8000-000000000002" data-fc-node-kind="component" data-fc-component="c1000000-0000-4000-8000-000000000001" data-fc-component-revision="3" data-fc-instance="c3000000-0000-4000-8000-000000000002"><span data-fc-part="avatar">组件乙</span></div>`,
    },
}

const LEGAL_RIBBON_FORMATTING_MUTATION: CanvasProbeMutation = {
    id: 'legal-ribbon-formatting',
    file: 'entry/article.html',
    replace: {
        needle: 'id="linked-section"',
        value: 'id="linked-section" class="fc-ribbon-sample"',
    },
}

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

function mutate(source: string, item: CanvasProbeMutation, category: '合法' | '恶意'): string {
    if (!source.includes(item.replace.needle)) {
        throw new Error(`${category}样例 ${item.id} 的替换锚点不存在。`)
    }
    return source.replace(item.replace.needle, item.replace.value)
}

export function createCanvasProbeCases(sources: CanvasProbeSources): readonly CanvasProbeCase[] {
    const inlineStyleHtml = mutate(sources.fixtureHtml, LEGAL_INLINE_STYLE_MUTATION, '合法')
    const publicComponentHtml = mutate(
        sources.fixtureHtml,
        LEGAL_PUBLIC_COMPONENT_MUTATION,
        '合法',
    )
    const ribbonFormattingHtml = mutate(
        sources.fixtureHtml,
        LEGAL_RIBBON_FORMATTING_MUTATION,
        '合法',
    )
    return [
        {
            id: 'legal-shared-fixture',
            label: '合法共享样例',
            validationHtml: sources.fixtureHtml,
            html: extractCanvasRenderableHtml(sources.fixtureHtml),
            css: sources.fixtureCss,
            assetIds: sources.assetIds,
        },
        {
            id: LEGAL_INLINE_STYLE_MUTATION.id,
            label: '合法：行内样式',
            validationHtml: inlineStyleHtml,
            html: extractCanvasRenderableHtml(inlineStyleHtml),
            css: sources.fixtureCss,
            assetIds: sources.assetIds,
        },
        {
            id: LEGAL_PUBLIC_COMPONENT_MUTATION.id,
            label: '合法：公共组件序列化',
            validationHtml: publicComponentHtml,
            html: extractCanvasRenderableHtml(publicComponentHtml),
            css: sources.fixtureCss,
            assetIds: sources.assetIds,
        },
        {
            id: LEGAL_RIBBON_FORMATTING_MUTATION.id,
            label: '合法：功能区文字节点',
            validationHtml: ribbonFormattingHtml,
            html: extractCanvasRenderableHtml(ribbonFormattingHtml),
            css: sources.fixtureCss,
            assetIds: sources.assetIds,
        },
        ...sources.maliciousCases.map(item => {
            const html = item.file.endsWith('.css')
                ? sources.fixtureHtml
                : mutate(sources.fixtureHtml, item, '恶意')
            const css = item.file.endsWith('.css')
                ? mutate(sources.fixtureCss, item, '恶意')
                : sources.fixtureCss
            return {
                id: item.id,
                label: `恶意：${item.id}`,
                validationHtml: html,
                html: extractCanvasRenderableHtml(html),
                css,
                assetIds: sources.assetIds,
            }
        }),
    ]
}
