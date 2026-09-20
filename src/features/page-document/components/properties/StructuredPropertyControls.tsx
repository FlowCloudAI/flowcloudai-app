// 本组件呈现有限关键字、受管背景与结构化阴影；不把任意 CSS 文本交给属性内核。

import {Button, Select} from 'flowcloudai-ui'
import {useEffect, useState, type ReactNode} from 'react'
import type {PageDocumentAsset} from '../../../../api/pageDocument.ts'
import {pageDocumentAssetDisplayName, pageDocumentAssetSummary} from '../assets/assetPresentation.ts'
import {
    visualKeywordOptions,
    type VisualNumericPropertyValue,
    type VisualPropertyEditValue,
    type VisualPropertyState,
    type VisualShadowLayer,
} from '../../application/visualPropertyEditing.ts'
import type {PropertyChangeOptions} from './NumericPropertyControl.tsx'
import {NumericPropertyControl} from './NumericPropertyControl.tsx'
import {numericPropertyDefinition, readNumericPropertyEditorValue} from './numericPropertyModel.ts'
import {ColorPropertyControl} from './ColorPropertyControl.tsx'
import {
    BACKGROUND_GRADIENT_ANGLES,
    BACKGROUND_GRADIENT_END_STOPS,
    BACKGROUND_GRADIENT_STOPS,
    parseControlledBackgroundGradient,
    serializeControlledBackgroundGradient,
    type ControlledBackgroundGradient,
} from './backgroundPropertyModel.ts'

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
        {field.sourceState === 'mixed' && (
            <p className="page-document-property__message">多种值会原样保留，选择新值后才会统一。</p>
        )}
        {children}
        {field.localValue !== null && <Button
            aria-label="清除"
            className="page-document-property__clear"
            size="sm"
            variant="ghost"
            disabled={field.disabled}
            title={field.clearTitle}
            onClick={() => void onChange({kind: 'clear-override'}, {immediate: true})}
        >清除</Button>}
        {field.reason && <p className="page-document-property__message">{field.reason}</p>}
    </section>
}

export function KeywordPropertyControl({field, onChange}: {field: VisualPropertyState; onChange: ChangeProperty}) {
    const values = visualKeywordOptions(field.property)
    const raw = (field.localValue ?? field.value).trim()
    const known = field.sourceState !== 'mixed' && values.includes(raw)
    return <PropertyShell field={field} onChange={onChange}>
        {!known && raw && <p className="page-document-property__message">自定义源码值“{raw}”会原样保留，选择后才由控件接管。</p>}
        <Select
            aria-label={field.label}
            disabled={field.disabled}
            value={known ? raw : 'custom'}
            options={[
                ...(!known ? [{value: 'custom', label: field.sourceState === 'mixed' ? '多种值' : raw ? '自定义源码' : '默认'}] : []),
                ...values.map(value => ({value, label: value})),
            ]}
            onValueChange={value => {
                if (value === 'custom') return
                void onChange({kind: 'keyword', value: String(value)}, {immediate: true})
            }}
        />
        {field.sourceState === 'other-viewport' && field.localValue === null && known && <Button
            size="sm"
            variant="outline"
            disabled={field.disabled}
            onClick={() => void onChange({kind: 'keyword', value: raw}, {immediate: true})}
        >在本档覆盖</Button>}
    </PropertyShell>
}

export function DimensionPropertyControl({field, onChange}: {field: VisualPropertyState; onChange: ChangeProperty}) {
    return <div className="page-document-property-composite">
        <KeywordPropertyControl field={field} onChange={onChange}/>
        <NumericPropertyControl compact field={field} onChange={onChange}/>
    </div>
}

const WIDTH_PRESETS = [25, 50, 75, 100].map(value => ({
    label: `${value}%`,
    value,
    unit: '%' as const,
}))

