// 本组件呈现“所有宽度”的安全属性子集；源码检查和改写都委托给文档内核适配层。

import {useEffect, useMemo, useRef, useState} from 'react'
import {Input} from 'flowcloudai-ui'
import type {LayerProjectionNode} from '../../domain/layerProjection.ts'
import type {
    InspectVisualComponent,
    VisualPropertyGroup,
    VisualPropertyState,
} from '../../application/visualPropertyEditing.ts'
import {
    createVisualPropertyEditRequest,
    inspectVisualProperties,
    validateVisualPropertyValue,
} from '../../application/visualPropertyEditing.ts'
import type {KernelDraftEditRequest} from '../../application/documentKernelDraftRuntime.ts'
import './PageDocumentPropertiesPanel.css'

interface PageDocumentPropertiesPanelProps {
    node: LayerProjectionNode | null
    entryStyleCss: string
    inspectComponent: InspectVisualComponent
    applyKernelEntry: (
        request: KernelDraftEditRequest,
        label: string,
        history?: {historyGroupId?: string},
    ) => Promise<boolean>
    visualError: string | null
}

const TABS: readonly {key: VisualPropertyGroup; label: string}[] = [
    {key: 'text', label: '文字'},
    {key: 'layout', label: '布局'},
    {key: 'appearance', label: '颜色与效果'},
]

const NODE_KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
    container: '容器',
    paragraph: '段落',
    heading: '标题',
    image: '图片',
    link: '链接',
    list: '列表',
    'list-item': '列表项',
    table: '表格',
    'table-cell': '表格单元格',
    quote: '引用',
    divider: '分隔线',
})

function editableValue(field: VisualPropertyState): string {
    return field.localValue ?? field.value
}

function colorPickerValue(value: string): string {
    return /^#[\da-f]{6}$/iu.test(value) ? value : '#000000'
}

function PropertyField({
    field,
    nodeId,
    onApply,
}: {
    field: VisualPropertyState
    nodeId: string
    onApply: PageDocumentPropertiesPanelProps['applyKernelEntry']
}) {
    const initialValue = editableValue(field)
    const [draft, setDraft] = useState(initialValue)
    const [error, setError] = useState<string | null>(null)
    const historyGroupRef = useRef<string | null>(null)

    useEffect(() => {
        setDraft(initialValue)
        setError(null)
    }, [field.property, initialValue, nodeId])

    const beginInteraction = () => {
        historyGroupRef.current ??= crypto.randomUUID()
    }
    const commit = async (value: string) => {
        const validation = validateVisualPropertyValue(field.property, value)
        setError(validation.message)
        if (!validation.valid || field.disabled || value === initialValue) return
        const historyGroupId = historyGroupRef.current ?? crypto.randomUUID()
        const request = createVisualPropertyEditRequest(nodeId, field.property, value, {
            historyGroupId,
        })
        const applied = await onApply(request, `调整${field.label}`, {historyGroupId})
        if (!applied) setDraft(initialValue)
    }
    const finishInteraction = () => {
        void commit(draft)
        historyGroupRef.current = null
    }
    const isColor = field.property === 'color' || field.property === 'background-color'

    return (
        <label className={`page-document-property${field.disabled ? ' is-disabled' : ''}`}>
            <span className="page-document-property__heading">
                <span>{field.label}</span>
                <span data-source-state={field.sourceState}>{field.statusText}</span>
            </span>
            <span className="page-document-property__control">
                {isColor && (
                    <input
                        className="page-document-property__color"
                        type="color"
                        aria-label={`${field.label}颜色选择`}
                        value={colorPickerValue(draft)}
                        disabled={field.disabled}
                        onFocus={beginInteraction}
                        onChange={event => {
                            const next = event.target.value
                            setDraft(next)
                            void commit(next)
                        }}
                        onBlur={() => {
                            historyGroupRef.current = null
                        }}
                    />
                )}
                <Input
                    value={draft}
                    size="sm"
                    status={error ? 'error' : 'default'}
                    disabled={field.disabled}
                    placeholder="未设置"
                    onFocus={beginInteraction}
                    onValueChange={next => {
                        setDraft(next)
                        setError(validateVisualPropertyValue(field.property, next).message)
                    }}
                    onKeyDown={event => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                    }}
                    onBlur={finishInteraction}
                />
            </span>
            {(error || field.reason) && (
                <span className="page-document-property__message" role={error ? 'alert' : undefined}>
                    {error ?? field.reason}
                </span>
            )}
        </label>
    )
}

export function PageDocumentPropertiesPanel({
    node,
    entryStyleCss,
    inspectComponent,
    applyKernelEntry,
    visualError,
}: PageDocumentPropertiesPanelProps) {
    const [tab, setTab] = useState<VisualPropertyGroup>('text')
    const fields = useMemo(
        () => node ? inspectVisualProperties(node, inspectComponent, entryStyleCss) : [],
        [entryStyleCss, inspectComponent, node],
    )

    return (
        <section className="page-document-properties-panel">
            <header>
                <strong>属性 · {node ? (NODE_KIND_LABELS[node.kind] ?? node.kind) : '未选择'}</strong>
                <span>修改范围 · 所有宽度</span>
            </header>
            <div className="page-document-properties-panel__tabs" role="tablist" aria-label="属性分类">
                {TABS.map(item => (
                    <button
                        key={item.key}
                        type="button"
                        role="tab"
                        aria-selected={tab === item.key}
                        className={tab === item.key ? 'is-active' : ''}
                        onClick={() => setTab(item.key)}
                    >{item.label}</button>
                ))}
            </div>
            {!node ? (
                <p className="page-document-properties-panel__empty">在画布或图层中选择一个元素</p>
            ) : (
                <div className="page-document-properties-panel__fields">
                    {fields.filter(field => field.group === tab).map(field => (
                        <PropertyField
                            key={`${node.id}:${field.property}`}
                            field={field}
                            nodeId={node.id}
                            onApply={applyKernelEntry}
                        />
                    ))}
                </div>
            )}
            {visualError && <p className="page-document-properties-panel__error" role="alert">{visualError}</p>}
        </section>
    )
}
