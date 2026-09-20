// 本组件独立编辑 hover 与 focus-within 的有限颜色声明；交互上下文不与宽度档组合。

import {useMemo, useState} from 'react'
import type {LayerProjectionNode} from '../../domain/layerProjection.ts'
import type {KernelDraftEditRequest} from '../../application/documentKernelDraftRuntime.ts'
import {
    createInteractionColorPropertyEditRequest,
    inspectVisualProperties,
    type InspectVisualComponent,
    type VisualPropertyName,
    type VisualStyleContext,
} from '../../application/visualPropertyEditing.ts'
import {ColorPropertyControl} from './ColorPropertyControl.tsx'
import type {PropertyChangeOptions} from './NumericPropertyControl.tsx'

const COLOR_PROPERTIES = ['color', 'background-color', 'border-color'] as const satisfies readonly VisualPropertyName[]
type InteractionContext = Extract<VisualStyleContext, 'hover' | 'focus-within'>

export function InteractionStatePropertyControls({
    node,
    entryStyleCss,
    inspectComponent,
    applyKernelEntry,
}: {
    node: LayerProjectionNode
    entryStyleCss: string
    inspectComponent: InspectVisualComponent
    applyKernelEntry: (
        request: KernelDraftEditRequest,
        label: string,
        options?: PropertyChangeOptions,
    ) => Promise<boolean>
}) {
    const [context, setContext] = useState<InteractionContext>('hover')
    const fields = useMemo(
        () => inspectVisualProperties(node, inspectComponent, entryStyleCss, context, COLOR_PROPERTIES),
        [context, entryStyleCss, inspectComponent, node],
    )
    const applicable = fields.filter(field => !field.disabled)
    if (applicable.length === 0) return null
    return <section className="page-document-interaction-properties" aria-label="交互状态颜色">
        <header>
            <strong>交互状态</strong>
            <span>{context === 'hover' ? '悬停只对支持悬停的设备生效' : '节点自身或后代聚焦时生效'}</span>
        </header>
        <div className="page-document-interaction-properties__contexts" role="group" aria-label="交互状态">
            {([
                ['hover', '悬停'],
                ['focus-within', '内部聚焦'],
            ] as const).map(([value, label]) => <button
                aria-pressed={context === value}
                key={value}
                onClick={() => setContext(value)}
                type="button"
            >{label}</button>)}
        </div>
        {applicable.map(field => <ColorPropertyControl
            key={`${context}:${field.property}`}
            field={field}
            onChange={(value, options) => {
                if (value.kind !== 'color' && value.kind !== 'clear-override') {
                    throw new TypeError('交互态颜色控件只能提交颜色或清除操作。')
                }
                return applyKernelEntry(
                    createInteractionColorPropertyEditRequest(
                        node.id,
                        context,
                        field.property as typeof COLOR_PROPERTIES[number],
                        value,
                        options,
                    ),
                    `修改${context === 'hover' ? '悬停' : '内部聚焦'}${field.label}`,
                    options,
                )
            }}
        />)}
    </section>
}
