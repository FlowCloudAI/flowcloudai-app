// 本组件把有限数值属性呈现为滑杆、数字读数、单位、步进与快捷值；它不接收 CSS 文本。

import {useEffect, useRef, useState} from 'react'
import {Button, Input, Select, Slider} from 'flowcloudai-ui'
import type {
    VisualNumericPropertyValue,
    VisualPropertyEditValue,
    VisualPropertyState,
} from '../../application/visualPropertyEditing.ts'
import {PageDocumentStepIcon} from '../icons/PageDocumentPropertyIcons.tsx'
import {
    changeNumericPropertyUnit,
    matchingNumericPropertyPreset,
    numericPropertyDefinition,
    numericSliderDisplayValue,
    readNumericPropertyEditorValue,
    stepNumericPropertyValue,
    validateNumericPropertyDraft,
} from './numericPropertyModel.ts'

export interface PropertyChangeOptions {
    readonly historyGroupId?: string
    readonly immediate?: boolean
}

interface NumericPropertyControlProps {
    field: VisualPropertyState
    compact?: boolean
    onChange: (value: VisualPropertyEditValue, options?: PropertyChangeOptions) => Promise<boolean>
}

function createInteractionId(): string {
    return `page-property-${crypto.randomUUID()}`
}

export function NumericPropertyControl({field, compact = false, onChange}: NumericPropertyControlProps) {
    const definition = numericPropertyDefinition(field.property)
    if (!definition) throw new TypeError(`属性 ${field.property} 没有数值控件定义。`)
    const parsed = readNumericPropertyEditorValue(field.localValue ?? field.value, definition)
    const [candidate, setCandidate] = useState<VisualNumericPropertyValue>(
        parsed.kind === 'numeric' ? parsed.candidate : definition.defaultValue,
    )
    const [draft, setDraft] = useState(candidate.numberText)
    const [error, setError] = useState<string | null>(null)
    const interactionRef = useRef<string | null>(null)
    const candidateRef = useRef(candidate)
    const repeatDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const repeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const pointerSteppedRef = useRef(false)
    const pendingFlushRef = useRef(false)
    const attemptRef = useRef(0)
    const currentSource = `${field.localValue ?? field.value}\u0000${field.property}`

    useEffect(() => {
        const next = readNumericPropertyEditorValue(field.localValue ?? field.value, definition)
        if (next.kind === 'numeric') {
            setCandidate(next.candidate)
            candidateRef.current = next.candidate
            setDraft(next.candidate.numberText)
        }
        setError(null)
    // 控件定义只由当前属性派生；字段挂载期间保持不变。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentSource])

    const historyOptions = (immediate = false): PropertyChangeOptions => ({
        historyGroupId: interactionRef.current ??= createInteractionId(),
        immediate,
    })
    const requestChange = (next: VisualNumericPropertyValue, options: PropertyChangeOptions) => {
        const attempt = ++attemptRef.current
        void onChange(next, options).then(applied => {
            if (applied || attempt !== attemptRef.current) return
            const persisted = readNumericPropertyEditorValue(field.localValue ?? field.value, definition)
            if (persisted.kind !== 'numeric') return
            candidateRef.current = persisted.candidate
            setCandidate(persisted.candidate)
            setDraft(persisted.candidate.numberText)
        })
    }
    const publish = (next: VisualNumericPropertyValue, immediate = false) => {
        setCandidate(next)
        candidateRef.current = next
        setDraft(next.numberText)
        setError(null)
        pendingFlushRef.current = !immediate
        requestChange(next, historyOptions(immediate))
    }
    const flush = () => {
        if (!interactionRef.current || !pendingFlushRef.current) return
        pendingFlushRef.current = false
        requestChange(candidateRef.current, {
            historyGroupId: interactionRef.current,
            immediate: true,
        })
    }
    const finish = () => {
        flush()
        interactionRef.current = null
    }
    const stopRepeating = () => {
        if (repeatDelayRef.current) clearTimeout(repeatDelayRef.current)
        if (repeatIntervalRef.current) clearInterval(repeatIntervalRef.current)
        repeatDelayRef.current = null
        repeatIntervalRef.current = null
    }
    const beginStepping = (direction: -1 | 1) => {
        pointerSteppedRef.current = true
        interactionRef.current ??= createInteractionId()
        publish(stepNumericPropertyValue(candidateRef.current, direction, definition))
        repeatDelayRef.current = setTimeout(() => {
            repeatIntervalRef.current = setInterval(() => {
                publish(stepNumericPropertyValue(candidateRef.current, direction, definition))
            }, 90)
        }, 360)
    }

    useEffect(() => () => stopRepeating(), [])
    const range = definition.sliderRange(candidate.unit)
    const preset = matchingNumericPropertyPreset(definition.presets, candidate)
    const customValue = readNumericPropertyEditorValue(field.localValue ?? field.value, definition)

    return (
        <section className={`page-document-property${field.disabled ? ' is-disabled' : ''}${compact ? ' is-compact' : ''}`}>
            <div className="page-document-property__heading">
                <span>{field.label}</span>
                <span data-source-state={field.sourceState}>{field.statusText}</span>
            </div>
            {customValue.kind === 'custom' && (
                <div className="page-document-property__custom" role="status">
                    <span>复杂源码值会原样保留，请在代码模式调整。</span>
                    <Button size="sm" variant="outline" disabled={field.disabled} onClick={() => {
                        publish(definition.defaultValue, true)
                        finish()
                    }}>
                        改用调节控件
                    </Button>
                </div>
            )}
            <div className="page-document-property__numeric">
                <Slider
                    aria-label={`${field.label}滑杆`}
                    disabled={field.disabled}
                    min={range.minimum}
                    max={range.maximum}
                    step={range.step}
                    value={numericSliderDisplayValue(range, candidate.value)}
                    onPointerDown={() => { interactionRef.current ??= createInteractionId() }}
                    onPointerUp={finish}
                    onPointerCancel={finish}
                    onBlur={finish}
                    onKeyUp={event => {
                        if (event.key.startsWith('Arrow')) finish()
                    }}
                    onValueChange={value => {
                        const numericValue = Array.isArray(value) ? value[1] : value
                        publish({...candidate, value: numericValue, numberText: String(numericValue)})
                    }}
                />
                <div className="page-document-property__number-row">
                    <Button
                        aria-label={`${field.label}减小`}
                        iconOnly
                        size="sm"
                        variant="outline"
                        disabled={field.disabled}
                        onPointerDown={() => beginStepping(-1)}
                        onPointerUp={() => {
                            stopRepeating()
                            setTimeout(() => {
                                pointerSteppedRef.current = false
                                finish()
                            }, 0)
                        }}
                        onPointerCancel={() => {
                            stopRepeating()
                            pointerSteppedRef.current = false
                            finish()
                        }}
                        onClick={() => {
                            if (pointerSteppedRef.current) return
                            publish(stepNumericPropertyValue(candidateRef.current, -1, definition), true)
                            finish()
                        }}
                    ><PageDocumentStepIcon direction={-1}/></Button>
                    <Input
                        aria-label={`${field.label}数值`}
                        inputMode="decimal"
                        size="sm"
                        value={draft}
                        status={error ? 'error' : 'default'}
                        disabled={field.disabled}
                        onFocus={() => { interactionRef.current ??= createInteractionId() }}
                        onValueChange={next => {
                            setDraft(next)
                            const result = validateNumericPropertyDraft(next, definition)
                            setError(result.valid ? null : result.message)
                            if (result.valid) publish({...candidate, value: result.value, numberText: result.numberText})
                        }}
                        onBlur={() => {
                            const result = validateNumericPropertyDraft(draft, definition)
                            if (!result.valid) setDraft(candidate.numberText)
                            finish()
                        }}
                        onKeyDown={event => {
                            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                            event.preventDefault()
                            publish(stepNumericPropertyValue(candidate, event.key === 'ArrowUp' ? 1 : -1, definition))
                        }}
                        onKeyUp={event => {
                            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') flush()
                        }}
                    />
                    <Select
                        aria-label={`${field.label}单位`}
                        disabled={field.disabled || definition.units.length === 1}
                        value={candidate.unit}
                        options={definition.units.map(unit => ({value: unit, label: unit || '倍'}))}
                        onValueChange={value => {
                            publish(changeNumericPropertyUnit(candidate, String(value) as VisualNumericPropertyValue['unit'], definition), true)
                            finish()
                        }}
                    />
                    <Button
                        aria-label={`${field.label}增大`}
                        iconOnly
                        size="sm"
                        variant="outline"
                        disabled={field.disabled}
                        onPointerDown={() => beginStepping(1)}
                        onPointerUp={() => {
                            stopRepeating()
                            setTimeout(() => {
                                pointerSteppedRef.current = false
                                finish()
                            }, 0)
                        }}
                        onPointerCancel={() => {
                            stopRepeating()
                            pointerSteppedRef.current = false
                            finish()
                        }}
                        onClick={() => {
                            if (pointerSteppedRef.current) return
                            publish(stepNumericPropertyValue(candidateRef.current, 1, definition), true)
                            finish()
                        }}
                    ><PageDocumentStepIcon direction={1}/></Button>
                </div>
            </div>
            {definition.presets.length > 0 && (
                <div className="page-document-property__presets" role="group" aria-label={`${field.label}快捷值`}>
                    {definition.presets.map(item => (
                        <Button
                            key={`${item.value}${item.unit}`}
                            size="sm"
                            variant={preset === item ? 'secondary' : 'ghost'}
                            disabled={field.disabled}
                            aria-pressed={preset === item}
                            onClick={() => {
                                publish({kind: 'numeric', value: item.value, unit: item.unit, numberText: String(item.value)}, true)
                                finish()
                            }}
                        >{item.label}</Button>
                    ))}
                </div>
            )}
            {field.sourceState === 'other-viewport' && field.localValue === null && parsed.kind === 'numeric' && (
                <Button size="sm" variant="outline" disabled={field.disabled} onClick={() => {
                    publish(parsed.candidate, true)
                    finish()
                }}>
                    在本档覆盖
                </Button>
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
