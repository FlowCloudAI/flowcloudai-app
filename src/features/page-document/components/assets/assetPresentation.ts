// 本模块为不保存原始文件名的项目图片生成作者可读标签，绝不把资产 UUID 暴露到作者界面。

import type {PageDocumentAsset} from '../../../../api/pageDocument.ts'

const MEDIA_TYPE_LABELS: Readonly<Record<PageDocumentAsset['mediaType'], string>> = Object.freeze({
    'image/png': 'PNG 图片',
    'image/jpeg': 'JPEG 图片',
    'image/webp': 'WebP 图片',
})

export function pageDocumentAssetDisplayName(index: number): string {
    return `项目图片 ${index + 1}`
}

export function pageDocumentAssetSummary(asset: PageDocumentAsset): string {
    return `${MEDIA_TYPE_LABELS[asset.mediaType]} · ${asset.width} × ${asset.height}`
}
