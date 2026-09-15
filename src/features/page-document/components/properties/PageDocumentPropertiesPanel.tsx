// 本组件呈现“所有宽度”的有限调节控件；所有结构化修改均由内核适配层序列化和校验。

import {useMemo, useState} from 'react'
import {Button, Select} from 'flowcloudai-ui'
import type {LayerProjectionNode} from '../../domain/layerProjection.ts'
import type {
    InspectVisualComponent,
    VisualFontWeight,
    VisualPropertyChange,
    VisualPropertyEditValue,
    VisualPropertyGroup,
    VisualPropertyName,
    VisualPropertyState,
} from '../../application/visualPropertyEditing.ts'
import {
    createVisualPropertyEditRequest,
    inspectVisualProperties,
    VISUAL_FONT_WEIGHTS,
} from '../../application/visualPropertyEditing.ts'
import type {KernelDraftEditRequest} from '../../application/documentKernelDraftRuntime.ts'
import {inferOpaqueAdoptionKind} from '../../application/opaqueElementAdoption.ts'
import {BoxSpacingControls} from './BoxSpacingControls.tsx'
import {ColorPropertyControl} from './ColorPropertyControl.tsx'
import {NumericPropertyControl, type PropertyChangeOptions} from './NumericPropertyControl.tsx'
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
    onAdopt: (node: LayerProjectionNode) => Promise<string | null>
    visualError: string | null
}

const TABS: readonly {key: VisualPropertyGroup; label: string}[] = [
    {key: 'text', label: '文字'},
    {key: 'layout', label: '布局'},
    {key: 'appearance', label: '颜色与效果'},
]

export const PAGE_DOCUMENT_NODE_KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
    container: '容器',
    paragraph: '段落',
    heading: '标题',
    image: '图片',
    asset: '图片',
    gallery: '画廊',
    link: '链接',
    list: '列表',
    'list-item': '列表项',
    table: '表格',
    'table-cell': '表格单元格',
    quote: '引用',
    divider: '分隔线',
})

function fieldFor(fields: readonly VisualPropertyState[], property: VisualPropertyName): VisualPropertyState {
    const field = fields.find(item => item.property === property)
    if (!field) throw new TypeError(`属性面板缺少 ${property}。`)
    return field
}

function FontWeightControl({
    field,
    onChange,
}: {
    field: VisualPropertyState
    onChange: (value: VisualPropertyEditValue) => void
}) {
    const localOrEffective = field.localValue ?? field.value
    const supported = VISUAL_FONT_WEIGHTS.includes(localOrEffective as VisualFontWeight)
    return (
        <section className={`page-document-property${field.disabled ? ' is-disabled' : ''}`}>
            <div className="page-document-property__heading">
                <span>{field.label}</span>
                <span data-source-state={field.sourceState}>{field.statusText}</span>
            </div>
            {!supported && localOrEffective && (
                <p className="page-document-property__message">复杂源码值会原样保留，请在代码模式调整。</p>
            )}
            <Select
                aria-label="字重"
                disabled={field.disabled}
                value={supported ? localOrEffective : '400'}
                options={VISUAL_FONT_WEIGHTS.map(value => ({value, label: value}))}
                onValueChange={value => onChange({kind: 'font-weight', value: String(value) as VisualFontWeight})}
            />
            {field.localValue !== null && (
                <Button className="page-document-property__clear" size="sm" variant="ghost" disabled={field.disabled} onClick={() => onChange({kind: 'clear-override'})}>
                    清除本级设置
                </Button>
            )}
            {field.reason && <p className="page-document-property__message">{field.reason}</p>}
        </section>
    )
}

export function PageDocumentPropertiesPanel({
    node,
    entryStyleCss,
    inspectComponent,
    applyKernelEntry,
    onAdopt,
    visualError,
}: PageDocumentPropertiesPanelProps) {
    const [tab, setTab] = useState<VisualPropertyGroup>('text')
    const fields = useMemo(
        () => node ? inspectVisualProperties(node, inspectComponent, entryStyleCss) : [],
        [entryStyleCss, inspectComponent, node],
    )
    const adoptKind = node ? inferOpaqueAdoptionKind(node) : null
    const applyChanges = (
        changes: readonly VisualPropertyChange[],
        label: string,
        options: PropertyChangeOptions = {},
    ) => {
        if (!node) return
        const request = createVisualPropertyEditRequest(node.id, changes, options)
        void applyKernelEntry(request, label, options)
    }
    const applyOne = (
        field: VisualPropertyState,
        value: VisualPropertyEditValue,
        options?: PropertyChangeOptions,
    ) => applyChanges([{property: field.property, value}], `调整${field.label}`, options)

    return (
        <section className="page-document-properties-panel">
            <header>
                <strong>属性 · {node ? (PAGE_DOCUMENT_NODE_KIND_LABELS[node.kind] ?? node.kind) : '未选择'}</strong>
                <span>修改范围 · 所有宽度</span>
            </header>
            {node?.managed && (
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
            )}
            {!node ? (
                <p className="page-document-properties-panel__empty">在画布或图层中选择一个元素</p>
            ) : !node.managed ? (
                <div className="page-document-properties-panel__adoption">
                    <strong>该元素尚未纳入可视编辑</strong>
                    <p>{adoptKind ? '纳入只会增加组件身份，不会改写元素内部内容。' : '无法从当前元素安全推断可视组件类型，请在代码模式处理。'}</p>
                    {adoptKind && (
                        <Button type="button" size="sm" onClick={() => void onAdopt(node)}>
                            转为{PAGE_DOCUMENT_NODE_KIND_LABELS[adoptKind] ?? adoptKind}
                        </Button>
                    )}
                </div>
            ) : (
                <div className="page-document-properties-panel__fields">
                    {tab === 'text' && (
                        <>
                            <NumericPropertyControl field={fieldFor(fields, 'font-size')} onChange={(value, options) => applyOne(fieldFor(fields, 'font-size'), value, options)}/>
                            <FontWeightControl field={fieldFor(fields, 'font-weight')} onChange={value => applyOne(fieldFor(fields, 'font-weight'), value)}/>
                            <NumericPropertyControl field={fieldFor(fields, 'line-height')} onChange={(value, options) => applyOne(fieldFor(fields, 'line-height'), value, options)}/>
                        </>
                    )}
                    {tab === 'layout' && (
                        <>
                            <BoxSpacingControls label="外距" fields={fields} onChange={applyChanges}/>
                            <BoxSpacingControls label="内距" fields={fields} onChange={applyChanges}/>
                            <NumericPropertyControl field={fieldFor(fields, 'gap')} onChange={(value, options) => applyOne(fieldFor(fields, 'gap'), value, options)}/>
                        </>
                    )}
                    {tab === 'appearance' && (
                        <>
                            <ColorPropertyControl field={fieldFor(fields, 'color')} onChange={(value, options) => applyOne(fieldFor(fields, 'color'), value, options)}/>
                            <ColorPropertyControl field={fieldFor(fields, 'background-color')} onChange={(value, options) => applyOne(fieldFor(fields, 'background-color'), value, options)}/>
                        </>
                    )}
                </div>
            )}
            {visualError && <p className="page-document-properties-panel__error" role="alert">{visualError}</p>}
        </section>
    )
}
