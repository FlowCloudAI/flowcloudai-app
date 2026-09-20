// 本测试锁定作者标签只使用目录顺序和可读媒体信息，不泄漏内部资产标识。

import assert from 'node:assert/strict'
import test from 'node:test'
import type {PageDocumentAsset} from '../../../../api/pageDocument.ts'
import {pageDocumentAssetDisplayName, pageDocumentAssetSummary} from './assetPresentation.ts'

const asset: PageDocumentAsset = {
    id: '11111111-1111-7111-8111-111111111111',
    projectId: '22222222-2222-7222-8222-222222222222',
    mediaType: 'image/png',
    sizeBytes: 256,
    sha256: 'a'.repeat(64),
    width: 640,
    height: 360,
    createdAt: '2026-09-20T00:00:00Z',
}

test('项目图片作者标签不含资产 UUID', () => {
    assert.equal(pageDocumentAssetDisplayName(1), '项目图片 2')
    assert.equal(pageDocumentAssetSummary(asset), 'PNG 图片 · 640 × 360')
    assert.equal(`${pageDocumentAssetDisplayName(1)} ${pageDocumentAssetSummary(asset)}`.includes(asset.id), false)
})
