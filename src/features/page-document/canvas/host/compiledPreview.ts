// 本模块把领域 previewCompiler 的完整文档产物拆成画布 HTML/CSS；宿主不自行拼装可执行文档。

import {defaultTreeAdapter, parse, serialize, serializeOuter, type DefaultTreeAdapterTypes} from 'parse5'
import type {DocumentDiagnostic} from '../../domain/contract.ts'
import {compilePreviewArtifact, type PreviewCompileInput} from '../../domain/engine/previewCompiler.ts'
import {guardDocumentSources} from '../../domain/engine/guard.ts'
import {parseCssSource} from '../../domain/engine/cssParser.ts'
import {parseHtmlSource} from '../../domain/engine/htmlParser.ts'

export const CANVAS_BASE_PROJECT_HTML = `<!doctype html>
<html lang="zh-CN" data-fc-document-version="1" data-fc-template-version="1">
<head><title data-fc-bind="title">词条</title></head>
<body>
  <main class="fc-entry" data-fc-slot="entry-root">
    <header class="fc-entry__header" data-fc-slot="entry-header"></header>
    <section class="fc-entry__body" data-fc-slot="entry-body"></section>
  </main>
</body>
</html>`

export const CANVAS_BASE_PROJECT_CSS = `@layer fc-canvas-defaults, fc-renderer, fc-component, fc-project, fc-entry, fc-node, fc-author;
@layer fc-project {
  :root {
    color-scheme: light dark;
    --fc-entry-surface: Canvas;
    --fc-entry-text: CanvasText;
    --fc-entry-accent: Highlight;
  }
  .fc-entry { color: var(--fc-entry-text); background: var(--fc-entry-surface); }
}`

export interface CompiledCanvasPreview {
    html: string | null
    css: string | null
    diagnostics: DocumentDiagnostic[]
}

type HtmlNode = DefaultTreeAdapterTypes.Node
type HtmlElement = DefaultTreeAdapterTypes.Element

function isElement(node: HtmlNode): node is HtmlElement {
    return 'tagName' in node && 'attrs' in node
}

function walkElements(node: HtmlNode, visit: (element: HtmlElement) => void): void {
    if (isElement(node)) visit(node)
    if ('childNodes' in node) node.childNodes.forEach(child => walkElements(child, visit))
    if (isElement(node) && node.tagName === 'template' && 'content' in node) {
        node.content.childNodes.forEach(child => walkElements(child, visit))
    }
}

function elementText(element: HtmlElement): string {
    return element.childNodes.map(child => {
        if ('value' in child) return child.value
        return isElement(child) ? elementText(child) : ''
    }).join('')
}

function splitCompiledDocument(srcdoc: string): {html: string; css: string} | null {
    const document = parse(srcdoc, {scriptingEnabled: false})
    let body: HtmlElement | null = null
    const styles: string[] = []
    walkElements(document, element => {
        if (element.tagName === 'body') body = element
        if (element.tagName === 'style') styles.push(elementText(element))
    })
    if (!body) return null
    return {
        html: (body as HtmlElement).childNodes.map(child => serializeOuter(child)).join(''),
        css: styles.join('\n'),
    }
}

function projectSourceWithoutRuntimeMeta(source: string): string {
    const document = parse(source, {scriptingEnabled: false})
    const removable: HtmlElement[] = []
    walkElements(document, element => {
        if (element.tagName !== 'meta') return
        const attributes = new Map(element.attrs.map(attribute => [attribute.name, attribute.value]))
        const isCharset = attributes.has('charset') && attributes.size === 1
        const isViewport = attributes.get('name')?.toLowerCase() === 'viewport'
            && [...attributes.keys()].every(name => name === 'name' || name === 'content')
        if (isCharset || isViewport) removable.push(element)
    })
    removable.forEach(element => defaultTreeAdapter.detachNode(element))
    return serialize(document)
}

function discoverAssetIds(input: PreviewCompileInput): string[] {
    const htmlSources = [
        parseHtmlSource(input.projectArticleHtml, {mode: 'document', scope: 'project'}),
        parseHtmlSource(input.entryArticleHtml, {mode: 'fragment', scope: 'entry'}),
    ]
    const cssSources = [
        parseCssSource(input.projectStyleCss, 'project'),
        parseCssSource(input.entryStyleCss, 'entry'),
    ]
    return guardDocumentSources(htmlSources, cssSources).referencedAssetIds
}

export function compileCanvasPreview(input: PreviewCompileInput): CompiledCanvasPreview {
    const preparedInput = {
        ...input,
        projectArticleHtml: projectSourceWithoutRuntimeMeta(input.projectArticleHtml),
    }
    const artifact = compilePreviewArtifact({
        ...preparedInput,
        assetIds: input.assetIds ?? discoverAssetIds(preparedInput),
    })
    if (!artifact.srcdoc) return {html: null, css: null, diagnostics: artifact.diagnostics}
    const split = splitCompiledDocument(artifact.srcdoc)
    if (!split) {
        return {
            html: null,
            css: null,
            diagnostics: [...artifact.diagnostics, {
                severity: 'error',
                category: 'capability',
                code: 'missing_canvas_body',
                message: '编译后的页面文档缺少 body。',
                file: 'article.html',
            }],
        }
    }
    return {...split, diagnostics: artifact.diagnostics}
}

export function wrapMarkdownFallback(entryId: string, bodyHtml: string): string {
    return `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${entryId}" data-fc-base-template-version="1">
  <template data-fc-fill="entry-header"><h1 data-fc-bind="title"></h1><p data-fc-bind="summary"></p></template>
  <template data-fc-fill="entry-body"><div data-fc-node-id="${entryId}" data-fc-node-kind="container" data-fc-editor-root data-fc-layout="stack">${bodyHtml}</div></template>
</template>`
}
