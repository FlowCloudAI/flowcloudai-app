// 本测试锁定待输入格式的真实界面清理入口，避免修复重渲染闪烁后把主动上下文切换误当成连续输入。

import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./PageDocumentEditor.tsx', import.meta.url), 'utf8')

test('待输入格式只跨同一文字落点的连续输入存活，真实上下文切换仍会清理', () => {
    const selectionHandler = source.slice(
        source.indexOf('const handleSelection ='),
        source.indexOf('const handleTextSelection ='),
    )
    const textSelectionHandler = source.slice(
        source.indexOf('const handleTextSelection ='),
        source.indexOf('const setTypingStyleProperty ='),
    )
    const undoHandler = source.slice(
        source.indexOf('const handleUndo ='),
        source.indexOf('const handleRedo ='),
    )
    const redoHandler = source.slice(
        source.indexOf('const handleRedo ='),
        source.indexOf('const saveStatus ='),
    )
    const contextHandler = source.slice(
        source.indexOf('const changeEditContext ='),
        source.indexOf('const commitLinkCandidate ='),
    )

    assert.match(selectionHandler, /activeTextRange\?\.nodeId !== next[\s\S]*?clearTypingContext\(\)/u)
    assert.match(textSelectionHandler, /message\.nodeId === null[\s\S]*?clearTypingContext\(\)/u)
    assert.match(textSelectionHandler, /current\.nodeId !== message\.nodeId\) return null/u)
    assert.match(undoHandler, /clearTypingContext\(\)[\s\S]*?session\.undo\(\)/u)
    assert.match(redoHandler, /clearTypingContext\(\)[\s\S]*?session\.redo\(\)/u)
    assert.match(contextHandler, /nextContext === editContext[\s\S]*?clearTypingContext\(\)[\s\S]*?setEditContext\(nextContext\)/u)
    assert.match(source, /setPropertyDockNavigation\(null\)[\s\S]*?clearTypingContext\(\)[\s\S]*?\[clearTypingContext, entryId, projectId\]/u)
})
