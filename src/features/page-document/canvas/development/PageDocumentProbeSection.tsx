// 本组件只服务显式探针构建；它可绕过作者校验，绝不得进入默认产物。

import classNames from 'classnames'
import {Button, Select} from 'flowcloudai-ui'
import {useEffect, useMemo, useState} from 'react'
import {PageDocumentCanvas} from '../host/PageDocumentCanvas.tsx'
import {compileCanvasPreview} from '../host/compiledPreview.ts'
import type {PageDocumentCanvasEntryProps} from '../entry/types.ts'
import {
    CANVAS_PROBE_CASES,
    CANVAS_PROBE_PROJECT,
    type CanvasProbeCase,
} from './probeFixtures.ts'
import './PageDocumentProbeSection.css'

function sourceFromProbe(probe: CanvasProbeCase) {
    return {
        key: `probe:${probe.id}`,
        validationHtml: probe.validationHtml,
        html: probe.html,
        css: probe.css,
        projectCss: probe.projectCss,
        assetIds: probe.assetIds,
    }
}

export function PageDocumentProbeSection({
    onNavigationIntent,
    compact = false,
}: PageDocumentCanvasEntryProps) {
    const [probeId, setProbeId] = useState(CANVAS_PROBE_CASES[0]?.id ?? '')
    const [bypassAuthorGuard, setBypassAuthorGuard] = useState(false)
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
    const [runtimeError, setRuntimeError] = useState<string | null>(null)
    const probe = CANVAS_PROBE_CASES.find(item => item.id === probeId) ?? CANVAS_PROBE_CASES[0]
    const source = useMemo(() => probe ? sourceFromProbe(probe) : null, [probe])
    const compiled = useMemo(() => source ? compileCanvasPreview({
        projectArticleHtml: CANVAS_PROBE_PROJECT.html,
        projectStyleCss: source.projectCss,
        entryArticleHtml: source.validationHtml,
        entryStyleCss: source.css,
        metadata: CANVAS_PROBE_PROJECT.metadata,
        assetIds: source.assetIds,
    }) : null, [source])
    const authorErrors = bypassAuthorGuard
        ? []
        : compiled?.diagnostics.filter(diagnostic => diagnostic.severity === 'error') ?? []
    const canvasHtml = bypassAuthorGuard ? source?.html ?? null : compiled?.html ?? null
    const canvasCss = bypassAuthorGuard ? source?.css ?? null : compiled?.css ?? null

    useEffect(() => {
        setSelectedNodeId(null)
        setRuntimeError(null)
    }, [probeId, bypassAuthorGuard])

    if (!source) return null
    return (
        <section className={classNames('page-document-probe-section', compact && 'is-compact')}>
            <header className="page-document-probe-section__header">
                <div>
                    <h2>隔离探针</h2>
                    <p>仅供原生隔离验收，不代表当前词条内容。</p>
                </div>
                <div className="page-document-probe-section__controls">
                    <Select
                        aria-label="隔离探针"
                        value={probeId}
                        options={CANVAS_PROBE_CASES.map(item => ({value: item.id, label: item.label}))}
                        onValueChange={value => setProbeId(String(value))}
                    />
                    <Button
                        type="button"
                        size="sm"
                        variant={bypassAuthorGuard ? 'primary' : 'outline'}
                        aria-pressed={bypassAuthorGuard}
                        onClick={() => setBypassAuthorGuard(value => !value)}
                    >
                        跳过作者侧校验，仅用于验证隔离
                    </Button>
                </div>
            </header>

            {bypassAuthorGuard && (
                <p className="page-document-probe-section__state" role="status">
                    跳过模式直接发送原始片段，不含项目模板与基础样式，排版简陋属正常
                </p>
            )}

            {authorErrors.length > 0 || canvasHtml === null || canvasCss === null ? (
                <p className="page-document-probe-section__state" role="alert">
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

            {(runtimeError || selectedNodeId) && (
                <p className="page-document-probe-section__state" role={runtimeError ? 'alert' : 'status'}>
                    {runtimeError ? `隔离层拒绝渲染：${runtimeError}` : `已选中节点：${selectedNodeId}`}
                </p>
            )}
        </section>
    )
}
