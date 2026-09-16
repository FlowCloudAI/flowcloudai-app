import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {URL} from 'node:url'

import {
    getSidePanelMinWidth,
    normalizeSidePanelLayout,
    shouldCollapseRetiredPagePanel,
} from './sidePanelLayout.ts'

const contents = [
    {key: 'ai-chat', minWidth: 500, scope: 'global'},
    {key: 'help', minWidth: 420, scope: 'global'},
    {key: 'page-properties', minWidth: 272, scope: 'page'},
]
const splitPairs = [
    ['ai-chat', 'page-properties'],
    ['page-properties', 'help'],
]

test('单栏原样通过', () => {
    assert.deepEqual(
        normalizeSidePanelLayout(
            {primary: 'help', secondary: null},
            contents,
            splitPairs,
            () => false,
        ),
        {primary: 'help', secondary: null},
    )
})

test('上下格相同时移除下格', () => {
    assert.deepEqual(
        normalizeSidePanelLayout(
            {primary: 'ai-chat', secondary: 'ai-chat'},
            contents,
            splitPairs,
            () => true,
        ),
        {primary: 'ai-chat', secondary: null},
    )
})

test('配对不允许时移除下格', () => {
    assert.deepEqual(
        normalizeSidePanelLayout(
            {primary: 'help', secondary: 'ai-chat'},
            contents,
            splitPairs,
            () => true,
        ),
        {primary: 'help', secondary: null},
    )
})

test('页面作用域的下格失活时被逐出', () => {
    assert.deepEqual(
        normalizeSidePanelLayout(
            {primary: 'ai-chat', secondary: 'page-properties'},
            contents,
            splitPairs,
            () => false,
        ),
        {primary: 'ai-chat', secondary: null},
    )
})

test('页面作用域的上格失活后下格升级', () => {
    assert.deepEqual(
        normalizeSidePanelLayout(
            {primary: 'page-properties', secondary: 'help'},
            contents,
            splitPairs,
            () => false,
        ),
        {primary: 'help', secondary: null},
    )
})

test('上格失活且没有下格时回落到 AI', () => {
    assert.deepEqual(
        normalizeSidePanelLayout(
            {primary: 'page-properties', secondary: null},
            contents,
            splitPairs,
            () => false,
        ),
        {primary: 'ai-chat', secondary: null},
    )
})

test('分栏最小宽度取上下格较大值', () => {
    assert.equal(
        getSidePanelMinWidth(
            {primary: 'ai-chat', secondary: 'page-properties'},
            contents,
        ),
        500,
    )
})

test('页面属性只注册在页面作用域且正式分栏配对表保持为空', () => {
    const registry = readFileSync(new URL('./sidePanelContents.ts', import.meta.url), 'utf8')
    const enabledEntry = readFileSync(
        new URL('../../features/page-document/editor/runtime/enabled.ts', import.meta.url),
        'utf8',
    )
    assert.match(enabledEntry, /key: 'page-properties', minWidth: 272, scope: 'page'/)
    assert.match(registry, /SIDE_PANEL_SPLIT_PAIRS[\s\S]*= \[\]/)
})

test('AI 聊天 Dock 注册 450 像素宽度下限', () => {
    const registry = readFileSync(new URL('./sidePanelContents.ts', import.meta.url), 'utf8')
    assert.match(registry, /key: 'ai-chat', minWidth: 450, scope: 'global'/)
})

test('页面作用域退位时要求收起 Dock，不把内容改回 AI', () => {
    assert.equal(
        shouldCollapseRetiredPagePanel(
            'page-properties',
            false,
            key => key === 'page-properties',
        ),
        true,
    )
    assert.equal(
        shouldCollapseRetiredPagePanel(
            'ai-chat',
            false,
            key => key === 'page-properties',
        ),
        false,
    )
})
