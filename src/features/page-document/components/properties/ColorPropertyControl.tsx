// 本组件提供受控颜色入口；色板经 portal 浮于任务窗格之上，不调用平台取色器。

import {useEffect, useRef, useState, type CSSProperties} from 'react'
import {Button, Input, Slider} from 'flowcloudai-ui'
import {FloatingPanel} from '../../../../shared/ui/overlay'
import type {
    VisualColorPropertyValue,
    VisualPropertyEditValue,
    VisualPropertyState,
} from '../../application/visualPropertyEditing.ts'
import {parseSerializedVisualColor} from '../../application/visualPropertyEditing.ts'
import type {PropertyChangeOptions} from './NumericPropertyControl.tsx'

interface ColorOption {
    readonly label: string
    readonly value: string
    readonly preview: string
    readonly pickerHex: string
}

const THEME_COLORS: readonly ColorOption[] = [
    {label: '词条底色', value: 'var(--fc-entry-surface)', preview: 'var(--fc-color-bg)', pickerHex: '#ffffff'},
    {label: '词条文字', value: 'var(--fc-entry-text)', preview: 'var(--fc-color-text)', pickerHex: '#28241f'},
    {label: '词条强调', value: 'var(--fc-entry-accent)', preview: 'var(--fc-color-primary)', pickerHex: '#3569c4'},
    {label: '词条弱化', value: 'var(--fc-entry-muted)', preview: 'var(--fc-color-text-secondary)', pickerHex: '#777777'},
]

const STANDARD_COLORS: readonly ColorOption[] = [
    {label: '黑色', value: '#000000', preview: '#000000', pickerHex: '#000000'},
    {label: '白色', value: '#ffffff', preview: '#ffffff', pickerHex: '#ffffff'},
    {label: '红色', value: '#c43c35', preview: '#c43c35', pickerHex: '#c43c35'},
    {label: '蓝色', value: '#3569c4', preview: '#3569c4', pickerHex: '#3569c4'},
    {label: '绿色', value: '#358257', preview: '#358257', pickerHex: '#358257'},
]

const MAXIMUM_RECENT_COLORS = 8
let recentColors: string[] = []

function rememberColor(value: string): void {
    recentColors = [value, ...recentColors.filter(item => item !== value)].slice(0, MAXIMUM_RECENT_COLORS)
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value))
}

