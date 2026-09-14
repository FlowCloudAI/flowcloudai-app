// 这些测试固定源码节点接管只增加身份属性，并拒绝过期范围、模板契约节点和不匹配类型。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {
    nodeId,
    parseSourceSnapshot,
    sourceKey,
    utf16Range,
    type SourceDocument,
} from '../contracts/index.ts'
import {createOpaqueElementAdoptionPatch} from './opaqueElementAdoptionPatches.ts'
import {applySourcePatches} from './sourcePatches.ts'

const ENTRY_ID = '11111111-1111-4111-8111-111111111111'
const NEW_NODE_ID = '22222222-2222-4222-8222-222222222222'

function document(content: string): SourceDocument {
    return Object.freeze({
        key: sourceKey('entry', 'article.html'),
        content,
        contentHash: 'fixture:article',
        persistentRevision: 1,
    })
}

function entrySource(body: string): string {
    return `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body">${body}</template></template>`
}

describe('opaque element adoption patches', () => {
    it('只向完整作者元素开始标签加入稳定身份并保留内部源码', () => {
        const raw = '<p class="lead"><strong>原样</strong>&amp;正文</p>'
        const article = document(entrySource(raw))
        const from = article.content.indexOf(raw)
        const planned = createOpaqueElementAdoptionPatch(
            article,
            utf16Range(from, from + raw.length),
            raw,
            nodeId(NEW_NODE_ID),
            'paragraph',
        )
        assert.equal(planned.status, 'ready')
        if (planned.status !== 'ready') return
        const snapshot = parseSourceSnapshot({
            id: 'snapshot:opaque-adoption',
            templateVersion: 1,
            documents: [article],
        })
        const applied = applySourcePatches(snapshot, [planned.patch])
        assert.equal(applied.status, 'applied')
        const html = applied.snapshot.documents[0]?.content ?? ''
        assert.match(
            html,
            new RegExp(
                `<p class="lead" data-fc-node-id="${NEW_NODE_ID}" data-fc-node-kind="paragraph"><strong>原样<\\/strong>&amp;正文<\\/p>`,
                'u',
            ),
        )
    })

    it('拒绝过期原文、模板契约节点和类型不匹配', () => {
        const raw = '<p>正文</p>'
        const article = document(entrySource(raw))
        const from = article.content.indexOf(raw)
        const range = utf16Range(from, from + raw.length)
        assert.equal(
            createOpaqueElementAdoptionPatch(
                article,
                range,
                '<p>旧文</p>',
                nodeId(NEW_NODE_ID),
                'paragraph',
            ).status,
            'rejected',
        )
        const contractRaw = '<div data-fc-slot="custom"></div>'
        const contractArticle = document(entrySource(contractRaw))
        const contractFrom = contractArticle.content.indexOf(contractRaw)
        const contract = createOpaqueElementAdoptionPatch(
            contractArticle,
            utf16Range(contractFrom, contractFrom + contractRaw.length),
            contractRaw,
            nodeId(NEW_NODE_ID),
            'container',
        )
        assert.equal(contract.status, 'rejected')
        if (contract.status === 'rejected')
            assert.equal(contract.code, 'opaque-adoption-contract-node')
        const mismatch = createOpaqueElementAdoptionPatch(
            article,
            range,
            raw,
            nodeId(NEW_NODE_ID),
            'heading',
        )
        assert.equal(mismatch.status, 'rejected')
        if (mismatch.status === 'rejected')
            assert.equal(mismatch.code, 'opaque-adoption-kind-mismatch')
    })
})
