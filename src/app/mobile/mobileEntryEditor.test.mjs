import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {URL} from 'node:url'

const read = relativePath => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

const appSource = read('./MobileApp.tsx')
const stackSource = read('./usePageStack.ts')
const editViewSource = read('./pages/MobileEntryDetailEditView.tsx')
const immersiveSource = read('./pages/MobileEntryImmersiveEditor.tsx')
const detailCssSource = read('./pages/MobileEntryDetail.css')
const topControlsSource = read('./components/MobileTopControls.tsx')
const topControlsCssSource = read('./components/MobileTopControls.css')
const mobileTokensSource = read('./mobileTokens.css')
const glassEffectSource = read('../../glassEffect.css')
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
    assert.match(editViewSource, /className="mobile-entry-detail__summary-field"/)
    assert.match(editViewSource, /className="mobile-entry-detail__body-pane"/)
    assert.match(editViewSource, /mode=\{bodyMode\}/)
    assert.match(editViewSource, /data-mobile-horizontal-scroll="true"/)
})

test('词条编辑字段有稳定名称，布尔标签公开选中状态', () => {
    assert.match(editViewSource, /<Input aria-label="词条标题"/)
    assert.match(editViewSource, /<span className="mobile-entry-detail__summary-label">摘要<\/span>/)
    assert.match(editViewSource, /'aria-label': '词条正文'/)
    assert.match(immersiveSource, /'aria-label': textareaProps\['aria-label'\] \?\? '词条正文'/)
    assert.match(tagItemSource, /aria-labelledby=\{titleId\}/)
    assert.match(tagItemSource, /aria-describedby=\{rangeText \? hintId : undefined\}/)
    assert.equal(tagItemSource.match(/aria-pressed=/g)?.length, 3)
    assert.match(relationSource, /aria-label="搜索关系目标词条"/)
    assert.match(relationSource, /aria-label="关系说明"/)
})

