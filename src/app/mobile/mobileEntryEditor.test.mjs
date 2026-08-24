import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {URL} from 'node:url'

const read = relativePath => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

const appSource = read('./MobileApp.tsx')
const stackSource = read('./usePageStack.ts')
const editViewSource = read('./pages/MobileEntryDetailEditView.tsx')
const propertiesSource = read('./pages/MobileEntryProperties.tsx')
const relationSource = read('./pages/MobileEntryRelationEditor.tsx')
const storeSource = read('./stores/mobileEntryEditDraftStore.ts')
const detailSource = read('./pages/MobileEntryDetail.tsx')
const projectHomeSource = read('./pages/MobileProjectHome.tsx')
const entryListSource = read('./pages/MobileEntryList.tsx')

test('词条属性与关系编辑使用完整页面栈，不回退到底部面板', () => {
    assert.match(stackSource, /entryProperties:\s*MobileEntryEditChildPageParams/)
    assert.match(stackSource, /entryRelation:\s*MobileEntryRelationPageParams/)
    assert.match(appSource, /page\?\.type === 'entryProperties'[\s\S]*?<MobileEntryProperties/)
    assert.match(appSource, /page\?\.type === 'entryRelation'[\s\S]*?<MobileEntryRelationEditor/)
    assert.doesNotMatch(propertiesSource, /MobileBottomSheet/)
    assert.doesNotMatch(relationSource, /MobileBottomSheet/)
})

test('三层编辑页使用共享 store，且不新增 CustomEvent 状态同步', () => {
    assert.match(storeSource, /useSyncExternalStore/)
    assert.match(propertiesSource, /useMobileEntryEditDraft/)
    assert.match(relationSource, /useMobileEntryEditDraft/)
    assert.doesNotMatch(`${storeSource}\n${propertiesSource}\n${relationSource}`, /CustomEvent/)
})

test('编辑主页保留三行摘要、内联正文与横向工具栏手势标记', () => {
    assert.match(editViewSource, /rows=\{3\}/)
    assert.match(editViewSource, /className="mobile-entry-detail__body-pane"/)
    assert.match(editViewSource, /mode=\{bodyMode\}/)
    assert.match(editViewSource, /data-mobile-horizontal-scroll="true"/)
})

test('三层编辑页复用公共移动端顶栏，不另造编辑页壳层', () => {
    assert.match(editViewSource, /<MobilePageTopBar/)
    assert.match(editViewSource, /<MobileTopActionPill/)
    assert.match(propertiesSource, /<MobilePageTopBar/)
    assert.match(relationSource, /<MobilePageTopBar/)
    assert.doesNotMatch(editViewSource, /<header\s/)
    assert.doesNotMatch(editViewSource, /mobile-entry-detail__top-text-action/)
})

test('新建词条用显式占位标记，保存后解除标记', () => {
    assert.match(projectHomeSource, /mode:\s*'edit',\s*isPlaceholder:\s*true/)
    assert.match(entryListSource, /mode:\s*'edit',\s*isPlaceholder:\s*true/)
    assert.match(detailSource, /isPlaceholder:\s*undefined/)
    assert.match(detailSource, /discardMobileEntryPlaceholder/)
    assert.doesNotMatch(detailSource, /title\s*===\s*['"]未命名词条['"]/)
})
