/**
 * 验证共享撤销、元数据保存状态与词条详情加载等仍使用的辅助逻辑。
 */
import assert from 'node:assert/strict'
import {UndoRedoHistory} from '../src/shared/hooks/useUndoRedo.ts'
import {resolveEntrySaveStatus} from '../src/features/entries/hooks/useEntrySaveStatus.ts'
import {ensureEntryDetailLoaded} from '../src/features/entries/lib/entryDetailLoading.ts'
import {resolveSavedState, shouldAutoSave} from '../src/features/entries/lib/entrySaveState.ts'
import {resolveEditableNumberTagValue} from '../src/features/entries/lib/entryTagInput.ts'
import {
    buildEntryContentDiffPresentation,
    computeEntryContentDiff,
    resolveActiveEntryContentDiffHunk,
} from '../src/features/entries/lib/entryContentDiff.ts'

const history = new UndoRedoHistory('初始内容')
history.setPending('刚输入的内容')

assert.equal(history.canUndo, true)
assert.equal(history.undo(), '初始内容')
assert.equal(history.canRedo, true)
assert.equal(history.redo(), '刚输入的内容')

history.undo()
history.setPending('新的分支')
assert.equal(history.canRedo, false)
history.commitPending()
assert.equal(history.redo(), null)

const selectionHistory = new UndoRedoHistory({
    content: '初始内容',
    selection: {start: 2, end: 4},
})
selectionHistory.setPending({
    content: '修改后的内容',
    selection: {start: 6, end: 6},
})
assert.deepEqual(selectionHistory.undo()?.selection, {start: 2, end: 4})
assert.deepEqual(selectionHistory.redo()?.selection, {start: 6, end: 6})

const savedHistory = new UndoRedoHistory('保存前')
savedHistory.setPending('已提交保存')
savedHistory.commitPending()
savedHistory.push('数据库归一化结果')
assert.equal(savedHistory.undo(), '已提交保存')
assert.equal(savedHistory.undo(), '保存前')

assert.deepEqual(
    resolveEntrySaveStatus({
        entryLoaded: true,
        hasChanges: true,
        trimmedTitle: '词条',
        hasInvalidRelationDrafts: false,
        saving: false,
        saveError: '磁盘写入失败',
    }),
    {
        kind: 'error',
        text: '保存失败',
        detail: '磁盘写入失败',
    },
)

assert.equal(
    resolveEntrySaveStatus({
        entryLoaded: true,
        hasChanges: true,
        trimmedTitle: '词条',
        hasInvalidRelationDrafts: false,
        saving: false,
        saveError: null,
    }).kind,
    'dirty',
)

const loadedEntryDetailIds = new Set()
const pendingEntryDetailLoads = new Map()
let entryDetailLoadCount = 0
let finishEntryDetailLoad
const loadEntryDetail = () => {
    entryDetailLoadCount += 1
    return new Promise((resolve) => {
        finishEntryDetailLoad = resolve
    })
}
const firstEntryDetailLoad = ensureEntryDetailLoaded(
    'entry',
    loadedEntryDetailIds,
    pendingEntryDetailLoads,
    loadEntryDetail,
)
const secondEntryDetailLoad = ensureEntryDetailLoaded(
    'entry',
    loadedEntryDetailIds,
    pendingEntryDetailLoads,
    loadEntryDetail,
)
assert.equal(firstEntryDetailLoad, secondEntryDetailLoad)
assert.equal(entryDetailLoadCount, 1)
finishEntryDetailLoad()
await firstEntryDetailLoad
assert.equal(pendingEntryDetailLoads.size, 0)

const submittedDraft = {content: '已提交'}
const refreshedDraft = {content: '数据库结果'}
assert.equal(resolveSavedState(submittedDraft, submittedDraft, refreshedDraft), refreshedDraft)
const concurrentDraft = {content: '保存期间继续输入'}
assert.equal(resolveSavedState(concurrentDraft, submittedDraft, refreshedDraft), concurrentDraft)
assert.equal(shouldAutoSave(true, true, false, true), false)
assert.equal(shouldAutoSave(true, true, true, true), true)

assert.equal(resolveEditableNumberTagValue('87'), 87)
assert.equal(resolveEditableNumberTagValue(''), null)
assert.equal(resolveEditableNumberTagValue('-'), undefined)

const contentDiff = computeEntryContentDiff(
    '开头\n每日两次呼叫\n未修改甲\n未修改乙\n结尾',
    '开头\n每日三次定时呼叫\n未修改甲\n未修改乙\n结尾',
)
const contentDiffPresentation = buildEntryContentDiffPresentation(contentDiff, false)
assert.equal(contentDiffPresentation.hunkCount, 1)
assert.equal(contentDiffPresentation.removedCount, 1)
assert.equal(contentDiffPresentation.addedCount, 1)
assert.equal(contentDiffPresentation.rows.some(row => row.kind === 'omitted'), true)
const highlightedAddition = contentDiffPresentation.rows.find(
    row => row.kind === 'line' && row.type === 'added',
)
assert.equal(
    highlightedAddition?.kind === 'line'
    && highlightedAddition.segments.some(segment => segment.changed && segment.text === '三次定时'),
    true,
)
assert.equal(resolveActiveEntryContentDiffHunk([120, 480, 860], 100), 0)
assert.equal(resolveActiveEntryContentDiffHunk([120, 480, 860], 500), 1)