/** 宽度只呈现“自动 / 设置宽度”两种作者模式；复杂源码在作者主动接管前逐字保留。 */
export function WidthPropertyControl({field, onChange}: {field: VisualPropertyState; onChange: ChangeProperty}) {
    if (field.property !== 'width') throw new TypeError('宽度控件只能编辑 width。')
    const definition = numericPropertyDefinition('width')
    if (!definition) throw new TypeError('宽度缺少数值控件定义。')
    const raw = (field.localValue ?? field.value).trim()
    const parsed = readNumericPropertyEditorValue(raw, definition)
    const mode = field.sourceState === 'mixed'
        ? 'custom'
        : raw === 'auto'
          ? 'auto'
          : parsed.kind === 'numeric'
            ? 'numeric'
            : 'custom'
    const chooseNumeric = () => void onChange(
        {kind: 'numeric', value: 100, unit: '%', numberText: '100'},
        {immediate: true},
    )
    return <PropertyShell field={field} onChange={onChange}>
        <div className="page-document-property__modes" role="group" aria-label="宽度模式">
            <Button
                aria-pressed={mode === 'auto'}
                disabled={field.disabled}
                size="sm"
                variant={mode === 'auto' ? 'primary' : 'outline'}
                onClick={() => void onChange({kind: 'keyword', value: 'auto'}, {immediate: true})}
            >自动</Button>
            <Button
                aria-pressed={mode === 'numeric'}
                disabled={field.disabled}
                size="sm"
                variant={mode === 'numeric' ? 'primary' : 'outline'}
                onClick={chooseNumeric}
            >设置宽度</Button>
        </div>
        {mode === 'custom' && raw && <div className="page-document-property__custom" role="status">
            <strong>{field.sourceState === 'mixed' ? '当前范围包含多种宽度' : '复杂宽度源码'}</strong>
            {field.sourceState !== 'mixed' && <code>{raw}</code>}
            <span>当前源码会原样保留；选择模式后才由控件接管。</span>
        </div>}
        {mode === 'numeric' && <NumericPropertyControl
            compact
            embedded
            field={field}
            presets={WIDTH_PRESETS}
            onChange={onChange}
        />}
        {mode === 'auto' && field.sourceState === 'other-viewport' && field.localValue === null && <Button
            size="sm"
            variant="outline"
            disabled={field.disabled}
            onClick={() => void onChange({kind: 'keyword', value: 'auto'}, {immediate: true})}
        >在本档覆盖</Button>}
    </PropertyShell>
}

type BackgroundMode = 'solid' | 'gradient' | 'image'

const DEFAULT_GRADIENT: ControlledBackgroundGradient = {
    angle: 135,
    start: 'var(--fc-entry-accent)',
    end: 'transparent',
}

