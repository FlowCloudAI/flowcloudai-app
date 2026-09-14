// 本模块定义读取环境、写入目的地、编辑目标、依赖及浏览器观测的共享契约。

import type {ManagedNodeStyleContext} from './primitives.ts'
import type {
    AnalysisStampId,
    ComponentHandle,
    InteractionId,
    NodeId,
    PreviewVersion,
} from './identity.ts'
import type {SourceKey, SourceScope, Utf16SourceRange} from './source.ts'

export interface ReadContext {
    readonly viewport: 'mobile' | 'desktop'
    readonly interactions: Readonly<{
        hover: boolean
        focusWithin: boolean
    }>
    readonly direction: 'ltr' | 'rtl' | 'unknown'
    readonly writingMode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr' | 'unknown'
}

export function parseReadContext(value: unknown): ReadContext {
    if (!isRecord(value)) throw new TypeError('ReadContext 必须是对象。')
    if (!['mobile', 'desktop'].includes(String(value.viewport))) {
        throw new TypeError('ReadContext.viewport 不受支持。')
    }
    if (!isRecord(value.interactions)) {
        throw new TypeError('ReadContext.interactions 必须是对象。')
    }
    if (
        typeof value.interactions.hover !== 'boolean' ||
        typeof value.interactions.focusWithin !== 'boolean'
    ) {
        throw new TypeError('ReadContext.interactions 必须包含布尔交互状态。')
    }
    if (!['ltr', 'rtl', 'unknown'].includes(String(value.direction))) {
        throw new TypeError('ReadContext.direction 不受支持。')
    }
    if (
        !['horizontal-tb', 'vertical-rl', 'vertical-lr', 'unknown'].includes(
            String(value.writingMode),
        )
    ) {
        throw new TypeError('ReadContext.writingMode 不受支持。')
    }
    return Object.freeze({
        viewport: value.viewport as ReadContext['viewport'],
        interactions: Object.freeze({
            hover: value.interactions.hover,
            focusWithin: value.interactions.focusWithin,
        }),
        direction: value.direction as ReadContext['direction'],
        writingMode: value.writingMode as ReadContext['writingMode'],
    })
}

export type WriteChannel =
    | {readonly kind: 'inline'}
    | {readonly kind: 'base-rule'}
    | {readonly kind: 'conditional-rule'; readonly context: ManagedNodeStyleContext}

export interface WriteDestination {
    readonly scope: SourceScope
    readonly channel: WriteChannel
}

export type EditTarget =
    | {readonly kind: 'component-root'; readonly component: ComponentHandle}
    | {
          readonly kind: 'semantic-part'
          readonly component: ComponentHandle
          readonly part: string
      }
    | {
          readonly kind: 'text-range'
          readonly component: ComponentHandle
          readonly range: Utf16SourceRange
          readonly expected: string
      }

export interface DependencySet {
    readonly nodeIds: readonly NodeId[]
    readonly parentNodeIds: readonly NodeId[]
    readonly sources: readonly SourceKey[]
    readonly declarations: readonly string[]
    readonly variables: readonly string[]
    readonly contexts: readonly ManagedNodeStyleContext[]
    readonly analysisStamp: AnalysisStampId
}

export interface RenderRect {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
}

export interface RenderObservation {
    readonly previewVersion: PreviewVersion
    readonly analysisStamp: AnalysisStampId
    readonly interactionId: InteractionId | null
    readonly target: EditTarget
    readonly rects: readonly RenderRect[]
    readonly viewportWidth: number
    readonly viewportHeight: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
