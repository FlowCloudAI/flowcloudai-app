// 本浮层创建公共组件首个修订；源码安全与资源归属最终由 Rust 创建命令验证。

import {useEffect, useState} from 'react'
import {Button, Input} from 'flowcloudai-ui'
import type {CreatePageDocumentComponentInput, PageDocumentAsset} from '../../../../api/pageDocument.ts'
import {pageDocumentComponentErrorMessage} from '../../../../api/pageDocument.ts'
import {FloatingPanel} from '../../../../shared/ui/overlay'
import {
    buildPublicComponentCreationInput,
    type PublicComponentDefinitionFormValue,
} from '../../application/publicComponentDefinitionForm.ts'
import {CodeSourceEditor} from '../source/CodeSourceEditor.tsx'
import {PageDocumentAssetThumbnail} from '../assets/PageDocumentAssetPicker.tsx'
import './PublicComponentDefinitionCreator.css'

const INITIAL_HTML = '<article>\n  <h2>{{title}}</h2>\n  <div data-fc-part="body"></div>\n</article>'

function initialCss(componentId: string): string {
    return `@layer fc-component {\n  [data-fc-component="${componentId}"] {\n    display: block;\n  }\n}`
}

export function PublicComponentDefinitionCreator({
    open,
    projectId,
    componentId,
    expectedRevision,
    initialValue,
    initialPreviewAssetId,
    assets,
    onClose,
    onSave,
}: {
    open: boolean
    projectId: string
    componentId: string
    expectedRevision?: number
    initialValue?: PublicComponentDefinitionFormValue
    initialPreviewAssetId?: string | null
    assets: readonly PageDocumentAsset[]
    onClose: () => void
    onSave: (input: Omit<CreatePageDocumentComponentInput, 'projectId'>) => Promise<void>
}) {
    const [name, setName] = useState('')
    const [category, setCategory] = useState('基础')
    const [html, setHtml] = useState(INITIAL_HTML)
    const [css, setCss] = useState(() => initialCss(componentId))
    const [propertyLines, setPropertyLines] = useState('title | text | optional')
    const [partLines, setPartLines] = useState('body | text | optional')
    const [styleVariableLines, setStyleVariableLines] = useState('')
    const [previewAssetId, setPreviewAssetId] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!open) return
        queueMicrotask(() => {
            setName(initialValue?.name ?? '')
            setCategory(initialValue?.category ?? '基础')
            setHtml(initialValue?.html ?? INITIAL_HTML)
            setCss(initialValue?.css ?? initialCss(componentId))
            setPropertyLines(initialValue?.propertyLines ?? 'title | text | optional')
            setPartLines(initialValue?.partLines ?? 'body | text | optional')
            setStyleVariableLines(initialValue?.styleVariableLines ?? '')
            setPreviewAssetId(initialPreviewAssetId ?? null)
            setBusy(false)
            setError(null)
        })
    }, [componentId, initialPreviewAssetId, initialValue, open])

    const submit = async () => {
        if (busy) return
        setBusy(true)
        setError(null)
        try {
            const input = buildPublicComponentCreationInput(projectId, componentId, {
                name,
                category,
                html,
                css,
                propertyLines,
                partLines,
                styleVariableLines,
            })
            await onSave({
                componentId: input.componentId,
                expectedRevision,
                name: input.name,
                category: input.category,
                html: input.html,
                css: input.css,
                propertySchema: input.propertySchema,
                partSchema: input.partSchema,
                styleVariableSchema: input.styleVariableSchema,
                previewAssetId: previewAssetId ?? undefined,
            })
            onClose()
        } catch (cause) {
            setError(cause instanceof TypeError ? cause.message : pageDocumentComponentErrorMessage(cause))
        } finally {
            setBusy(false)
        }
    }

    return <FloatingPanel
        open={open}
        onClose={onClose}
        dismissible={!busy}
        title={expectedRevision ? `编辑公共组件 · 基于 r${expectedRevision}` : '新建公共组件'}
        className="public-component-creator"
    >
        <div className="public-component-creator__body">
            <div className="public-component-creator__metadata">
                <label>名称<Input value={name} maxLength={128} disabled={busy} onValueChange={setName} /></label>
                <label>分类<Input value={category} maxLength={128} disabled={busy} onValueChange={setCategory} /></label>
            </div>
            <div className="public-component-creator__sources">
                <label>HTML</label>
                <div className="public-component-creator__editor">
                    <CodeSourceEditor file="article.html" value={html} diagnostics={[]} onChange={setHtml} onHistoryChange={() => undefined} />
                </div>
                <label>CSS</label>
                <div className="public-component-creator__editor">
                    <CodeSourceEditor file="style.css" value={css} diagnostics={[]} onChange={setCss} onHistoryChange={() => undefined} />
                </div>
            </div>
            <div className="public-component-creator__schemas">
                <label>属性 schema（名称 | 类型 | required/optional）
                    <textarea value={propertyLines} disabled={busy} onChange={event => setPropertyLines(event.target.value)} />
                </label>
                <label>插槽 schema（名称 | 类型列表 | required/optional）
                    <textarea value={partLines} disabled={busy} onChange={event => setPartLines(event.target.value)} />
                </label>
                <label>样式变量 schema（--名称 | 语法 | 初始值）
                    <textarea value={styleVariableLines} disabled={busy} onChange={event => setStyleVariableLines(event.target.value)} />
                </label>
            </div>
            <section className="public-component-creator__preview" aria-label="组件预览图">
                <strong>预览图（可选）</strong>
                <div>
                    <button type="button" className={previewAssetId === null ? 'is-selected' : ''} disabled={busy} onClick={() => setPreviewAssetId(null)}>不使用预览图</button>
                    {assets.map(asset => <button
                        type="button"
                        key={asset.id}
                        className={previewAssetId === asset.id ? 'is-selected' : ''}
                        disabled={busy}
                        onClick={() => setPreviewAssetId(asset.id)}
                    >
                        <PageDocumentAssetThumbnail asset={asset} />
                        <span>{asset.width} × {asset.height}</span>
                    </button>)}
                </div>
            </section>
            <p>{expectedRevision ? '保存会追加新修订；旧修订继续供固定实例使用。' : '创建后生成修订 1；当前页面不会因创建定义而自动改变。'}</p>
            {error && <p role="alert" className="public-component-creator__error">{error}</p>}
            <div className="public-component-creator__actions">
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>取消</Button>
                <Button type="button" size="sm" disabled={busy || !name.trim() || !category.trim()} onClick={() => void submit()}>
                    {busy ? '保存中…' : expectedRevision ? '发布新修订' : '创建组件'}
                </Button>
            </div>
        </div>
    </FloatingPanel>
}
