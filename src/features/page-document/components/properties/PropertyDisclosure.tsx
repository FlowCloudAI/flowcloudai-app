// 本组件用原生 details 收纳一组属性，并以当前作者设置数量提供稳定摘要。

import {useState, type ReactNode} from 'react'
import type {VisualPropertyName, VisualPropertyState} from '../../application/visualPropertyEditing.ts'
import {propertyDisclosurePresentation} from './propertyDisclosureModel.ts'

export function PropertyDisclosure({
    title,
    fields,
    properties,
    children,
}: {
    readonly title: string
    readonly fields: readonly VisualPropertyState[]
    readonly properties: readonly VisualPropertyName[]
    readonly children: ReactNode
}) {
    const presentation = propertyDisclosurePresentation(fields, properties)
    const [open, setOpen] = useState(presentation.defaultOpen)
    return <details
        className="page-document-property-disclosure"
        open={open}
        onToggle={event => setOpen(event.currentTarget.open)}
    >
        <summary>
            <span>
                <strong>{title}</strong>
                <small>{presentation.summary}</small>
            </span>
            {presentation.authorValueCount > 0 && <span className="page-document-property-disclosure__badge">
                已设置 {presentation.authorValueCount}
            </span>}
        </summary>
        <div className="page-document-property-disclosure__body">{children}</div>
    </details>
}