function pickerHex(value: string): string {
    if (/^#[\da-f]{6}$/iu.test(value)) return value.toLowerCase()
    return THEME_COLORS.find(item => item.value === value)?.pickerHex ?? '#000000'
}

function previewColor(value: string): string {
    return THEME_COLORS.find(item => item.value === value)?.preview ?? value
}

function hexToHsv(hex: string): {hue: number; saturation: number; value: number} {
    const red = Number.parseInt(hex.slice(1, 3), 16) / 255
    const green = Number.parseInt(hex.slice(3, 5), 16) / 255
    const blue = Number.parseInt(hex.slice(5, 7), 16) / 255
    const maximum = Math.max(red, green, blue)
    const minimum = Math.min(red, green, blue)
    const delta = maximum - minimum
    let hue = 0
    if (delta > 0) {
        if (maximum === red) hue = 60 * (((green - blue) / delta) % 6)
        else if (maximum === green) hue = 60 * ((blue - red) / delta + 2)
        else hue = 60 * ((red - green) / delta + 4)
    }
    return {
        hue: Math.round(hue < 0 ? hue + 360 : hue),
        saturation: maximum === 0 ? 0 : Math.round((delta / maximum) * 100),
        value: Math.round(maximum * 100),
    }
}

function hsvToHex(hue: number, saturation: number, value: number): string {
    const chroma = (value / 100) * (saturation / 100)
    const sector = hue / 60
    const intermediate = chroma * (1 - Math.abs((sector % 2) - 1))
    const minimum = value / 100 - chroma
    let red = 0
    let green = 0
    let blue = 0
    if (sector < 1) [red, green] = [chroma, intermediate]
    else if (sector < 2) [red, green] = [intermediate, chroma]
    else if (sector < 3) [green, blue] = [chroma, intermediate]
    else if (sector < 4) [green, blue] = [intermediate, chroma]
    else if (sector < 5) [red, blue] = [intermediate, chroma]
    else [red, blue] = [chroma, intermediate]
    return `#${[red, green, blue]
        .map(channel => Math.round((channel + minimum) * 255).toString(16).padStart(2, '0'))
        .join('')}`
}

export function ColorPropertyControl({
    embedded = false,
    field,
    onChange,
}: {
    embedded?: boolean
    field: VisualPropertyState
    onChange: (value: VisualPropertyEditValue, options?: PropertyChangeOptions) => Promise<boolean>
}) {
    const sourceColor = parseSerializedVisualColor(field.localValue ?? field.value)
    const initialColor = sourceColor ?? {kind: 'color' as const, value: '#000000', opacity: 100}
    const initialHsv = hexToHsv(pickerHex(initialColor.value))
    const [open, setOpen] = useState(false)
    const [moreOpen, setMoreOpen] = useState(false)
    const [color, setColor] = useState<VisualColorPropertyValue>(initialColor)
    const [hue, setHue] = useState(initialHsv.hue)
    const [saturation, setSaturation] = useState(initialHsv.saturation)
    const [brightness, setBrightness] = useState(initialHsv.value)
    const [hexDraft, setHexDraft] = useState(pickerHex(initialColor.value))
    const [error, setError] = useState<string | null>(null)
    const triggerAnchorRef = useRef<HTMLSpanElement>(null)
    const interactionRef = useRef<string | null>(null)
    const colorRef = useRef(color)
    const pendingFlushRef = useRef(false)
    const attemptRef = useRef(0)
    useEffect(() => {
        const next = parseSerializedVisualColor(field.localValue ?? field.value)
        if (next) {
            const nextHex = pickerHex(next.value)
            const nextHsv = hexToHsv(nextHex)
            setColor(next)
            colorRef.current = next
            setHexDraft(nextHex)
            setHue(nextHsv.hue)
            setSaturation(nextHsv.saturation)
            setBrightness(nextHsv.value)
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
            const persistedHex = pickerHex(persisted.value)
            const persistedHsv = hexToHsv(persistedHex)
            setColor(persisted)
            colorRef.current = persisted
            setHexDraft(persistedHex)
            setHue(persistedHsv.hue)
            setSaturation(persistedHsv.saturation)
            setBrightness(persistedHsv.value)
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
    const publishHsv = (nextHue: number, nextSaturation: number, nextBrightness: number) => {
        const nextHex = hsvToHex(nextHue, nextSaturation, nextBrightness)
        setHue(nextHue)
        setSaturation(nextSaturation)
        setBrightness(nextBrightness)
        setHexDraft(nextHex)
        publish({...colorRef.current, value: nextHex})
    }
    const flush = () => {
        if (!interactionRef.current || !pendingFlushRef.current) return
        pendingFlushRef.current = false
        requestChange(colorRef.current, {historyGroupId: interactionRef.current, immediate: true})
    }
    const finish = () => {
        flush()
        interactionRef.current = null
    }
    const close = () => {
        finish()
        setOpen(false)
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
                const nextHsv = hexToHsv(option.pickerHex)
                setHue(nextHsv.hue)
                setSaturation(nextHsv.saturation)
                setBrightness(nextHsv.value)
                publish({...colorRef.current, value: option.value}, true)
                finish()
            }}
        ><span/></Button>
    )
    const fallbackLabel = field.clearTitle.includes('继承') ? '继承' : '默认'

    return (
        <section className={`page-document-property page-document-color-property${embedded ? ' is-embedded' : ''}${field.disabled ? ' is-disabled' : ''}`}>
            {!embedded && <div className="page-document-property__heading">
                <span>{field.label}</span>
                <span data-source-state={field.sourceState}>{field.statusText}</span>
            </div>}
            {!sourceColor && (field.localValue ?? field.value) && (
                <p className="page-document-property__message">复杂源码值会原样保留，请在代码模式调整。</p>
            )}
            <span className="page-document-color-trigger-anchor" ref={triggerAnchorRef}>
                <Button
                    aria-label={`设置${field.label}`}
                    aria-expanded={open}
                    className="page-document-color-trigger"
                    disabled={field.disabled}
                    iconOnly
                    size="sm"
                    title={`设置${field.label}`}
                    variant="outline"
                    onClick={() => {
                        if (open) close()
                        else {
                            interactionRef.current = `page-color-${crypto.randomUUID()}`
                            setOpen(true)
                        }
                    }}
                >
                    <span
                        aria-hidden="true"
                        style={{
                            '--page-document-color-preview': previewColor(sourceColor?.value ?? 'transparent'),
                            '--page-document-color-opacity': (sourceColor?.opacity ?? 100) / 100,
                        } as CSSProperties}
                    />
                </Button>
            </span>
            <FloatingPanel
                anchorRef={triggerAnchorRef}
                ariaLabel={`${field.label}色板`}
                className="page-document-color-floating-panel"
                open={open}
                passive
                showCloseButton={false}
                onClose={close}
            >
                <div className="page-document-color-popover">
                    <Button
                        className="page-document-color-clear"
                        disabled={field.disabled || field.localValue === null}
                        size="sm"
                        title={field.clearTitle}
                        variant="ghost"
                        onClick={() => {
                            void onChange({kind: 'clear-override'}, {immediate: true})
                            close()
                        }}
                    >{fallbackLabel}</Button>
                    <strong>主题色</strong>
                    <div className="page-document-color-grid">{THEME_COLORS.map(cell)}</div>
                    <strong>标准色</strong>
                    <div className="page-document-color-grid">{STANDARD_COLORS.map(cell)}</div>
                    {recentColors.length > 0 && <>
                        <strong>最近使用</strong>
                        <div className="page-document-color-grid">
                            {recentColors.map(value => cell({label: value, value, preview: value, pickerHex: pickerHex(value)}))}
                        </div>
                    </>}
                    <Button size="sm" variant="ghost" aria-expanded={moreOpen} onClick={() => setMoreOpen(current => !current)}>
                        更多颜色
                    </Button>
                    {moreOpen && <div className="page-document-color-more">
                        <label>
                            <span>色相 · {hue}°</span>
                            <Slider
                                aria-label={`${field.label}色相`}
                                min={0}
                                max={359}
                                step={1}
                                value={hue}
                                onPointerUp={finish}
                                onPointerCancel={finish}
                                onBlur={finish}
                                onValueChange={value => publishHsv(Array.isArray(value) ? value[1] : value, saturation, brightness)}
                            />
                        </label>
                        <label>
                            <span>饱和度 · {saturation}%</span>
                            <Slider
                                aria-label={`${field.label}饱和度`}
                                min={0}
                                max={100}
                                step={1}
                                value={saturation}
                                onPointerUp={finish}
                                onPointerCancel={finish}
                                onBlur={finish}
                                onValueChange={value => publishHsv(hue, Array.isArray(value) ? value[1] : value, brightness)}
                            />
                        </label>
                        <label>
                            <span>明度 · {brightness}%</span>
                            <Slider
                                aria-label={`${field.label}明度`}
                                min={0}
                                max={100}
                                step={1}
                                value={brightness}
                                onPointerUp={finish}
                                onPointerCancel={finish}
                                onBlur={finish}
                                onValueChange={value => publishHsv(hue, saturation, Array.isArray(value) ? value[1] : value)}
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
                                    const nextHex = value.toLowerCase()
                                    const nextHsv = hexToHsv(nextHex)
                                    setHue(nextHsv.hue)
                                    setSaturation(nextHsv.saturation)
                                    setBrightness(nextHsv.value)
                                    publish({...colorRef.current, value: nextHex})
                                }}
                                onBlur={finish}
                            />
                        </label>
                        <label>
                            <span>透明度</span>
                            <span className="page-document-color-opacity">
                                <Slider
                                    aria-label={`${field.label}透明度`}
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={color.opacity}
                                    onPointerUp={finish}
                                    onPointerCancel={finish}
                                    onBlur={finish}
                                    onValueChange={value => publish({...colorRef.current, opacity: Array.isArray(value) ? value[1] : value})}
                                />
                                <Input
                                    aria-label={`${field.label}透明度百分比`}
                                    size="sm"
                                    value={String(color.opacity)}
                                    onValueChange={value => {
                                        const next = Number(value)
                                        if (!Number.isFinite(next)) return
                                        publish({...colorRef.current, opacity: clamp(next, 0, 100)})
                                    }}
                                    onBlur={finish}
                                />
                                <span>%</span>
                            </span>
                        </label>
                    </div>}
                    {error && <p className="page-document-property__message" role="alert">{error}</p>}
                </div>
            </FloatingPanel>
            {field.sourceState === 'other-viewport' && field.localValue === null && sourceColor && <Button
                size="sm"
                variant="outline"
                disabled={field.disabled}
                onClick={() => {
                    publish(sourceColor, true)
                    finish()
                }}
            >在本档覆盖</Button>}
            {!embedded && field.localValue !== null && <Button
                aria-label="清除"
                className="page-document-property__clear"
                size="sm"
                title={field.clearTitle}
                variant="ghost"
                disabled={field.disabled}
                onClick={() => void onChange({kind: 'clear-override'}, {immediate: true})}
            >清除</Button>}
            {field.reason && <p className="page-document-property__message">{field.reason}</p>}
        </section>
    )
}
