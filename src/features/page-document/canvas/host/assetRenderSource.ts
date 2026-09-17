// 本模块把资产读取绑定到已实际挂载的渲染回执；待渲染或过期请求不能提前消耗图片帧。

import {isolatePageDocument} from '../runtime/isolationPolicy.ts'

export interface CanvasAssetRenderSource {
    requestId: string
    html: string
    css: string
}

export function sourceForRenderedAssetRequest(
    current: CanvasAssetRenderSource | null,
    renderedRequestId: string,
): CanvasAssetRenderSource | null {
    return current?.requestId === renderedRequestId ? current : null
}

export function requestedCanvasAssetIds(source: CanvasAssetRenderSource, missingAssetIds: readonly string[]): string[] {
    const isolated = isolatePageDocument(source.html, source.css)
    const displayed = new Set(isolated.artifact?.displayAssetIds ?? [])
    return [...new Set(missingAssetIds.map(id => id.toLowerCase()))].filter(id => displayed.has(id))
}