test('编辑主页先呈现身份与附件，键盘出现时整体折叠且右侧只保留保存', () => {
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
    assert.match(editViewSource, /const bodyKeyboardVisible = bodyFocused && p\.keyboardVisible/)
    assert.match(editViewSource, /data-body-keyboard-visible=\{bodyKeyboardVisible \|\| undefined\}/)
    assert.doesNotMatch(editViewSource, /data-body-focused/)
    assert.match(detailSource, /useSyncExternalStore\([\s\S]*?mobileKeyboardInsetState\(\)\.visible/)
    assert.match(editViewSource, /key: 'back'[\s\S]*?icon: <MobileBackIcon\/>[\s\S]*?onClick: p\.onCancel/)
    assert.doesNotMatch(editViewSource, /key: 'cancel'/)
    assert.doesNotMatch(editViewSource, /mobile-top-action-pill__text">取消/)
    assert.match(editViewSource, /key: 'save'[\s\S]*?onClick: p\.onSave/)
    assert.match(editViewSource, /保存中…/)
    assert.doesNotMatch(editViewSource, /type=\{p\.saving \? 'more' : 'save'\}/)
    assert.match(detailCssSource, /data-body-keyboard-visible='true'[^}]*mobile-entry-detail__edit-meta[\s\S]*?grid-template-rows: 0fr/)
    assert.match(detailCssSource, /not\(\[data-body-keyboard-visible='true'\]\)[^}]*mobile-entry-detail__body-pane[\s\S]*?flex: 1 0 min\(32dvh/)
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
    assert.match(viewSource, /className="mobile-entry-detail__view-actions"/)
    assert.match(detailCssSource, /mobile-entry-detail__view-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, var\(--mobile-top-surface-size\)\)/)
    assert.match(detailCssSource, /mobile-entry-detail__view-actions\s*\{[\s\S]*?grid-template-rows:\s*100%/)
    assert.match(detailCssSource, /mobile-entry-detail__view-actions\s*\{[\s\S]*?align-items:\s*center/)
    assert.match(detailCssSource, /mobile-entry-detail__view-actions \.mobile-top-action-pill__button[\s\S]*?justify-self:\s*center/)
    assert.doesNotMatch(viewSource, /key: 'edit'[\s\S]*?kind: 'primary'[\s\S]*?onClick: onEdit/)
})

test('移动图片浏览器使用公共全屏 Overlay 和标准顶栏，并支持捏合、横滑和管理态多选', () => {
    assert.match(imageViewerSource, /variant="fullscreen"/)
    assert.match(imageViewerSource, /<MobilePageTopBar/)
    assert.match(imageViewerSource, /<MobileTopActionPill/)
    assert.doesNotMatch(imageViewerSource, /<header\s/)
    assert.match(imageViewerSource, /pointersRef/)
    assert.match(imageViewerSource, /startDistance/)
    assert.match(imageViewerSource, /SWIPE_THRESHOLD_PX/)
    assert.match(imageViewerSource, /selectedIndices/)
    assert.match(imageViewerSource, /data-mobile-horizontal-scroll="true"/)
    assert.match(detailSource, /<MobileImageViewer/)
    assert.match(propertiesSource, /<MobileImageViewer/)
    assert.doesNotMatch(`${detailSource}\n${propertiesSource}`, /EntryImageLightbox/)
})

test('长正文滚动由编辑器 area 单独持有，工具栏与主图不再被重复压缩', () => {
    assert.match(detailCssSource, /mobile-entry-detail__immersive-editor \.w-md-editor-area[\s\S]*?overflow-y: auto !important/)
    assert.match(detailCssSource, /mobile-entry-detail__immersive-editor \.w-md-editor-text-pre[\s\S]*?height: auto !important[\s\S]*?min-height: 100% !important/)
    assert.match(detailCssSource, /mobile-entry-detail__immersive-editor \.w-md-editor-text-input[\s\S]*?overflow: hidden !important/)
    assert.match(detailCssSource, /mobile-entry-detail__inline-editor \.w-md-editor-area,[\s\S]*?overflow-y: auto !important/)
    assert.match(detailCssSource, /mobile-entry-detail__markdown-toolbar[\s\S]*?padding: var\(--mobile-gap-inline\) var\(--mobile-page-x\)/)
    assert.doesNotMatch(
        detailCssSource.match(/\.mobile-entry-detail__markdown-toolbar \{[\s\S]*?\n\}/)?.[0] ?? '',
        /mobile-safe-bottom/,
    )
    assert.match(detailCssSource, /mobile-entry-detail__hero[\s\S]*?flex: 0 0 auto/)
})

test('正文预览态的非选中编辑按钮保持透明且无系统蓝色点按底', () => {
    assert.match(detailCssSource, /mobile-entry-detail__body-mode button[\s\S]*?-webkit-tap-highlight-color: transparent/)
    assert.match(detailCssSource, /button\[aria-pressed='false'\][\s\S]*?background: transparent[\s\S]*?box-shadow: none/)
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

test('关系编辑区分加载、无候选与搜索无结果，不暴露不可完成的后续字段', () => {
    assert.match(relationSource, /const \[loading, setLoading\] = useState\(true\)/)
    assert.match(relationSource, /候选词条加载失败/)
    assert.match(relationSource, /项目里还没有其他词条/)
    assert.match(relationSource, /清除搜索/)
    assert.match(relationSource, /!targetSelectionUnavailable &&/)
    assert.match(relationSource, /setLoadRevision\(value => value \+ 1\)/)
})

test('本轮视觉优化收紧属性层级、保存语言、主动作和单项菜单', () => {
    assert.match(detailCssSource, /highlight-tag-item__input \.fc-input__field[\s\S]*?font-size:\s*var\(--mobile-text-body\)/)
    assert.match(detailCssSource, /mobile-entry-properties__group--types,[\s\S]*?border-bottom:\s*var\(--mobile-divider\)/)
    assert.match(detailCssSource, /mobile-entry-properties \.mobile-entry-detail__tag-select[\s\S]*?flex:\s*0 0 auto/)
    assert.match(immersiveSource, /mobile-top-action-pill__text[\s\S]*?保存中…[\s\S]*?保存/)
    assert.doesNotMatch(immersiveSource, /MobileEntryDetailActionIcon/)
    assert.match(topControlsCssSource, /mobile-top-action-pill__button--primary::before[\s\S]*?width:\s*var\(--mobile-topbar-primary-visual-size\)/)
    assert.match(topControlsSource, /items\.length === 1 \? 'mobile-anchored-menu--compact'/)
    assert.match(topControlsCssSource, /mobile-anchored-menu--compact[\s\S]*?width:\s*min\(13\.25rem/)
})

test('公共顶栏固化亮暗材质参数，且顶栏与胶囊使用独立 blur 层', () => {
    assert.match(mobileTokensSource, /--mobile-topbar-bg-filter:\s*blur\(1px\) saturate\(1\)/)
    assert.match(mobileTokensSource, /data-theme="dark"[\s\S]*?--mobile-topbar-bg-filter:\s*blur\(2px\) saturate\(1\)/)
    assert.match(mobileTokensSource, /--mobile-topbar-pill-background:\s*linear-gradient\([\s\S]*?180deg,[\s\S]*?60%[\s\S]*?25%/)
    assert.match(mobileTokensSource, /data-theme="dark"[\s\S]*?--mobile-topbar-pill-background:\s*linear-gradient\([\s\S]*?0deg,[\s\S]*?80%[\s\S]*?25%/)
    assert.match(mobileTokensSource, /--mobile-topbar-pill-border:\s*0\.6px solid/)
    assert.match(mobileTokensSource, /--mobile-topbar-primary-visual-size:\s*2\.375rem/)
    assert.match(topControlsCssSource, /\.mobile-page-topbar::before\s*\{[\s\S]*?linear-gradient/)
    assert.match(topControlsCssSource, /\.mobile-top-action-pill::before\s*\{/)
    assert.match(glassEffectSource, /\.mobile-page-topbar::before\s*\{[\s\S]*?backdrop-filter:\s*var\(--mobile-topbar-bg-filter\)/)
    assert.match(glassEffectSource, /\.mobile-top-action-pill::before\s*\{[\s\S]*?backdrop-filter:\s*var\(--mobile-topbar-pill-filter\)/)
    assert.match(glassEffectSource, /\.mobile-top-action-pill\s*\{[\s\S]*?backdrop-filter:\s*none/)
})

test('公共顶栏统一屏幕顶部距离，文字动作内边距不再额外撑宽按钮', () => {
    assert.match(mobileTokensSource, /--mobile-topbar-edge-gap:\s*calc\(var\(--mobile-gap-group\) \+ var\(--mobile-gap-text\)\)/)
    assert.match(topControlsCssSource, /--mobile-topbar-top-offset:\s*calc\([\s\S]*?--mobile-topbar-safe-offset[\s\S]*?--mobile-topbar-edge-gap/)
    assert.match(topControlsCssSource, /fc-overlay__panel--fullscreen \.mobile-page-topbar[\s\S]*?--mobile-topbar-safe-offset:\s*var\(--mobile-safe-top\)/)
    assert.match(topControlsCssSource, /mobile-top-action-pill__button\s*\{[\s\S]*?box-sizing:\s*border-box/)
    assert.doesNotMatch(detailCssSource, /mobile-entry-detail__immersive\s*\{[^}]*padding-top:\s*var\(--mobile-safe-top\)/)
})
