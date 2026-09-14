// 本模块把资产 UUID 切换编译为内部 img 的最小属性补丁；二进制资产与引用存在性由宿主资产流程保证。

import type {HtmlCompositionElement} from '../composition/index.ts'
import type {AssetReferenceExpectation} from '../contracts/edit.ts'
import {utf16Range, type SourceDocument} from '../contracts/source.ts'
import type {SourcePatch} from './sourcePatches.ts'

export type AssetReferencePatchResult =
    | {readonly status: 'ready'; readonly patches: readonly SourcePatch[]}
    | {readonly status: 'unchanged'}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

export function createAssetReferencePatches(
    document: SourceDocument,
    image: HtmlCompositionElement,
    expected: AssetReferenceExpectation,
    assetId: string,
): AssetReferencePatchResult {
    if (document.key.scope !== 'entry' || document.key.file !== 'article.html') {
        return rejected('asset-reference-source-invalid', '词条资产引用只能写入词条 article.html。')
    }
    if (image.tagName !== 'img') {
        return rejected('asset-reference-image-invalid', '资产引用目标不是内部图片。')
    }
    const current = readAssetReferenceExpectation(image)
    if (current.src !== expected.src || current.assetId !== expected.assetId) {
        return rejected('asset-reference-precondition-failed', '图片资产引用已变化，请重新读取。')
    }
    const normalized = assetId.toLowerCase()
    const values = Object.freeze({
        src: `fcasset://${normalized}`,
        'data-fc-asset-id': normalized,
    })
    if (current.src === values.src && current.assetId === values['data-fc-asset-id']) {
        return {status: 'unchanged'}
    }

    const patches: SourcePatch[] = []
    const additions: string[] = []
    for (const [name, value] of Object.entries(values)) {
        const range = image.sourceCodeLocation?.attrs?.[name]
        if (!range) {
            additions.push(` ${name}="${value}"`)
            continue
        }
        patches.push(
            Object.freeze({
                source: document.key,
                range: utf16Range(range.startOffset, range.endOffset),
                expected: document.content.slice(range.startOffset, range.endOffset),
                insert: `${name}="${value}"`,
            }),
        )
    }
    if (additions.length > 0) {
        const at = startTagInsertionOffset(document.content, image)
        if (at === null) return rejected('source-location-missing', '无法定位内部图片开始标签。')
        patches.push(
            Object.freeze({
                source: document.key,
                range: utf16Range(at, at),
                expected: '',
                insert: additions.join(''),
            }),
        )
    }
    return Object.freeze({status: 'ready', patches: Object.freeze(patches)})
}

export function readAssetReferenceExpectation(
    image: HtmlCompositionElement,
): AssetReferenceExpectation {
    return Object.freeze({
        src: attribute(image, 'src'),
        assetId: attribute(image, 'data-fc-asset-id'),
    })
}

function attribute(element: HtmlCompositionElement, name: string): string | null {
    return element.attrs.find(candidate => candidate.name === name)?.value ?? null
}

function startTagInsertionOffset(source: string, element: HtmlCompositionElement): number | null {
    const range = element.sourceCodeLocation?.startTag
    if (!range) return null
    const raw = source.slice(range.startOffset, range.endOffset)
    return range.endOffset - (raw.endsWith('/>') ? 2 : 1)
}

function rejected(code: string, message: string) {
    return Object.freeze({status: 'rejected' as const, code, message})
}
