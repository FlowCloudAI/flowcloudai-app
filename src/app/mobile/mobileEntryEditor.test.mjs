import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {URL} from 'node:url'

const read = relativePath => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

const appSource = read('./MobileApp.tsx')
const stackSource = read('./usePageStack.ts')
const editViewSource = read('./pages/MobileEntryDetailEditView.tsx')
const detailCssSource = read('./pages/MobileEntryDetail.css')
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
const tagItemSource = read('../../features/entries/components/HighLightTagItem.tsx')

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

test('编辑主页先呈现身份与附件，正文聚焦时整体折叠且顶栏使用文字操作', () => {
    assert.ok(editViewSource.indexOf('mobile-entry-detail__edit-meta') < editViewSource.indexOf('mobile-entry-detail__body-pane'))
    // 类型只在属性页设置：编辑主页再放一个下拉就是重复入口，两处都只读展示。
    assert.match(editViewSource, /entryTypeLabel/)
    assert.doesNotMatch(editViewSource, /onEntryType/)
    assert.doesNotMatch(editViewSource, /<Select/)
    // 分类只读属于依赖剪贴板替代入口的步骤 D，本轮继续保留可编辑 Select。
    // 分类归属不在词条编辑内部变更（改归属见 plans/ENTRY-CLIPBOARD.md），
    // 编辑页与属性页都不得再出现可写的分类控件。
    assert.match(editViewSource, /categoryLabel/)
    assert.doesNotMatch(editViewSource, /onCategory/)
    assert.doesNotMatch(propertiesSource, /categoryId:/)
    assert.match(editViewSource, /addFirst compact/)
    assert.match(editViewSource, /mobile-top-action-pill__text">取消/)
    assert.match(editViewSource, /保存中…/)
    assert.doesNotMatch(editViewSource, /type=\{p\.saving \? 'more' : 'save'\}/)
    assert.match(detailCssSource, /data-body-focused='true'[^}]*mobile-entry-detail__edit-meta[\s\S]*?grid-template-rows: 0fr/)
    assert.match(detailCssSource, /mobile-entry-detail__body-mode button::after/)
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
    assert.match(viewSource, /这条词条还只有一个名字。/)
    assert.match(viewSource, /开始写正文/)   // 主操作直指要做的事，不是泛泛的「编辑」
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

test('属性与关系页使用分组列表，类型换行且标签值保持紧凑行式编辑', () => {
    assert.doesNotMatch(propertiesSource, /mobile-entry-detail__type-options" data-mobile-horizontal-scroll/)
    assert.match(detailCssSource, /mobile-entry-properties \.mobile-entry-detail__type-options[\s\S]*?flex-wrap: wrap/)
    assert.match(propertiesSource, /mobile-entry-properties__group--tags/)
    assert.ok(propertiesSource.indexOf('mobile-entry-properties__group--tags') < propertiesSource.indexOf('mobile-entry-properties__group--relations'))
    assert.match(relationSource, /mobile-entry-relation-editor__group/)
    assert.match(tagItemSource, /layout === 'row'/)
    assert.match(tagItemSource, /schema\.range_min === 0 && schema\.range_max == null/)
    assert.match(tagItemSource, /value != null && value !== ''/)
    assert.match(tagItemSource, /type="text"/)
    assert.match(tagItemSource, /inputMode=\{schema\.type === 'number' \? 'decimal' : 'text'\}/)
})
