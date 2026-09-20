// 本模块定义页面/视图功能区的值模型，并把页面内距命令绑定到现有属性内核。
import {createRibbonPropertyRequest} from './ribbonKernelBinding.ts'
import type {KernelDraftEditRequest} from '../../page-document/application/documentKernelDraftRuntime.ts'

export type DocumentQuickScope = 'entry' | 'project'
export type LayoutPreviewViewportMode = 'auto' | 'mobile' | 'tablet' | 'desktop' | 'wide'
export type ResponsiveViewportContext = 'mobile' | 'desktop'

export const PREVIEW_WIDTH_OPTION_LABELS: Readonly<Record<LayoutPreviewViewportMode, string>> = {
    auto: '自适应', mobile: '390 像素', tablet: '640 像素', desktop: '960 像素', wide: '1280 像素',
}
export const PREVIEW_WIDTH_OPTION_TITLES: Readonly<Record<LayoutPreviewViewportMode, string>> = {
    auto: '画布使用当前可用宽度', mobile: '画布固定为 390 像素宽', tablet: '画布固定为 640 像素宽',
    desktop: '画布固定为 960 像素宽', wide: '画布固定为 1280 像素宽',
}
export const RESPONSIVE_EDIT_SCOPE_LABELS: Readonly<Record<ResponsiveViewportContext, string>> = {
    mobile: '移动', desktop: '桌面',
}
export const RESPONSIVE_EDIT_SCOPE_NOTES: Readonly<Record<ResponsiveViewportContext, string>> = {
    mobile: '基础声明，在所有宽度下生效。', desktop: '宽度 768 像素及以上；清除后继承移动设置。',
}

export function createPageLayoutPaddingRequest(
    nodeId: string,
    rem: number,
    context: ResponsiveViewportContext,
): KernelDraftEditRequest {
    if (!Number.isFinite(rem) || rem < 0) throw new TypeError('页面内距必须是非负有限数。')
    const numberText = Number(rem.toFixed(4)).toString()
    return createRibbonPropertyRequest(nodeId, 'padding-block-start', {
        kind: 'numeric', value: rem, unit: 'rem', numberText,
    }, context)
}
