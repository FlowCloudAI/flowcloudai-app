// 本测试固定 iframe 几何换算与桌面词条浮窗的内链范围，不改变点击导航。

import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {parseCanvasHoverEntryTarget} from '../../../entries/lib/entryCanvasHoverTarget.ts'
import {canvasRectToHostViewport} from './linkHoverGeometry.ts'

const ENTRY_ID = '018f47a2-3b4c-7d5e-8f90-123456789abc'

test('画布视口矩形按 iframe 的主页面位置换算供 fixed 浮窗使用', () => {
    assert.deepEqual(
        canvasRectToHostViewport({top: 120, left: 50}, {top: -8, left: 30, width: 72, height: 18}),
        {top: 112, left: 80, width: 72, height: 18},
    )
})

test('只有本项目 UUID 内链与标题内链触发词条浮窗解析', () => {
    assert.equal(parseCanvasHoverEntryTarget(`fc://self/entry/${ENTRY_ID}`)?.entryId, ENTRY_ID)
    assert.equal(parseCanvasHoverEntryTarget(`entry://${ENTRY_ID}`)?.entryId, ENTRY_ID)
    assert.equal(parseCanvasHoverEntryTarget('entry-title://%E5%BE%85%E5%BB%BA')?.title, '待建')
    for (const href of [
        null, 'https://example.invalid', 'mailto:a@example.invalid', '#section',
        `entry://${ENTRY_ID}/${ENTRY_ID}`, `fc://${ENTRY_ID}/entry/${ENTRY_ID}`,
        'javascript:alert(1)', 'entry-title://%GG',
    ]) assert.equal(parseCanvasHoverEntryTarget(href), null, String(href))
})

test('桌面浏览与页面编辑两处入口接入悬停回调，移动入口不接入', () => {
    const entry = readFileSync(new URL('../../../entries/components/EntryEditor.tsx', import.meta.url), 'utf8')
    const editor = readFileSync(new URL('../../components/PageDocumentEditor.tsx', import.meta.url), 'utf8')
    const mobile = readFileSync(new URL('../../../../app/mobile/pages/MobileEntryDetailView.tsx', import.meta.url), 'utf8')
    assert.equal(entry.match(/onLinkHover=\{handlePageDocumentLinkHover\}/gu)?.length, 2)
    assert.match(entry, /<EntryEditorLinkPreview/u)
    assert.match(editor, /onLinkHover=\{onLinkHover\}/u)
    assert.doesNotMatch(mobile, /onLinkHover/u)
})
