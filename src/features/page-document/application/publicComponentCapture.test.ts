// 本测试从真实预览编译入口验证“保存选中内容”为定义时的身份剥离、样式迁移与原稿只读边界。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {CANVAS_BASE_PROJECT_CSS, CANVAS_BASE_PROJECT_HTML} from '../canvas/host/compiledPreview.ts'
import {compilePreviewArtifact} from '../domain/engine/previewCompiler.ts'
import type {PublicComponentDefinitionContract} from '../domain/kernel/contracts/publicComponent.ts'
import {captureSelectedNodeAsPublicComponent} from './publicComponentCapture.ts'

const ENTRY_ID = '11111111-1111-4111-8111-111111111111'
const PROJECT_ID = '22222222-2222-4222-8222-222222222222'
const COMPONENT_ID = '33333333-3333-4333-8333-333333333333'
const ROOT_ID = '44444444-4444-4444-8444-444444444444'
const CHILD_ID = '55555555-5555-4555-8555-555555555555'
const PAGE_ROOT_ID = '66666666-6666-4666-8666-666666666666'
const INSTANCE_ID = '77777777-7777-4777-8777-777777777777'

const article = `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="entry-body"><main data-fc-node-id="${PAGE_ROOT_ID}" data-fc-node-kind="container" data-fc-editor-root><section data-fc-node-id="${ROOT_ID}" data-fc-node-kind="container" style="padding: 1rem"><p data-fc-node-id="${CHILD_ID}" data-fc-node-kind="paragraph">静态正文</p></section></main></template></template>`

const css = `@layer fc-entry { [data-fc-entry-id="${ENTRY_ID}"] { color: CanvasText; } }
@layer fc-node {
  [data-fc-node-id="${ROOT_ID}"]:hover > [data-fc-node-id="${CHILD_ID}"] { color: red; }
  @media (min-width: 40rem) { [data-fc-node-id="${CHILD_ID}"] { font-weight: 700; } }
}`

describe('保存选中内容为公共组件', () => {
    it('定义剥离页面身份并迁移节点样式，原页面源码逐字节不变', () => {
        const captured = captureSelectedNodeAsPublicComponent(article, css, ROOT_ID, COMPONENT_ID)
        assert.equal(captured.originalArticleHtml, article)
        assert.doesNotMatch(captured.form.html, /data-fc-node-(?:id|kind)/u)
        assert.match(captured.form.html, /style="padding: 1rem"/u)
        assert.match(captured.form.css, new RegExp(`\\[data-fc-component="${COMPONENT_ID}"\\] \\.fc-saved-`, 'u'))
        assert.match(captured.form.css, /:hover/u)
        assert.match(captured.form.css, /@media \(min-width: 40rem\)/u)

        const definition: PublicComponentDefinitionContract = {
            componentId: COMPONENT_ID,
            revision: 1,
            html: captured.form.html,
            css: captured.form.css,
            propertySchema: [],
            partSchema: [],
            styleVariableSchema: [],
            assetDependencies: [],
            name: '静态卡片',
            category: '基础',
            preview: null,
            ownershipScope: {kind: 'project', id: PROJECT_ID},
        }
        const instance = `<div data-fc-node-id="${ROOT_ID}" data-fc-node-kind="component" data-fc-component="${COMPONENT_ID}" data-fc-component-revision="latest" data-fc-instance="${INSTANCE_ID}"></div>`
        const result = compilePreviewArtifact({
            projectArticleHtml: CANVAS_BASE_PROJECT_HTML,
            projectStyleCss: CANVAS_BASE_PROJECT_CSS,
            entryArticleHtml: article.replace(
                /<section data-fc-node-id=.*?<\/section>/u,
                instance,
            ),
            entryStyleCss: '',
            metadata: {id: ENTRY_ID, title: '捕获测试', summary: '', tags: []},
            componentDefinitions: [definition],
        })
        assert.ok(result.srcdoc, JSON.stringify(result.diagnostics))
        assert.equal(result.diagnostics.some(item => item.severity === 'error'), false)
        assert.match(result.srcdoc ?? '', /静态正文/u)
        assert.match(result.srcdoc ?? '', /data-fc-style-scope="component"/u)
        assert.match(result.srcdoc ?? '', /@media \(min-width: 40rem\)/u)
    })
})
