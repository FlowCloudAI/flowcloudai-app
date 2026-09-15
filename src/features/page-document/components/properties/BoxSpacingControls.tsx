// 本组件组合四边间距控件；纵向或横向联动时，一次交互原子修改对应两条声明。

import {useState} from 'react'
import {Button} from 'flowcloudai-ui'
import type {
    VisualPropertyEditValue,
    VisualPropertyName,
    VisualPropertyState,
} from '../../application/visualPropertyEditing.ts'
import {PageDocumentLinkIcon} from '../icons/PageDocumentPropertyIcons.tsx'
import {NumericPropertyControl, type PropertyChangeOptions} from './NumericPropertyControl.tsx'

interface BoxSpacingControlsProps {
    label: string
    fields: readonly VisualPropertyState[]
    onChange: (
        changes: readonly {property: VisualPropertyName; value: VisualPropertyEditValue}[],
        label: string,
        options?: PropertyChangeOptions,
    ) => Promise<boolean>
}

function fieldFor(fields: readonly VisualPropertyState[], property: VisualPropertyName): VisualPropertyState {
    const field = fields.find(item => item.property === property)
    if (!field) throw new TypeError(`间距控件缺少 ${property}。`)
    return field
}

export function BoxSpacingControls({label, fields, onChange}: BoxSpacingControlsProps) {
    const prefix = label === '外距' ? 'margin' : 'padding'
    const properties = {
        top: `${prefix}-block-start`,
        right: `${prefix}-inline-end`,
        bottom: `${prefix}-block-end`,
        left: `${prefix}-inline-start`,
    } as const satisfies Record<string, VisualPropertyName>
    const [verticalLinked, setVerticalLinked] = useState(false)
    const [horizontalLinked, setHorizontalLinked] = useState(false)
    const change = (
        position: keyof typeof properties,
        value: VisualPropertyEditValue,
        options?: PropertyChangeOptions,
    ) => {
        const property = properties[position]
        const partner =
            verticalLinked && position === 'top' ? properties.bottom
            : verticalLinked && position === 'bottom' ? properties.top
            : horizontalLinked && position === 'left' ? properties.right
            : horizontalLinked && position === 'right' ? properties.left
            : null
        const changes: {property: VisualPropertyName; value: VisualPropertyEditValue}[] = [
            {property, value},
        ]
        if (partner !== null) changes.push({property: partner, value})
        return onChange(changes, `调整${label}`, options)
    }

    return (
        <section className="page-document-spacing-group">
            <header>
                <strong>{label}</strong>
                <div className="page-document-spacing-group__links">
                    <Button
                        aria-label={`${verticalLinked ? '取消' : '启用'}上下联动`}
                        aria-pressed={verticalLinked}
                        iconOnly
                        size="sm"
                        variant={verticalLinked ? 'secondary' : 'ghost'}
                        onClick={() => setVerticalLinked(current => !current)}
                    ><PageDocumentLinkIcon linked={verticalLinked}/></Button>
                    <span>上下</span>
                    <Button
                        aria-label={`${horizontalLinked ? '取消' : '启用'}左右联动`}
                        aria-pressed={horizontalLinked}
                        iconOnly
                        size="sm"
                        variant={horizontalLinked ? 'secondary' : 'ghost'}
                        onClick={() => setHorizontalLinked(current => !current)}
                    ><PageDocumentLinkIcon linked={horizontalLinked}/></Button>
                    <span>左右</span>
                </div>
            </header>
            <div className="page-document-spacing-group__fields">
                {(Object.keys(properties) as (keyof typeof properties)[]).map(position => {
                    const field = fieldFor(fields, properties[position])
                    return (
                        <NumericPropertyControl
                            compact
                            field={field}
                            key={field.property}
                            onChange={(value, options) => change(position, value, options)}
                        />
                    )
                })}
            </div>
        </section>
    )
}
