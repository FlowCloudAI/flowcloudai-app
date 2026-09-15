// 本组件是显式构建开关下的只读入口；它读取页面文档、提供共享隔离探针并显示 bridge 状态。

import classNames from 'classnames'
import {Button, Select} from 'flowcloudai-ui'
import {useEffect, useMemo, useState} from 'react'
import {pageDocumentReadEntry, type PageDocument} from '../../../../api/pageDocument.ts'
import {PageDocumentCanvas} from '../host/PageDocumentCanvas.tsx'
import {
    CANVAS_BASE_PROJECT_CSS,
    CANVAS_BASE_PROJECT_HTML,
    compileCanvasPreview,
    wrapMarkdownFallback,
} from '../host/compiledPreview.ts'
import {markdownParagraphsToHtml} from '../host/markdownFallback.ts'
import type {PageDocumentCanvasEntryProps} from '../entry/types.ts'
import {
    CANVAS_PROBE_CASES,
    CANVAS_PROBE_PROJECT,
    type CanvasProbeCase,
} from './probeFixtures.ts'
import './PageDocumentPreviewSection.css'

const CURRENT_DOCUMENT_ID = 'current-document'

interface CanvasSource {
    key: string
    validationHtml: string
    html: string
    css: string
    projectHtml: string
    projectCss: string
    metadata: {id: string; title: string; summary: string; tags: string[]}
    assetIds?: string[]
}

function sourceFromDocument(
    document: PageDocument | null,
    projectId: string,
    entryId: string,
    title: string,
    summary: string,
    markdown: string,
): CanvasSource {
    const entryHtml = document?.html
        ?? wrapMarkdownFallback(entryId, markdownParagraphsToHtml(markdown))
    if (document) {
        return {
            key: `${projectId}:${entryId}:${document.revision}`,
            validationHtml: entryHtml,
            html: entryHtml,
            css: document.css,
            projectHtml: CANVAS_BASE_PROJECT_HTML,
            projectCss: CANVAS_BASE_PROJECT_CSS,
            metadata: {id: entryId, title, summary, tags: []},
        }
    }
    return {
        key: `${projectId}:${entryId}:markdown:${markdown}`,
        validationHtml: entryHtml,
        html: entryHtml,
        css: '',
        projectHtml: CANVAS_BASE_PROJECT_HTML,
        projectCss: CANVAS_BASE_PROJECT_CSS,
        metadata: {id: entryId, title, summary, tags: []},
    }
}

function sourceFromProbe(probe: CanvasProbeCase): CanvasSource {
    return {
        key: `probe:${probe.id}`,
        validationHtml: probe.validationHtml,
        html: probe.html,
        css: probe.css,
        projectHtml: CANVAS_PROBE_PROJECT.html,
        projectCss: CANVAS_PROBE_PROJECT.css,
        metadata: CANVAS_PROBE_PROJECT.metadata,
        assetIds: probe.assetIds,
    }
}

export function PageDocumentPreviewSection({
    entryId,
    projectId,
    title,
    summary,
    markdown,
    onNavigationIntent,
    compact = false,
}: PageDocumentCanvasEntryProps) {
    const [document, setDocument] = useState<PageDocument | null>(null)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [probeId, setProbeId] = useState(CURRENT_DOCUMENT_ID)
    const [bypassAuthorGuard, setBypassAuthorGuard] = useState(false)
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
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

    const source = useMemo(() => {
        const probe = CANVAS_PROBE_CASES.find(item => item.id === probeId)
        return probe
            ? sourceFromProbe(probe)
            : sourceFromDocument(document, projectId, entryId, title, summary, markdown)
    }, [document, entryId, markdown, probeId, projectId, summary, title])
    const compiled = useMemo(() => compileCanvasPreview({
        projectArticleHtml: source.projectHtml,
        projectStyleCss: source.projectCss,
        entryArticleHtml: source.validationHtml,
        entryStyleCss: source.css,
        metadata: source.metadata,
        assetIds: source.assetIds,
    }), [source])
    const bypassIsolationProbe = bypassAuthorGuard && probeId !== CURRENT_DOCUMENT_ID
    const authorErrors = bypassIsolationProbe
        ? []
        : compiled.diagnostics.filter(diagnostic => diagnostic.severity === 'error')
    const canvasHtml = bypassIsolationProbe ? source.html : compiled.html
    const canvasCss = bypassIsolationProbe ? source.css : compiled.css

    useEffect(() => {
        setSelectedNodeId(null)
        setRuntimeError(null)
    }, [source.key, bypassAuthorGuard])

    return (
        <section className={classNames('page-document-preview-section', compact && 'is-compact')}>
            <header className="page-document-preview-section__header">
                <div>
                    <h2>页面文档预览</h2>
                    <p>{document ? `页面文档 revision ${document.revision}` : '未保存页面文档，显示 Markdown 安全降级预览'}</p>
                </div>
                <div className="page-document-preview-section__probe-controls">
                    <Select
                        aria-label="隔离探针"
                        value={probeId}
                        options={[
                            {value: CURRENT_DOCUMENT_ID, label: '当前词条'},
                            ...CANVAS_PROBE_CASES.map(item => ({value: item.id, label: item.label})),
                        ]}
                        onValueChange={value => setProbeId(String(value))}
                    />
                    <Button
                        type="button"
                        size="sm"
                        variant={bypassAuthorGuard ? 'primary' : 'outline'}
                        aria-pressed={bypassAuthorGuard}
                        disabled={probeId === CURRENT_DOCUMENT_ID}
                        onClick={() => setBypassAuthorGuard(value => !value)}
                    >
                        跳过作者侧校验，仅用于验证隔离
                    </Button>
                </div>
            </header>

            {loading && probeId === CURRENT_DOCUMENT_ID ? (
                <p className="page-document-preview-section__state" role="status">正在读取页面文档…</p>
            ) : authorErrors.length > 0 || canvasHtml === null || canvasCss === null ? (
                <p className="page-document-preview-section__state" role="alert">
                    作者侧校验已阻止：{authorErrors[0]?.message ?? 'previewCompiler 未生成可渲染产物。'}
                </p>
            ) : (
                <PageDocumentCanvas
                    documentKey={`${source.key}:${bypassAuthorGuard}`}
                    html={canvasHtml}
                    css={canvasCss}
                    selectedNodeId={selectedNodeId}
                    onSelectionChange={setSelectedNodeId}
                    onNavigationIntent={onNavigationIntent}
                    onRenderError={setRuntimeError}
                    onRendered={() => setRuntimeError(null)}
                />
            )}

            {(loadError || runtimeError || selectedNodeId) && (
                <p className="page-document-preview-section__state" role={loadError || runtimeError ? 'alert' : 'status'}>
                    {loadError ? `页面文档读取失败，已降级显示 Markdown：${loadError}` : runtimeError ? `隔离层拒绝渲染：${runtimeError}` : `已选中节点：${selectedNodeId}`}
                </p>
            )}
            <p className="page-document-preview-section__probe-note">
                隔离探针仅用于原生调试构建；默认构建不会包含本区域。
            </p>
        </section>
    )
}
