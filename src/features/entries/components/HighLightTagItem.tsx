/** 词条标签值的展示与编辑单元；桌面元数据面板和移动端属性页共享同一套取值语义。 */
import {useEffect, useId, useRef} from 'react'
import {Button, Input} from 'flowcloudai-ui'
import {resolveEditableNumberTagValue} from '../lib/entryTagInput'
import './HighLightTagItem.css'

type HighLightTagType = 'number' | 'string' | 'boolean'

type HighLightTagValue = string | number | boolean | null

interface HighLightTagSchema {
    id: string
    name: string
    type: HighLightTagType
    range_min?: number | null
    range_max?: number | null
}

interface HighLightTagItemProps {
    schema: HighLightTagSchema
    value?: HighLightTagValue
    implanted?: boolean
    mode?: 'show' | 'edit'
    layout?: 'card' | 'row'
    onChange?: (value: HighLightTagValue) => void
    onRemove?: () => void
}

function formatValue(value?: HighLightTagValue): string {
    if (value == null || value === '') return '未填写'
    if (typeof value === 'boolean') return value ? '是' : '否'
    return String(value)
}

function getTypeLabel(type: HighLightTagType): string {
    if (type === 'number') return '数值'
    if (type === 'boolean') return '布尔'
    return '文本'
}

function getRangeText(schema: HighLightTagSchema): string | null {
    if (schema.type !== 'number') return null
    if (schema.range_min == null && schema.range_max == null) return null
    // 新建数值标签的默认下界是 0；只有这一项时不构成有用的范围提示。
    if (schema.range_min === 0 && schema.range_max == null) return null
    const min = schema.range_min ?? '不限'
    const max = schema.range_max ?? '不限'
    return `建议范围 ${min} - ${max}`
}

export default function HighLightTagItem({
                                              schema,
                                              value = null,
                                              implanted = false,
                                              mode = 'show',
                                              layout = 'card',
                                              onChange,
                                              onRemove,
                                          }: HighLightTagItemProps) {
    const isEditMode = mode === 'edit'
    const canRemove = isEditMode && !implanted && Boolean(onRemove)
    const rangeText = getRangeText(schema)
    const numberInputRef = useRef<HTMLInputElement>(null)
    const titleId = useId()
    const hintId = useId()

    useEffect(() => {
        const input = numberInputRef.current
        if (schema.type !== 'number' || !input || document.activeElement === input) return
        const nextValue = value == null ? '' : String(value)
        if (input.value !== nextValue) input.value = nextValue
    }, [schema.type, value])

    return (
        <div
            className={`highlight-tag-item${isEditMode ? ' is-edit' : ' is-show'}${layout === 'row' ? ' is-row' : ''}${implanted ? ' is-implanted' : ''}${canRemove ? ' has-remove' : ''}`}
        >
            <div className="highlight-tag-item__header">
                <div className="highlight-tag-item__title-group">
                    <span id={titleId} className="highlight-tag-item__title">{schema.name}</span>
                    {isEditMode && implanted && (
                        <span className="highlight-tag-item__badge">植入</span>
                    )}
                    {isEditMode && (
                        <span className={`highlight-tag-item__type is-${schema.type}`}>{getTypeLabel(schema.type)}</span>
                    )}
                </div>
                {canRemove && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="highlight-tag-item__remove"
                        title="从当前词条移除标签"
                        aria-label={`从当前词条移除标签「${schema.name}」`}
                        onClick={onRemove}
                    >
                        删除
                    </Button>
                )}
            </div>
            {isEditMode && (
                <div id={hintId} className="highlight-tag-item__hint" aria-hidden={!rangeText}>
                    {rangeText ?? '\u00a0'}
                </div>
            )}

            {isEditMode ? (
                schema.type === 'boolean' ? (
                    <div className="highlight-tag-item__bool-group highlight-tag-item__bool-group--edit" role="group" aria-labelledby={titleId}>
                        <button
                            type="button"
                            className={`highlight-tag-item__bool-chip${value == null ? ' active' : ''}`}
                            aria-pressed={value == null}
                            onClick={() => onChange?.(null)}
                        >
                            未填写
                        </button>
                        <button
                            type="button"
                            className={`highlight-tag-item__bool-chip${value === true ? ' active' : ''}`}
                            aria-pressed={value === true}
                            onClick={() => onChange?.(true)}
                        >
                            是
                        </button>
                        <button
                            type="button"
                            className={`highlight-tag-item__bool-chip${value === false ? ' active' : ''}`}
                            aria-pressed={value === false}
                            onClick={() => onChange?.(false)}
                        >
                            否
                        </button>
                    </div>
                ) : (
                    <div className="highlight-tag-item__editor highlight-tag-item__editor--edit">
                        <Input
                            ref={numberInputRef}
                            className="highlight-tag-item__input"
                            type="text"
                            inputMode={schema.type === 'number' ? 'decimal' : 'text'}
                            size="lg"
                            radius="lg"
                            value={schema.type === 'number' ? undefined : value == null ? '' : String(value)}
                            defaultValue={schema.type === 'number' && value != null ? String(value) : undefined}
                            aria-labelledby={titleId}
                            aria-describedby={rangeText ? hintId : undefined}
                            onBlur={(event) => {
                                if (schema.type !== 'number') return
                                const nextValue = resolveEditableNumberTagValue(event.currentTarget.value)
                                onChange?.(nextValue ?? null)
                            }}
                            onValueChange={(raw) => {
                                if (schema.type === 'number') {
                                    const nextValue = resolveEditableNumberTagValue(raw)
                                    if (nextValue !== undefined) onChange?.(nextValue)
                                    return
                                }

                                if (!raw.trim()) {
                                    onChange?.(null)
                                    return
                                }

                                onChange?.(raw)
                            }}
                            placeholder={schema.type === 'number' ? '输入数值' : '输入标签内容'}
                        />
                        {value != null && value !== '' && (
                            <button
                                type="button"
                                className="highlight-tag-item__clear"
                                aria-label={`清空标签「${schema.name}」`}
                                onClick={() => {
                                    if (numberInputRef.current) numberInputRef.current.value = ''
                                    onChange?.(null)
                                }}
                            >
                                清空
                            </button>
                        )}
                    </div>
                )
            ) : (
                <div
                    className={`highlight-tag-item__value highlight-tag-item__value--show${value == null || value === '' ? ' is-empty' : ''}`}>
                    {formatValue(value)}
                </div>
            )}
        </div>
    )
}
