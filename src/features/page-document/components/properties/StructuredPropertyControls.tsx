// 本组件呈现有限关键字、受管背景与结构化阴影；不把任意 CSS 文本交给属性内核。

import {Button, Select} from 'flowcloudai-ui'
import type {ReactNode} from 'react'
import type {PageDocumentAsset} from '../../../../api/pageDocument.ts'
import {
    visualKeywordOptions,
    type VisualNumericPropertyValue,
    type VisualPropertyEditValue,
    type VisualPropertyState,
    type VisualShadowLayer,
} from '../../application/visualPropertyEditing.ts'
import type {PropertyChangeOptions} from './NumericPropertyControl.tsx'
import {NumericPropertyControl} from './NumericPropertyControl.tsx'

type ChangeProperty = (
    value: VisualPropertyEditValue,
    options?: PropertyChangeOptions,
) => Promise<boolean>

const SHADOW_LENGTH = (value: number): VisualNumericPropertyValue => ({
    kind: 'numeric', value, unit: 'px', numberText: String(value),
})

const SHADOW_PRESETS: readonly {label: string; layers: readonly VisualShadowLayer[]}[] = [
    {
        label: '柔和',
        layers: [{offsetX: SHADOW_LENGTH(0), offsetY: SHADOW_LENGTH(4), blur: SHADOW_LENGTH(16), spread: SHADOW_LENGTH(0), color: '#000000', inset: false}],
    },
    {
        label: '多层',
        layers: [
            {offsetX: SHADOW_LENGTH(0), offsetY: SHADOW_LENGTH(2), blur: SHADOW_LENGTH(6), spread: SHADOW_LENGTH(0), color: '#000000', inset: false},
            {offsetX: SHADOW_LENGTH(0), offsetY: SHADOW_LENGTH(12), blur: SHADOW_LENGTH(32), spread: SHADOW_LENGTH(-4), color: '#000000', inset: false},
        ],
    },
    {
        label: '内阴影',
        layers: [{offsetX: SHADOW_LENGTH(0), offsetY: SHADOW_LENGTH(2), blur: SHADOW_LENGTH(8), spread: SHADOW_LENGTH(0), color: '#000000', inset: true}],
    },
]

function PropertyShell({
    children,
    field,
    onChange,
}: {
    readonly children: ReactNode
    readonly field: VisualPropertyState
    readonly onChange: ChangeProperty
}) {
    return <section className={`page-document-property${field.disabled ? ' is-disabled' : ''}`}>
        <div className="page-document-property__heading">
            <span>{field.label}</span>
            <span data-source-state={field.sourceState}>{field.statusText}</span>
        </div>
        {children}
        {field.localValue !== null && <Button
            className="page-document-property__clear"
            size="sm"
            variant="ghost"
            disabled={field.disabled}
            onClick={() => void onChange({kind: 'clear-override'}, {immediate: true})}
        >清除本级设置</Button>}
        {field.reason && <p className="page-document-property__message">{field.reason}</p>}
    </section>
}

export function KeywordPropertyControl({field, onChange}: {field: VisualPropertyState; onChange: ChangeProperty}) {
    const values = visualKeywordOptions(field.property)
    const raw = (field.localValue ?? field.value).trim()
    const known = values.includes(raw)
    return <PropertyShell field={field} onChange={onChange}>
        {!known && raw && <p className="page-document-property__message">自定义源码值“{raw}”会原样保留，选择后才由控件接管。</p>}
        <Select
            aria-label={field.label}
            disabled={field.disabled}
            value={known ? raw : 'custom'}
            options={[
                ...(!known ? [{value: 'custom', label: raw ? '自定义源码' : '未设置'}] : []),
                ...values.map(value => ({value, label: value})),
            ]}
            onValueChange={value => {
                if (value === 'custom') return
                void onChange({kind: 'keyword', value: String(value)}, {immediate: true})
            }}
        />
    </PropertyShell>
}

export function DimensionPropertyControl({field, onChange}: {field: VisualPropertyState; onChange: ChangeProperty}) {
    return <div className="page-document-property-composite">
        <KeywordPropertyControl field={field} onChange={onChange}/>
        <NumericPropertyControl compact field={field} onChange={onChange}/>
    </div>
}

export function BackgroundImagePropertyControl({
    assets,
    field,
    onChange,
}: {
    assets: readonly PageDocumentAsset[]
    field: VisualPropertyState
    onChange: ChangeProperty
}) {
    const raw = (field.localValue ?? field.value).trim()
    const options = [
        {value: 'linear-gradient(135deg, var(--fc-entry-accent), transparent)', label: '强调色渐隐'},
        {value: 'linear-gradient(90deg, var(--fc-entry-surface), var(--fc-entry-muted))', label: '页面底色渐变'},
        ...assets.map(asset => ({value: `url("fcasset://${asset.id}")`, label: `项目图片 · ${asset.id.slice(0, 8)}`})),
    ]
    const known = options.some(option => option.value === raw)
    return <PropertyShell field={field} onChange={onChange}>
        {!known && raw && raw !== 'none' && <p className="page-document-property__message">自定义背景源码会原样保留。</p>}
        <Select
            aria-label="背景图与渐变"
            disabled={field.disabled}
            value={known ? raw : 'custom'}
            options={[
                {value: 'custom', label: raw ? '自定义源码 / 未接管' : '未设置'},
                ...options,
            ]}
            onValueChange={value => {
                if (value === 'custom') return
                void onChange({kind: 'background-image', value: String(value)}, {immediate: true})
            }}
        />
    </PropertyShell>
}

export function BoxShadowPropertyControl({field, onChange}: {field: VisualPropertyState; onChange: ChangeProperty}) {
    const raw = (field.localValue ?? field.value).trim()
    return <PropertyShell field={field} onChange={onChange}>
        {raw && raw !== 'none' && <p className="page-document-property__message">当前阴影源码会保留到你选择新预设为止。</p>}
        <div className="page-document-property__presets" role="group" aria-label="阴影快捷值">
            {SHADOW_PRESETS.map(preset => <Button
                key={preset.label}
                size="sm"
                variant="outline"
                disabled={field.disabled}
                onClick={() => void onChange({kind: 'box-shadow', layers: preset.layers}, {immediate: true})}
            >{preset.label}</Button>)}
        </div>
    </PropertyShell>
}
