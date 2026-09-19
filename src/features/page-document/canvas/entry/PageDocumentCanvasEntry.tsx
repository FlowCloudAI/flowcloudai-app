// 本组件是桌面与移动词条共用的生产只读预览；开发探针由独立构建别名追加。

import classNames from 'classnames'
import {useEffect, useMemo, useState} from 'react'
import {pageDocumentReadEntry, type PageDocument} from '../../../../api/pageDocument.ts'
import {PageDocumentProbeEntry} from '@page-document-probe-entry'
import {PageDocumentCanvas} from '../host/PageDocumentCanvas.tsx'
import {
    CANVAS_BASE_PROJECT_CSS,
    CANVAS_BASE_PROJECT_HTML,
    compileCanvasPreview,
    wrapMarkdownFallback,
} from '../host/compiledPreview.ts'
import {convertMarkdownToPageDocument} from '../../application/markdownDocumentConversion.ts'
import {markdownParagraphsToHtml} from '../host/markdownFallback.ts'
import type {PageDocumentCanvasEntryProps} from './types.ts'
import './PageDocumentCanvasEntry.css'

function sourceFromDocument(
    document: PageDocument | null,
    projectId: string,
    entryId: string,
    title: string,
    summary: string,
    markdown: string,
    convertLegacyMarkdown: boolean,
) {
    const conversion = !document && convertLegacyMarkdown ? convertMarkdownToPageDocument(entryId, markdown) : null
    const html = document?.html ?? conversion?.articleHtml ?? wrapMarkdownFallback(entryId, markdownParagraphsToHtml(markdown))
    return {
        key: document
            ? `${projectId}:${entryId}:${document.revision}`
            : `${projectId}:${entryId}:markdown:${markdown}`,
        html,
        css: document?.css ?? '',
        metadata: {id: entryId, title, summary, tags: []},
        derivedText: document?.derivedText ?? conversion?.derivedText ?? markdown,
    }
}

export function PageDocumentCanvasEntry(props: PageDocumentCanvasEntryProps) {
    const {projectId, entryId, title, summary, markdown, selectedNodeId = null, onNavigationIntent, onLinkHover, compact = false, convertLegacyMarkdown = false} = props
    const [document, setDocument] = useState<PageDocument | null>(null)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [runtimeError, setRuntimeError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        setLoadError(null)
        setDocument(null)
        void pageDocumentReadEntry(entryId)
            .then(result => {
                if (!cancelled) setDocument(result)
            })
            .catch(error => {
                if (!cancelled) setLoadError(String(error))
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [entryId])

    const source = useMemo(
        () => sourceFromDocument(document, projectId, entryId, title, summary, markdown, convertLegacyMarkdown),
        [convertLegacyMarkdown, document, entryId, markdown, projectId, summary, title],
    )
    const compiled = useMemo(() => compileCanvasPreview({
        projectArticleHtml: CANVAS_BASE_PROJECT_HTML,
        projectStyleCss: CANVAS_BASE_PROJECT_CSS,
        entryArticleHtml: source.html,
        entryStyleCss: source.css,
        metadata: source.metadata,
    }), [source])
    const authorErrors = compiled.diagnostics.filter(diagnostic => diagnostic.severity === 'error')

    return (
        <>
            <section className={classNames('page-document-canvas-entry', compact && 'is-compact')}>
                <header className="page-document-canvas-entry__header">
                    <h2>页面文档预览</h2>
                    <p>{convertLegacyMarkdown
                        ? `${document ? `页面文档 revision ${document.revision}` : '由旧 Markdown 正文临时转换，保存后成为页面文档'} · ${source.derivedText.length} 个字符`
                        : document ? `页面文档 revision ${document.revision}` : '未保存页面文档，显示 Markdown 安全降级预览'}</p>
                </header>

                {loading ? (
                    <p className="page-document-canvas-entry__state" role="status">正在读取页面文档…</p>
                ) : authorErrors.length > 0 || compiled.html === null || compiled.css === null ? (
                    <p className="page-document-canvas-entry__state" role="alert">
                        页面文档无法预览：{authorErrors[0]?.message ?? 'previewCompiler 未生成可渲染产物。'}
                    </p>
                ) : (
                    <PageDocumentCanvas
                        documentKey={source.key}
                        projectId={projectId}
                        html={compiled.html}
                        css={compiled.css}
                        selectedNodeId={selectedNodeId}
                        onNavigationIntent={onNavigationIntent}
                        onLinkHover={onLinkHover}
                        onRenderError={setRuntimeError}
                        onRendered={() => setRuntimeError(null)}
                    />
                )}

                {(loadError || runtimeError) && (
                    <p className="page-document-canvas-entry__state" role="alert">
                        {runtimeError
                            ? `隔离画布拒绝渲染：${runtimeError}`
                            : convertLegacyMarkdown
                                ? `页面文档读取失败，已显示临时转换结果：${loadError}`
                                : `页面文档读取失败，已降级显示 Markdown：${loadError}`}
                    </p>
                )}
            </section>
            <PageDocumentProbeEntry {...props}/>
        </>
    )
}
