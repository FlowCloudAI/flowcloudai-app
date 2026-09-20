// 本组件提供主题色、标准色、最近颜色和受限的更多颜色入口；颜色只以结构化值交给适配层。

import {useEffect, useRef, useState, type CSSProperties} from 'react'
import {Button, Input, Slider} from 'flowcloudai-ui'
import type {
    VisualColorPropertyValue,
    VisualPropertyEditValue,
    VisualPropertyState,
} from '../../application/visualPropertyEditing.ts'
import {parseSerializedVisualColor} from '../../application/visualPropertyEditing.ts'
import {PageDocumentColorIcon} from '../icons/PageDocumentPropertyIcons.tsx'
import type {PropertyChangeOptions} from './NumericPropertyControl.tsx'

interface ColorOption {
    readonly label: string
    readonly value: string
    readonly preview: string
}

const THEME_COLORS: readonly ColorOption[] = [
    {label: '词条底色', value: 'var(--fc-entry-surface)', preview: 'var(--fc-color-bg)'},
    {label: '词条文字', value: 'var(--fc-entry-text)', preview: 'var(--fc-color-text)'},
    {label: '词条强调', value: 'var(--fc-entry-accent)', preview: 'var(--fc-color-primary)'},
    {label: '词条弱化', value: 'var(--fc-entry-muted)', preview: 'var(--fc-color-text-secondary)'},
]

const STANDARD_COLORS: readonly ColorOption[] = [
    {label: '黑色', value: '#000000', preview: '#000000'},
    {label: '白色', value: '#ffffff', preview: '#ffffff'},
    {label: '红色', value: '#c43c35', preview: '#c43c35'},
    {label: '蓝色', value: '#3569c4', preview: '#3569c4'},
    {label: '绿色', value: '#358257', preview: '#358257'},
]

const MAXIMUM_RECENT_COLORS = 8
let recentColors: string[] = []

function rememberColor(value: string): void {
    recentColors = [value, ...recentColors.filter(item => item !== value)].slice(0, MAXIMUM_RECENT_COLORS)
}

