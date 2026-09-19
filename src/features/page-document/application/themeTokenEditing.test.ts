// 本测试从主题任务窗格的请求绑定入口检查项目范围、CAS 分析版本和受限字段。

import assert from 'node:assert/strict'
import test from 'node:test'
import {
    analysisStampId,
} from '../domain/kernel/index.ts'
import {createDocumentKernelDraftRuntime} from './documentKernelDraftRuntime.ts'
import {
    createEntryDocumentSessionState,
} from './entryDocumentSessionModel.ts'
import {
    createThemeTokenKernelRequest,
    createThemeTokenPatch,
    updateThemeTokenEditorState,
    type ThemeTokenEditorState,
} from './themeTokenEditing.ts'

const ANALYSIS = analysisStampId('analysis:theme-ribbon')
const ENTRY_ID = '018f47a2-3b4c-7d5e-8f90-123456789abc'
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

function emptyState(): ThemeTokenEditorState {
    return {
        values: {
            '--fc-entry-surface': 'Canvas',
            '--fc-entry-text': '#111111',
            '--fc-entry-accent': '#812345',
            '--fc-entry-content-width': '48rem',
        },
        sources: {
            '--fc-entry-surface': null,
            '--fc-entry-text': null,
            '--fc-entry-accent': null,
            '--fc-entry-content-width': null,
        },
        dirtyFields: new Set(),
        analysisStamp: ANALYSIS,
    }
}

function session() {
    return createEntryDocumentSessionState({
        entryId: ENTRY_ID,
        projectId: PROJECT_ID,
        title: '主题测试',
        summary: '',
        markdown: '正文',
    }, null)
}

test('项目主题任务窗格绑定发出带 project scope 与 CAS 的主题令牌 intent', () => {
    const changed = updateThemeTokenEditorState(emptyState(), '--fc-entry-text', '#333333')
    const patch = createThemeTokenPatch(changed)
    const request = createThemeTokenKernelRequest(
        {scope: 'project', analysisStamp: ANALYSIS},
        patch,
        {},
        () => 'theme-ribbon-request',
    )
    const intent = request.createIntents(new Map())[0]

    assert.deepEqual(request.authorizedScopes, ['project'])
    assert.equal(request.expectedAnalysisStamp, ANALYSIS)
    assert.deepEqual(intent, {
        kind: 'edit-theme-token',
        target: {kind: 'theme-root', scope: 'project'},
        property: '--fc-entry-text',
        action: {kind: 'set-value', value: '#333333'},
    })
})

test('主题令牌读取状态保留分析版本，并拒绝非功能区白名单字段', () => {
    const state = updateThemeTokenEditorState(emptyState(), '--fc-entry-text', '#fff')
    assert.equal(state.analysisStamp, ANALYSIS)
    assert.throws(
        () => createThemeTokenKernelRequest(
            {scope: 'project', analysisStamp: ANALYSIS},
            {'--author-private': '#fff'},
        ),
        /白名单/u,
    )
    assert.throws(
        () => createThemeTokenKernelRequest(
            {scope: 'entry' as never, analysisStamp: ANALYSIS},
            {'--fc-entry-text': '#fff'},
        ),
        /项目作用域/u,
    )
})

test('真实 runtime 绑定把主题令牌写入项目样式草稿并拒绝过期 CAS', () => {
    const initial = session()
    const runtime = createDocumentKernelDraftRuntime()
    const inspected = runtime.inspectThemeTokens(initial.model, initial.snapshot, {
        scope: 'project',
        properties: ['--fc-entry-text'],
    })
    assert.equal(inspected.status, 'ready')
    if (inspected.status !== 'ready') return
    const stamp = inspected.tokens['--fc-entry-text']?.dependencies.analysisStamp
    assert.ok(stamp)
    const request = createThemeTokenKernelRequest(
        {scope: 'project', analysisStamp: stamp},
        {'--fc-entry-text': '#334455'},
        {},
        () => 'runtime-theme-request',
    )
    const applied = runtime.apply(initial.model, initial.snapshot, request, '修改项目正文颜色')
    assert.equal(applied.applied, true)
    assert.match(applied.model.project.sources['style.css'], /--fc-entry-text:\s*#334455/u)

    const stale = createThemeTokenKernelRequest(
        {scope: 'project', analysisStamp: stamp},
        {'--fc-entry-text': '#556677'},
        {},
        () => 'runtime-theme-stale-request',
    )
    const rejected = runtime.prepare(applied.model, initial.snapshot, stale)
    assert.equal(rejected.status, 'rejected')
    if (rejected.status === 'rejected') {
        assert.equal(rejected.diagnostics[0]?.code, 'kernel-edit-plan-stale')
    }
})
