// 这些测试固定图片说明内容的实体编码、图注增删改、复杂内容识别和过期前置条件。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {parseSourceSnapshot, sourceKey, type SourceDocument} from '../contracts/index.ts'
import {parseHtmlSource} from '../syntax/index.ts'
import {
    createAssetAltPatch,
    createAssetCaptionPatch,
    readAssetCaptionState,
} from './assetContentPatches.ts'
import {applySourcePatches, type SourcePatch} from './sourcePatches.ts'

const NODE_ID = '22222222-2222-4222-8222-222222222222'

function document(content: string): SourceDocument {
    return Object.freeze({
        key: sourceKey('entry', 'article.html'),
        content,
        contentHash: 'fixture',
        persistentRevision: 1,
    })
}

function elements(source: SourceDocument) {
    const parsed = parseHtmlSource(source.content, {mode: 'fragment', scope: 'entry'})
    const root = parsed.elements.find(item =>
        item.attrs.some(attribute => attribute.name === 'data-fc-node-id'),
    )
    const image = parsed.elements.find(item => item.tagName === 'img')
    assert.ok(root)
    assert.ok(image)
    return {root, image}
}

function apply(source: SourceDocument, patches: readonly SourcePatch[]): string {
    const snapshot = parseSourceSnapshot({
        id: 'snapshot:asset-content',
        templateVersion: 1,
        documents: [source],
    })
    const result = applySourcePatches(snapshot, patches)
    assert.equal(result.status, 'applied')
    return result.snapshot.documents[0].content
}

describe('asset content patches', () => {
    it('替换或添加 alt 时按解码值检查前置条件并安全编码属性', () => {
        const source = document(
            `<figure data-fc-node-id="${NODE_ID}" data-fc-node-kind="asset"><img alt="甲 &amp; 乙" src="asset://fixture"></figure>`,
        )
        const changed = createAssetAltPatch(
            source,
            elements(source).image,
            '甲 & 乙',
            '甲 "新"\n乙',
        )
        assert.equal(changed.status, 'ready')
        if (changed.status !== 'ready') return
        assert.match(apply(source, [changed.patch]), /alt="甲 &quot;新&quot;&#10;乙"/u)

        const absent = document(
            `<figure data-fc-node-id="${NODE_ID}" data-fc-node-kind="asset"><img src="asset://fixture"/></figure>`,
        )
        const added = createAssetAltPatch(absent, elements(absent).image, null, '')
        assert.equal(added.status, 'ready')
        if (added.status === 'ready') assert.match(apply(absent, [added.patch]), /alt=""\/>/u)
        assert.equal(
            createAssetAltPatch(source, elements(source).image, null, '错误').status,
            'rejected',
        )
    })

    it('新增、替换和删除图注时保持图片源码并用 br 表达换行', () => {
        const source = document(
            `<figure data-fc-node-id="${NODE_ID}" data-fc-node-kind="asset">\n  <img alt="" src="asset://fixture">\n</figure>`,
        )
        const added = createAssetCaptionPatch(
            source,
            elements(source).root,
            {kind: 'absent'},
            '甲\n乙',
        )
        assert.equal(added.status, 'ready')
        if (added.status !== 'ready') return
        const withCaption = document(apply(source, [added.patch]))
        assert.match(withCaption.content, /<img[^>]+>\n {2}<figcaption>甲<br>乙<\/figcaption>/u)

        const state = readAssetCaptionState(elements(withCaption).root)
        assert.deepEqual(state, {status: 'ready', state: {kind: 'plain', text: '甲\n乙'}})
        const removed = createAssetCaptionPatch(
            withCaption,
            elements(withCaption).root,
            {kind: 'plain', text: '甲\n乙'},
            null,
        )
        assert.equal(removed.status, 'ready')
        if (removed.status === 'ready') {
            const result = apply(withCaption, [removed.patch])
            assert.doesNotMatch(result, /figcaption/u)
            assert.match(result, /<img alt="" src="asset:\/\/fixture">/u)
        }
    })

    it('复杂图注替换会显式标记损失，嵌套或重复图注则拒绝接管', () => {
        const source = document(
            `<figure data-fc-node-id="${NODE_ID}" data-fc-node-kind="asset"><img alt="" src="asset://fixture"><figcaption><em>甲</em>乙</figcaption></figure>`,
        )
        const changed = createAssetCaptionPatch(
            source,
            elements(source).root,
            {kind: 'structured', text: '甲乙'},
            '新图注',
        )
        assert.equal(changed.status, 'ready')
        if (changed.status === 'ready') assert.equal(changed.replacedStructuredContent, true)

        const nested = document(
            `<figure data-fc-node-id="${NODE_ID}" data-fc-node-kind="asset"><img alt="" src="asset://fixture"><div><figcaption>嵌套</figcaption></div></figure>`,
        )
        assert.equal(readAssetCaptionState(elements(nested).root).status, 'rejected')
    })
})
