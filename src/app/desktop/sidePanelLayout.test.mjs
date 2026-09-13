import assert from 'node:assert/strict'
import test from 'node:test'

import {getSidePanelMinWidth, normalizeSidePanelLayout} from './sidePanelLayout.ts'

const contents = [
    {key: 'ai-chat', minWidth: 500, scope: 'global'},
    {key: 'help', minWidth: 420, scope: 'global'},
    {key: 'properties', minWidth: 620, scope: 'page'},
]
const splitPairs = [
    ['ai-chat', 'properties'],
    ['properties', 'help'],
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
            {primary: 'ai-chat', secondary: 'properties'},
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
            {primary: 'properties', secondary: 'help'},
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
            {primary: 'properties', secondary: null},
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
            {primary: 'ai-chat', secondary: 'properties'},
            contents,
        ),
        620,
    )
})
