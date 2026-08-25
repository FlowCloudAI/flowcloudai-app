import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {URL} from 'node:url'

const read = relativePath => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

const appSource = read('./MobileApp.tsx')
const stackSource = read('./usePageStack.ts')
const editViewSource = read('./pages/MobileEntryDetailEditView.tsx')
const viewSource = read('./pages/MobileEntryDetailView.tsx')
const imageViewerSource = read('./components/MobileImageViewer.tsx')
const propertiesSource = read('./pages/MobileEntryProperties.tsx')
const relationSource = read('./pages/MobileEntryRelationEditor.tsx')
const storeSource = read('./stores/mobileEntryEditDraftStore.ts')
const detailSource = read('./pages/MobileEntryDetail.tsx')
const projectHomeSource = read('./pages/MobileProjectHome.tsx')
const entryListSource = read('./pages/MobileEntryList.tsx')
const navGuardSource = read('../../shared/hooks/useTopLevelNavigationGuard.ts')
const appShellSource = read('../index/AppShell.tsx')

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

test('编辑态内联预览拦截链接，且顶层导航有全局兜底', () => {
    // 2026-08-25 真机复现：内联预览的 `fc://` 双链无人接管，点一下 WebView 就载入
    // net::ERR_UNKNOWN_URL_SCHEME 错误页，整个应用被替换、未保存正文全部丢失。
    assert.match(editViewSource, /onClick=\{p\.onPreviewMarkdownClick\}/)
    assert.match(detailSource, /handleEditPreviewMarkdownClick/)
    assert.match(detailSource, /onPreviewMarkdownClick=\{handleEditPreviewMarkdownClick\}/)

    // 兜底防线必须挂在 AppShell 且用捕获阶段，否则业务处理器跑不到就被吞掉。
    assert.match(appShellSource, /useTopLevelNavigationGuard\(\)/)
    assert.match(navGuardSource, /addEventListener\('click', handleClick, true\)/)
    assert.match(navGuardSource, /event\.preventDefault\(\)/)
    assert.doesNotMatch(navGuardSource, /stopPropagation\(/)
})

test('查看态按阅读层级展示有值属性、主图、空正文操作与可收起正反链', () => {
    assert.match(detailSource, /getComparableTagValue\(viewTagMap, schema\)/)
    assert.match(detailSource, /value !== null && value !== ''/)
    assert.match(viewSource, /className="mobile-entry-detail__hero"/)
    assert.match(viewSource, /categoryName/)
    assert.match(viewSource, /更新于 \{updatedDate\}/)
    assert.match(viewSource, /这里还没有正文内容。/)
    assert.match(viewSource, /开始编辑/)
    assert.match(viewSource, /让 AI 起草/)
    assert.match(viewSource, /aria-expanded=\{linksExpanded\}/)
    assert.match(viewSource, /type=\{getRelationIcon\(relation\.direction\)\}/)
})

test('移动图片浏览器使用公共全屏 Overlay，并支持捏合、横滑和管理态多选', () => {
    assert.match(imageViewerSource, /variant="fullscreen"/)
    assert.match(imageViewerSource, /pointersRef/)
    assert.match(imageViewerSource, /startDistance/)
    assert.match(imageViewerSource, /SWIPE_THRESHOLD_PX/)
    assert.match(imageViewerSource, /selectedIndices/)
    assert.match(imageViewerSource, /data-mobile-horizontal-scroll="true"/)
    assert.match(detailSource, /<MobileImageViewer/)
    assert.match(propertiesSource, /<MobileImageViewer/)
    assert.doesNotMatch(`${detailSource}\n${propertiesSource}`, /EntryImageLightbox/)
})