export function ColorPropertyControl({
    field,
    onChange,
}: {
    field: VisualPropertyState
    onChange: (value: VisualPropertyEditValue, options?: PropertyChangeOptions) => Promise<boolean>
}) {
    const sourceColor = parseSerializedVisualColor(field.localValue ?? field.value)
    const [open, setOpen] = useState(false)
    const [moreOpen, setMoreOpen] = useState(false)
    const [color, setColor] = useState<VisualColorPropertyValue>(sourceColor ?? {kind: 'color', value: '#000000', opacity: 100})
    const [hexDraft, setHexDraft] = useState(color.value.startsWith('#') ? color.value : '#000000')
    const [error, setError] = useState<string | null>(null)
    const interactionRef = useRef<string | null>(null)
    const colorRef = useRef(color)
    const pendingFlushRef = useRef(false)
    const attemptRef = useRef(0)
    useEffect(() => {
        const next = parseSerializedVisualColor(field.localValue ?? field.value)
        if (next) {
            setColor(next)
            colorRef.current = next
            if (next.value.startsWith('#')) setHexDraft(next.value)
        }
        setError(null)
    }, [field.localValue, field.value])

    const options = (immediate = false): PropertyChangeOptions => ({
        historyGroupId: interactionRef.current ??= `page-color-${crypto.randomUUID()}`,
        immediate,
    })
    const requestChange = (next: VisualColorPropertyValue, changeOptions: PropertyChangeOptions) => {
        const attempt = ++attemptRef.current
        void onChange(next, changeOptions).then(applied => {
            if (applied || attempt !== attemptRef.current) return
            const persisted = parseSerializedVisualColor(field.localValue ?? field.value)
            if (!persisted) return
            setColor(persisted)
            colorRef.current = persisted
            setHexDraft(persisted.value.startsWith('#') ? persisted.value : '#000000')
        })
    }
    const publish = (next: VisualColorPropertyValue, immediate = false) => {
        setColor(next)
        colorRef.current = next
        if (next.value.startsWith('#')) setHexDraft(next.value)
        setError(null)
        rememberColor(next.value)
        pendingFlushRef.current = !immediate
        requestChange(next, options(immediate))
    }
    const flush = () => {
        if (!interactionRef.current || !pendingFlushRef.current) return
        pendingFlushRef.current = false
        requestChange(colorRef.current, {
            historyGroupId: interactionRef.current,
            immediate: true,
        })
    }
    const finish = () => {
        flush()
        interactionRef.current = null
    }
    const cell = (option: ColorOption) => (
        <Button
            aria-label={option.label}
            aria-pressed={color.value === option.value}
            className="page-document-color-cell"
            key={option.value}
            size="sm"
            variant="outline"
            disabled={field.disabled}
            style={{'--page-document-color-preview': option.preview} as CSSProperties}
            onClick={() => {
                publish({...colorRef.current, value: option.value}, true)
                finish()
            }}
        ><span/></Button>
    )

    return (
        <section className={`page-document-property page-document-color-property${field.disabled ? ' is-disabled' : ''}`}>
            <div className="page-document-property__heading">
                <span>{field.label}</span>
                <span data-source-state={field.sourceState}>{field.statusText}</span>
            </div>
            {!sourceColor && (field.localValue ?? field.value) && (
                <p className="page-document-property__message">复杂源码值会原样保留，请在代码模式调整。</p>
            )}
            <Button
                className="page-document-color-trigger"
                size="sm"
                variant="outline"
                iconLeft={<PageDocumentColorIcon/>}
                disabled={field.disabled}
                aria-expanded={open}
                onClick={() => {
                    if (open) finish()
                    else interactionRef.current = `page-color-${crypto.randomUUID()}`
                    setOpen(current => !current)
                }}
            >选择颜色</Button>
            {open && (
                <div className="page-document-color-popover">
                    <strong>主题色</strong>
                    <div className="page-document-color-grid">{THEME_COLORS.map(cell)}</div>
                    <strong>标准色</strong>
                    <div className="page-document-color-grid">{STANDARD_COLORS.map(cell)}</div>
                    {recentColors.length > 0 && (
                        <>
                            <strong>最近使用</strong>
                            <div className="page-document-color-grid">
                                {recentColors.map(value => cell({label: value, value, preview: value}))}
                            </div>
                        </>
                    )}
                    <Button size="sm" variant="ghost" aria-expanded={moreOpen} onClick={() => setMoreOpen(current => !current)}>
                        更多颜色
                    </Button>
                    {moreOpen && (
                        <div className="page-document-color-more">
                            <label>
                                <span>色板</span>
                                <input
                                    aria-label={`${field.label}色板`}
                                    type="color"
                                    value={hexDraft}
                                    onChange={event => publish({...colorRef.current, value: event.currentTarget.value}, true)}
                                />
                            </label>
                            <label>
                                <span>十六进制</span>
                                <Input
                                    aria-label={`${field.label}十六进制`}
                                    size="sm"
                                    value={hexDraft}
                                    status={error ? 'error' : 'default'}
                                    onValueChange={value => {
                                        setHexDraft(value)
                                        if (!/^#[\da-f]{6}$/iu.test(value)) {
                                            setError('请输入六位十六进制颜色。')
                                            return
                                        }
                                        publish({...colorRef.current, value: value.toLowerCase()})
                                    }}
                                    onBlur={finish}
                                />
                            </label>
                            <label>
                                <span>透明度 · {color.opacity}%</span>
                                <Slider
                                    aria-label={`${field.label}透明度`}
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={color.opacity}
                                    onPointerDown={() => {
                                        interactionRef.current ??= `page-color-${crypto.randomUUID()}`
                                    }}
                                    onPointerUp={finish}
                                    onPointerCancel={finish}
                                    onBlur={finish}
                                    onKeyUp={event => {
                                        if (event.key.startsWith('Arrow')) finish()
                                    }}
                                    onValueChange={value => publish({...colorRef.current, opacity: Array.isArray(value) ? value[1] : value})}
                                />
                            </label>
                        </div>
                    )}
                </div>
            )}
            {field.sourceState === 'other-viewport' && field.localValue === null && sourceColor && (
                <Button size="sm" variant="outline" disabled={field.disabled} onClick={() => {
                    publish(sourceColor, true)
                    finish()
                }}>在本档覆盖</Button>
            )}
            {field.localValue !== null && (
                <Button className="page-document-property__clear" size="sm" variant="ghost" disabled={field.disabled} onClick={() => void onChange({kind: 'clear-override'}, {immediate: true})}>
                    清除本级设置
                </Button>
            )}
            {(error || field.reason) && <p className="page-document-property__message" role={error ? 'alert' : undefined}>{error ?? field.reason}</p>}
        </section>
    )
}
