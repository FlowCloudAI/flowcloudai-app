// 本浮层创建公共组件首个修订；源码安全与资源归属最终由 Rust 创建命令验证。

import {useEffect, useState} from 'react'
import {Button, Input} from 'flowcloudai-ui'
import type {CreatePageDocumentComponentInput} from '../../../../api/pageDocument.ts'
import {pageDocumentComponentErrorMessage} from '../../../../api/pageDocument.ts'
import {FloatingPanel} from '../../../../shared/ui/overlay'
import {buildPublicComponentCreationInput} from '../../application/publicComponentDefinitionForm.ts'
import {CodeSourceEditor} from '../source/CodeSourceEditor.tsx'
import './PublicComponentDefinitionCreator.css'

const INITIAL_HTML = '<article>\n  <h2>{{title}}</h2>\n  <div data-fc-part="body"></div>\n</article>'
const INITIAL_CSS = '@layer fc-component {\n  [data-fc-component="template"] {\n    display: block;\n  }\n}'

export function PublicComponentDefinitionCreator({
    open,
    projectId,
    onClose,
    onCreate,
}: {
    open: boolean
    projectId: string
    onClose: () => void
    onCreate: (input: Omit<CreatePageDocumentComponentInput, 'projectId'>) => Promise<void>
}) {
    const [name, setName] = useState('')
    const [category, setCategory] = useState('基础')
    const [html, setHtml] = useState(INITIAL_HTML)
    const [css, setCss] = useState(INITIAL_CSS)
    const [propertyLines, setPropertyLines] = useState('title | text | optional')
    const [partLines, setPartLines] = useState('body | text | optional')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!open) return
        queueMicrotask(() => {
            setName('')
            setCategory('基础')
            setHtml(INITIAL_HTML)
            setCss(INITIAL_CSS)
            setPropertyLines('title | text | optional')
            setPartLines('body | text | optional')
            setBusy(false)
            setError(null)
        })
    }, [open])

    const submit = async () => {
        if (busy) return
        setBusy(true)
        setError(null)
        try {
            const input = buildPublicComponentCreationInput(projectId, {
                name,
                category,
                html,
                css,
                propertyLines,
                partLines,
            })
            await onCreate({
                name: input.name,
                category: input.category,
                html: input.html,
                css: input.css,
                propertySchema: input.propertySchema,
                partSchema: input.partSchema,
                styleVariableSchema: input.styleVariableSchema,
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
        title="新建公共组件"
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
            </div>
            <p>本入口只创建修订 1；已有组件追加修订将在“编辑公共组件”中开放。</p>
            {error && <p role="alert" className="public-component-creator__error">{error}</p>}
            <div className="public-component-creator__actions">
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>取消</Button>
                <Button type="button" size="sm" disabled={busy || !name.trim() || !category.trim()} onClick={() => void submit()}>
                    {busy ? '创建中…' : '创建组件'}
                </Button>
            </div>
        </div>
    </FloatingPanel>
}
