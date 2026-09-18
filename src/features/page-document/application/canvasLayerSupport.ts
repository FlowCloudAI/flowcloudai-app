// 宿主在进入页面编辑前检查 CSS 层叠层能力；画布的 opaque origin 不能承担入口放行判断。

export type PageEntryMode = 'browse' | 'edit'

export function supportsPageDocumentLayers(host: object): boolean {
    return typeof Reflect.get(host, 'CSSLayerBlockRule') === 'function'
}

export function resolveSupportedEntryMode(mode: PageEntryMode, layersSupported: boolean): PageEntryMode {
    return mode === 'edit' && !layersSupported ? 'browse' : mode
}
