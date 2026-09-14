// 本模块把项目默认源、词条覆盖和元数据编译为可丢弃 srcdoc；产物绝不反向覆盖作者文件。
import {defaultTreeAdapter, serialize} from 'parse5'
import type {DocumentDiagnostic} from '../contract.ts'
import {cloneHtmlTree} from '../kernel/composition/index.ts'
import {parseCssSource} from './cssParser.ts'
import {guardDocumentSources} from './guard.ts'
import {findFirstElementByTagName, hasBlockingDiagnostics, parseHtmlSource} from './htmlParser.ts'
import {createTextProjection} from './textProjection.ts'
import {createTextBlocks, type DocumentTextBlock} from './textBlocks.ts'
import {mergeEntryTemplate, type EntryMetadataInput} from './templateMerge.ts'

const RENDERER_BASELINE_CSS = `@layer fc-renderer {
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; }
  html { background: var(--fc-entry-surface, Canvas); }
  body { overflow-wrap: anywhere; }
  img { display: block; max-width: 100%; height: auto; }
  [data-fc-node-kind] { min-width: 0; margin: 0; padding: 0; }
  [data-fc-node-kind="list"] { list-style-position: inside; }
  [data-fc-node-kind="table"] { width: 100%; border-collapse: collapse; }
  [data-fc-node-kind="table-cell"] {
    padding: 0.625rem;
    vertical-align: top;
    border: 1px solid var(--fc-entry-border, color-mix(in srgb, var(--fc-entry-text, CanvasText) 22%, transparent));
  }
  th[data-fc-node-kind="table-cell"] {
    text-align: start;
    font-weight: 650;
    background: color-mix(in srgb, var(--fc-entry-accent, Highlight) 10%, transparent);
  }
  [data-fc-node-kind="asset"] { overflow: clip; }
  [data-fc-node-kind="divider"] {
    height: 0;
    border: 0;
    border-block-start: 1px solid var(--fc-entry-border, color-mix(in srgb, var(--fc-entry-text, CanvasText) 22%, transparent));
  }
}
`

export interface PreviewCompileInput {
    projectArticleHtml: string
    projectStyleCss: string
    entryArticleHtml: string
    entryStyleCss: string
    metadata: EntryMetadataInput
    assetIds?: readonly string[]
    paragraphLimit?: number
    assetLimit?: number
}

export interface PreviewArtifact {
    srcdoc: string | null
    textProjection: string | null
    textBlocks: DocumentTextBlock[] | null
    diagnostics: DocumentDiagnostic[]
    referencedAssetIds: string[]
    templateVersion: number | null
}

function appendStyle(
    head: NonNullable<ReturnType<typeof findFirstElementByTagName>>,
    scope: 'renderer' | 'project' | 'entry',
    css: string,
): void {
    const style = defaultTreeAdapter.createElement('style', head.namespaceURI, [
        {
            name: 'data-fc-style-scope',
            value: scope,
        },
    ])
    defaultTreeAdapter.insertText(style, css)
    defaultTreeAdapter.appendChild(head, style)
}

export function compilePreviewArtifact(input: PreviewCompileInput): PreviewArtifact {
    const projectHtml = parseHtmlSource(input.projectArticleHtml, {
        mode: 'document',
        scope: 'project',
    })
    const entryHtml = parseHtmlSource(input.entryArticleHtml, {mode: 'fragment', scope: 'entry'})
    const projectCss = parseCssSource(input.projectStyleCss, 'project')
    const entryCss = parseCssSource(input.entryStyleCss, 'entry')
    const knownAssetIds = new Set((input.assetIds ?? []).map(id => id.toLowerCase()))
    const guard = guardDocumentSources([projectHtml, entryHtml], [projectCss, entryCss], {
        knownAssetIds,
        paragraphLimit: input.paragraphLimit,
        assetLimit: input.assetLimit,
    })
    const merge = mergeEntryTemplate(projectHtml, entryHtml, input.metadata)
    const diagnostics = [
        ...merge.diagnostics,
        ...projectCss.diagnostics,
        ...entryCss.diagnostics,
        ...guard.diagnostics,
    ]
    if (!merge.html || !merge.parsedHtml || hasBlockingDiagnostics(diagnostics)) {
        return {
            srcdoc: null,
            textProjection: null,
            textBlocks: null,
            diagnostics,
            referencedAssetIds: guard.referencedAssetIds,
            templateVersion: merge.templateVersion,
        }
    }

    const merged = merge.parsedHtml
    const previewRoot = cloneHtmlTree(merged.root)
    const head = findFirstElementByTagName(previewRoot, 'head')
    if (!head) {
        diagnostics.push({
            severity: 'error',
            category: 'capability',
            code: 'missing_preview_head',
            message: '合并文档缺少 head，无法注入受管样式。',
            file: 'article.html',
        })
    }
    if (!head || hasBlockingDiagnostics(diagnostics)) {
        return {
            srcdoc: null,
            textProjection: null,
            textBlocks: null,
            diagnostics,
            referencedAssetIds: guard.referencedAssetIds,
            templateVersion: merge.templateVersion,
        }
    }

    const textProjection = createTextProjection(merged)
    const textBlocks = createTextBlocks(merged)
    appendStyle(head, 'renderer', RENDERER_BASELINE_CSS)
    appendStyle(head, 'project', input.projectStyleCss)
    appendStyle(head, 'entry', input.entryStyleCss)
    return {
        srcdoc: serialize(previewRoot),
        textProjection,
        textBlocks,
        diagnostics,
        referencedAssetIds: guard.referencedAssetIds,
        templateVersion: merge.templateVersion,
    }
}