export function BackgroundPropertyControl({
    assets,
    colorField,
    imageField,
    onColorChange,
    onImageChange,
}: {
    assets: readonly PageDocumentAsset[]
    colorField: VisualPropertyState
    imageField: VisualPropertyState
    onColorChange: ChangeProperty
    onImageChange: ChangeProperty
}) {
    const rawImage = (imageField.localValue ?? imageField.value).trim()
    const controlledGradient = parseControlledBackgroundGradient(rawImage)
    const assetOptions = assets.map((asset, index) => ({
        value: `url("fcasset://${asset.id}")`,
        label: `${pageDocumentAssetDisplayName(index)} · ${pageDocumentAssetSummary(asset)}`,
    }))
    const selectedAsset = assetOptions.find(option => option.value === rawImage)
    const inferredMode: BackgroundMode = controlledGradient ? 'gradient' : selectedAsset ? 'image' : 'solid'
    const [mode, setMode] = useState<BackgroundMode>(inferredMode)
    const [gradient, setGradient] = useState<ControlledBackgroundGradient>(controlledGradient ?? DEFAULT_GRADIENT)
    useEffect(() => {
        setMode(inferredMode)
        const nextGradient = parseControlledBackgroundGradient(rawImage)
        if (nextGradient) setGradient(nextGradient)
    }, [inferredMode, rawImage])

    const changeGradient = (next: ControlledBackgroundGradient) => {
        setGradient(next)
        void onImageChange({kind: 'background-image', value: serializeControlledBackgroundGradient(next)}, {immediate: true})
    }
    const chooseMode = (next: BackgroundMode) => {
        setMode(next)
        if (next === 'solid' && imageField.localValue !== null) {
            void onImageChange({kind: 'clear-override'}, {immediate: true})
        } else if (next === 'gradient' && !controlledGradient) {
            changeGradient(gradient)
        }
    }
    const customImage = rawImage && rawImage !== 'none' && !controlledGradient && !selectedAsset

    return <section className={`page-document-property page-document-background-property${colorField.disabled && imageField.disabled ? ' is-disabled' : ''}`}>
        <div className="page-document-property__heading">
            <span>背景</span>
            <span data-source-state={mode === 'solid' ? colorField.sourceState : imageField.sourceState}>
                {mode === 'solid' ? colorField.statusText : imageField.statusText}
            </span>
        </div>
        <div className="page-document-background-property__modes" role="group" aria-label="背景类型">
            {([
                ['solid', '纯色'],
                ['gradient', '渐变'],
                ['image', '图片'],
            ] as const).map(([value, label]) => <Button
                aria-pressed={mode === value}
                disabled={value === 'solid' ? colorField.disabled : imageField.disabled}
                key={value}
                size="sm"
                variant={mode === value ? 'primary' : 'outline'}
                onClick={() => chooseMode(value)}
            >{label}</Button>)}
        </div>
        {mode === 'solid' && <ColorPropertyControl embedded field={colorField} onChange={onColorChange}/>}
        {mode === 'gradient' && <div className="page-document-background-property__gradient">
            <label>
                <span>角度</span>
                <Select
                    aria-label="渐变角度"
                    disabled={imageField.disabled}
                    value={String(gradient.angle)}
                    options={BACKGROUND_GRADIENT_ANGLES.map(value => ({value: String(value), label: `${value}°`}))}
                    onValueChange={value => changeGradient({...gradient, angle: Number(value) as ControlledBackgroundGradient['angle']})}
                />
            </label>
            <label>
                <span>起始颜色</span>
                <Select
                    aria-label="渐变起始颜色"
                    disabled={imageField.disabled}
                    value={gradient.start}
                    options={[...BACKGROUND_GRADIENT_STOPS]}
                    onValueChange={value => changeGradient({...gradient, start: String(value) as ControlledBackgroundGradient['start']})}
                />
            </label>
            <label>
                <span>结束颜色</span>
                <Select
                    aria-label="渐变结束颜色"
                    disabled={imageField.disabled}
                    value={gradient.end}
                    options={[...BACKGROUND_GRADIENT_END_STOPS]}
                    onValueChange={value => changeGradient({...gradient, end: String(value) as ControlledBackgroundGradient['end']})}
                />
            </label>
        </div>}
        {mode === 'image' && <Select
            aria-label="项目背景图片"
            disabled={imageField.disabled}
            value={selectedAsset?.value ?? 'unselected'}
            options={[
                {value: 'unselected', label: assets.length === 0 ? '项目内没有图片' : '选择项目图片'},
                ...assetOptions,
            ]}
            onValueChange={value => {
                if (value === 'unselected') return
                void onImageChange({kind: 'background-image', value: String(value)}, {immediate: true})
            }}
        />}
        {customImage && <p className="page-document-property__message">
            自定义背景源码会原样保留；选择纯色、渐变或项目图片后才由控件接管。
        </p>}
        {mode !== 'solid' && imageField.localValue !== null && <Button
            aria-label="清除"
            className="page-document-property__clear"
            disabled={imageField.disabled}
            size="sm"
            title={imageField.clearTitle}
            variant="ghost"
            onClick={() => void onImageChange({kind: 'clear-override'}, {immediate: true})}
        >清除</Button>}
        {(mode === 'solid' ? colorField.reason : imageField.reason) && <p className="page-document-property__message">
            {mode === 'solid' ? colorField.reason : imageField.reason}
        </p>}
    </section>
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
