// 这些测试固定资产引用的双属性原子切换、属性补全、过期检测与幂等性。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {parseSourceSnapshot, sourceKey, type SourceDocument} from '../contracts/index.ts'
import {parseHtmlSource} from '../syntax/index.ts'
import {
    createAssetReferencePatches,
    readAssetReferenceExpectation,
} from './assetReferencePatches.ts'
import {applySourcePatches} from './sourcePatches.ts'

const NODE_ID = '22222222-2222-4222-8222-222222222222'
const OLD_ASSET_ID = '33333333-3333-4333-8333-333333333333'
const NEW_ASSET_ID = '44444444-4444-4444-8444-444444444444'

function document(content: string): SourceDocument {
    return Object.freeze({
        key: sourceKey('entry', 'article.html'),
        content,
        contentHash: 'fixture',
        persistentRevision: 1,
    })
}

function image(source: SourceDocument) {
    const parsed = parseHtmlSource(source.content, {mode: 'fragment', scope: 'entry'})
    const result = parsed.elements.find(item => item.tagName === 'img')
    assert.ok(result)
    return result
}

function apply(source: SourceDocument, patches: ReturnType<typeof createAssetReferencePatches>) {
    assert.equal(patches.status, 'ready')
    if (patches.status !== 'ready') return source.content
    const snapshot = parseSourceSnapshot({
        id: 'snapshot:asset-reference',
        templateVersion: 1,
        documents: [source],
    })
    const result = applySourcePatches(snapshot, patches.patches)
    assert.equal(result.status, 'applied')
    return result.snapshot.documents[0].content
}

describe('asset reference patches', () => {
    it('同时切换 src 与资产身份并保留其他属性', () => {
        const source = document(
            `<figure data-fc-node-id="${NODE_ID}" data-fc-node-kind="asset"><img class="keep" src="fcasset://${OLD_ASSET_ID}" data-fc-asset-id="${OLD_ASSET_ID}" alt="保留"></figure>`,
        )
        const expectation = readAssetReferenceExpectation(image(source))
        const changed = apply(
            source,
            createAssetReferencePatches(source, image(source), expectation, NEW_ASSET_ID),
        )
        assert.match(changed, new RegExp(`src="fcasset://${NEW_ASSET_ID}"`, 'u'))
        assert.match(changed, new RegExp(`data-fc-asset-id="${NEW_ASSET_ID}"`, 'u'))
        assert.match(changed, /class="keep"/u)
        assert.match(changed, /alt="保留"/u)
    })

    it('补齐缺失的双属性并支持自闭合 img', () => {
        const source = document(
            `<figure data-fc-node-id="${NODE_ID}" data-fc-node-kind="asset"><img alt="保留"/></figure>`,
        )
        const changed = apply(
            source,
            createAssetReferencePatches(
                source,
                image(source),
                {src: null, assetId: null},
                NEW_ASSET_ID.toUpperCase(),
            ),
        )
        assert.match(
            changed,
            new RegExp(
                `<img alt="保留" src="fcasset://${NEW_ASSET_ID}" data-fc-asset-id="${NEW_ASSET_ID}"/>`,
                'u',
            ),
        )
    })

    it('拒绝过期前置状态并对同一资产保持幂等', () => {
        const source = document(
            `<figure data-fc-node-id="${NODE_ID}" data-fc-node-kind="asset"><img src="fcasset://${OLD_ASSET_ID}" data-fc-asset-id="${OLD_ASSET_ID}"></figure>`,
        )
        assert.equal(
            createAssetReferencePatches(
                source,
                image(source),
                {src: 'fcasset://stale', assetId: OLD_ASSET_ID},
                NEW_ASSET_ID,
            ).status,
            'rejected',
        )
        assert.equal(
            createAssetReferencePatches(
                source,
                image(source),
                readAssetReferenceExpectation(image(source)),
                OLD_ASSET_ID,
            ).status,
            'unchanged',
        )
    })
})
