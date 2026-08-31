import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {URL} from 'node:url'

const mobileAppSource = readFileSync(new URL('./MobileApp.tsx', import.meta.url), 'utf8')
const mobileAppCss = readFileSync(new URL('./MobileApp.css', import.meta.url), 'utf8')
const mobileNavSource = readFileSync(new URL('./MobileNav.tsx', import.meta.url), 'utf8')
const mobileNavCss = readFileSync(new URL('./MobileNav.css', import.meta.url), 'utf8')
const sideDrawerGestureSource = readFileSync(new URL('./useMobileSideDrawerGesture.ts', import.meta.url), 'utf8')
const mobileAiComposerSource = readFileSync(new URL('./pages/MobileAiComposer.tsx', import.meta.url), 'utf8')
const mobileAiChatUiSource = readFileSync(new URL('./pages/MobileAiChatUi.tsx', import.meta.url), 'utf8')
const mobileAiMessageListSource = readFileSync(new URL('./pages/MobileAiMessageList.tsx', import.meta.url), 'utf8')
const mobileAiChatCss = readFileSync(new URL('./pages/MobileAiChat.css', import.meta.url), 'utf8')
const mobileAiChatSource = readFileSync(new URL('./pages/MobileAiChat.tsx', import.meta.url), 'utf8')
const mobileAiMessageScrollSource = readFileSync(new URL('./pages/useMobileAiMessageScroll.ts', import.meta.url), 'utf8')
const mobileIdeaSource = readFileSync(new URL('./pages/MobileIdea.tsx', import.meta.url), 'utf8')
const mobileTimelineSource = readFileSync(new URL('./pages/MobileTimeline.tsx', import.meta.url), 'utf8')
const mobileRelationGraphSource = readFileSync(new URL('./pages/MobileRelationGraph.tsx', import.meta.url), 'utf8')
const glassEffectCss = readFileSync(new URL('../../glassEffect.css', import.meta.url), 'utf8')
const mobileTopControlsSource = readFileSync(new URL('./components/MobileTopControls.tsx', import.meta.url), 'utf8')
const mobileTopControlsCss = readFileSync(new URL('./components/MobileTopControls.css', import.meta.url), 'utf8')
const overlaySource = readFileSync(new URL('../../shared/ui/overlay/Overlay.tsx', import.meta.url), 'utf8')
const overlayCss = readFileSync(new URL('../../shared/ui/overlay/Overlay.css', import.meta.url), 'utf8')
const mobileAiConversationDrawerSource = readFileSync(new URL('./pages/MobileAiConversationDrawer.tsx', import.meta.url), 'utf8')
const mobileSettingsPluginPagesSource = readFileSync(new URL('./pages/MobileSettingsPluginPages.tsx', import.meta.url), 'utf8')
const mobileWorldCheckGenerateSource = readFileSync(new URL('./pages/MobileWorldCheckGenerate.tsx', import.meta.url), 'utf8')
const accessibilityCss = readFileSync(new URL('./mobileAccessibility.css', import.meta.url), 'utf8')
const tokensCss = readFileSync(new URL('./mobileTokens.css', import.meta.url), 'utf8')
const androidBridge = readFileSync(new URL('../../../src-tauri/gen/android/app/src/main/java/cn/flowcloudai/www/MainActivity.kt', import.meta.url), 'utf8')
const androidManifest = readFileSync(new URL('../../../src-tauri/gen/android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8')
const iosBridge = readFileSync(new URL('../../../src-tauri/ios/Sources/MobileUiBridge.m', import.meta.url), 'utf8')
const mobileUiApi = readFileSync(new URL('../../api/mobileUi.ts', import.meta.url), 'utf8')
const androidPredictiveBackHook = readFileSync(new URL('./useAndroidPredictiveBack.ts', import.meta.url), 'utf8')
const appBootstrapSource = readFileSync(new URL('../../main.tsx', import.meta.url), 'utf8')
const appShellSource = readFileSync(new URL('../index/AppShell.tsx', import.meta.url), 'utf8')
const themeProviderSource = readFileSync(new URL('../../../node_modules/flowcloudai-ui/src/ThemeProvider.tsx', import.meta.url), 'utf8')

test('移动窗口在后端就绪后直接显示，不依赖 requestAnimationFrame', () => {
    assert.match(mobileAppSource, /mobileWindowShown = true\s+showWindow\(\)\.catch/)
    assert.doesNotMatch(mobileAppSource, /requestAnimationFrame\([\s\S]{0,120}showWindow\(/)
})

test('页面 gutter 与底栏共同消费左右安全区', () => {
    assert.match(tokensCss, /--mobile-safe-left:\s*max\(env\(safe-area-inset-left/)
    assert.match(tokensCss, /--mobile-safe-right:\s*max\(env\(safe-area-inset-right/)
    assert.match(tokensCss, /--mobile-page-x:\s*max\(/)
    assert.match(mobileNavCss, /var\(--mobile-safe-left\)/)
    assert.match(mobileNavCss, /var\(--mobile-safe-right\)/)
    assert.doesNotMatch(mobileAppCss, /env\(safe-area-inset-/)
})

test('底部导航覆盖到机器底部，滚动页穿过其背后且固定页保护交互边界', () => {
    assert.match(tokensCss, /--mobile-nav-height:\s*calc\(var\(--mobile-nav-content-height\) \+ var\(--mobile-safe-bottom\)\)/)
    assert.match(tokensCss, /--mobile-nav-glass-filter:\s*blur\(24px\)/)
    assert.match(tokensCss, /--mobile-nav-surface:\s*color-mix\([^;]+50%[^;]+transparent\)/)
    assert.match(mobileAppCss, /\.mobile-app\s*\{[\s\S]*?--mobile-nav-reserved-height:\s*var\(--mobile-nav-height\)/)
    const tabViewRule = mobileAppCss.match(/\.mobile-app__tab-view\s*\{([^}]*)\}/)?.[1] ?? ''
    assert.doesNotMatch(tabViewRule, /padding-bottom/)
    assert.match(mobileAppCss, /\.mobile-page\s*\{[\s\S]*?--mobile-scroll-nav-spacer:\s*max\(/)
    assert.match(mobileAppCss, /\.mobile-page:not\(\.mobile-nav-safe-fixed\)\s*\{[\s\S]*?padding-bottom:\s*calc\([\s\S]*?var\(--mobile-scroll-nav-spacer\)/)
    assert.match(mobileAppCss, /\.mobile-nav-safe-fixed\s*\{[\s\S]*?padding-bottom:\s*var\(--mobile-nav-reserved-height\)/)
    // 角色对话会在同一个 className 上追加 is-character，所以这里钉的是「两个基础类都在」，
    // 不是整串字面量。
    assert.match(mobileAiChatSource, /className=\{`mobile-ai-chat mobile-nav-safe-fixed\$\{/)
    // composer 必须消费外壳的保留高度，但允许在其上再叠键盘上沿间距（--mobile-ai-keyboard-gap）。
    assert.match(mobileAiChatCss, /\.mobile-ai-chat__composer\s*\{[\s\S]*?bottom:\s*(?:calc\()?var\(--mobile-nav-reserved-height\)/)
    assert.match(mobileIdeaSource, /className="mobile-idea mobile-nav-safe-fixed"/)
    assert.match(mobileTimelineSource, /className="mobile-page mobile-nav-safe-fixed mobile-timeline-page"/)
    assert.match(mobileRelationGraphSource, /className="mobile-page mobile-nav-safe-fixed mobile-relation-graph-page"/)
    assert.match(mobileNavCss, /\.mobile-nav\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?bottom:\s*0;[\s\S]*?height:\s*var\(--mobile-nav-height\)/)
    assert.match(glassEffectCss, /:root \.mobile-nav\s*\{[\s\S]*?background:\s*var\(--mobile-nav-surface\);[\s\S]*?backdrop-filter:\s*var\(--mobile-nav-glass-filter\)/)
})

test('Android 通过 WindowInsets 补齐系统栏安全区并允许横屏', () => {
    assert.match(androidBridge, /WindowInsetsCompat\.Type\.systemBars\(\)/)
    assert.match(androidBridge, /WindowInsetsCompat\.Type\.displayCutout\(\)/)
    assert.match(androidBridge, /--mobile-native-inset-bottom/)
    assert.doesNotMatch(androidManifest, /android:screenOrientation="portrait"/)
})

test('键盘输入模式不再隐藏或禁用底部导航', () => {
    assert.doesNotMatch(mobileAppSource, /suppressed=\{mobileInputModeActive\}/)
    assert.doesNotMatch(mobileNavSource, /suppressed|aria-hidden=|inert=/)
    assert.doesNotMatch(mobileNavCss, /\.mobile-nav\.is-suppressed/)
    assert.match(mobileAppSource, /if \(mobileInputModeActive\) dismissFocusedInput\(\)/)
})

test('可读三级文字和统一 48px 命中区只覆盖 touch density', () => {
    assert.match(accessibilityCss, /:root\[data-fc-density="touch"\]/)
    /*
     * important 是用来压颜色主题覆盖的：那份运行时样式按 `html:root { … !important }`
     * 写死全部 fc 令牌，不带 important 的本条会被盖掉，三级文字掉回配方的 T60/T50
     * （真机实测浅色 3.13:1、深色 4.22:1，都低于正文 4.5:1 门槛）。
     * 两边都 important 时按特异性决出：(0,2,0) 胜 (0,1,1)。
     */
    assert.match(
        accessibilityCss,
        /--fc-color-text-tertiary:\s*var\(--mobile-color-text-readable-tertiary\)\s*!important/,
    )
    // 指向次级色而不是写死的灰：换配方后三级文字仍跟着主题走，只是走到读得清的那一档。
    assert.match(accessibilityCss, /--mobile-color-text-readable-tertiary:\s*var\(--fc-color-text-secondary\)/)
    assert.match(accessibilityCss, /::placeholder[\s\S]*opacity:\s*1/)
    assert.match(accessibilityCss, /min-inline-size:\s*var\(--fc-control-tap-min\)/)
    assert.match(accessibilityCss, /min-block-size:\s*var\(--fc-control-tap-min\)/)
    assert.match(tokensCss, /--mobile-tap-min:\s*3rem/)
    assert.match(tokensCss, /--fc-control-tap-min:\s*var\(--mobile-tap-min\)/)
})

test('可选择状态同时提供非颜色视觉提示与 ARIA 状态', () => {
    assert.match(mobileNavSource, /aria-current=\{activeTab === key \? 'page'/)
    assert.match(mobileNavCss, /\.mobile-nav__item\.active \.mobile-nav__label[\s\S]*font-weight:\s*var\(--mobile-weight-strong\)/)
    assert.match(mobileAiComposerSource, /aria-pressed=\{p\.thinking\}/)
    assert.match(mobileAiConversationDrawerSource, /aria-current=\{conversation\.id === props\.activeConversationId/)
    // 插件类型筛选随插件库一起搬到了独立设置页。
    assert.match(mobileSettingsPluginPagesSource, /aria-pressed=\{pluginKindFilter === value\}/)
    // 目标词条候选随「生成新报告」一起搬到了独立页面。
    assert.match(mobileWorldCheckGenerateSource, /role="option"[\s\S]{0,120}aria-selected=\{entry\.id === targetEntryId\}/)
})

test('AI 输入区使用紧凑 capsule，同时保留独立的透明命中层', () => {
    const capsuleRule = mobileAiChatCss.match(/\.mobile-ai-composer-card__chip\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    assert.match(capsuleRule, /padding:\s*0 var\(--mobile-gap-item\)/)
    assert.match(capsuleRule, /border-radius:\s*var\(--fc-radius-full\)/)
    assert.match(capsuleRule, /line-height:\s*var\(--mobile-leading-snug\)/)
    /*
     * 视觉高度对齐发送按钮直径即可，关键是**不能**被撑到 48px 命中基线——
     * 那样就退回「视觉尺寸=命中尺寸」，输入区会整体变高。
     */
    assert.match(capsuleRule, /height:\s*var\(--mobile-ai-composer-send-size\)/)
    assert.doesNotMatch(capsuleRule, /(?:min-)?height:\s*var\(--mobile-tap-min\)/)
    assert.match(mobileAiChatCss, /--mobile-ai-composer-icon-size:\s*calc\([\s\S]*?var\(--mobile-tap-min\) - var\(--mobile-gap-item\) - var\(--mobile-gap-inline\)[\s\S]*?\)/)
    assert.match(mobileAiChatCss, /--mobile-ai-composer-more-size:\s*calc\([\s\S]*?var\(--mobile-ai-composer-icon-size\) - var\(--mobile-ai-composer-outline-width\)/)
    assert.match(mobileAiChatCss, /--mobile-ai-composer-send-size:\s*calc\([\s\S]*?var\(--mobile-ai-composer-icon-size\) \+ var\(--mobile-gap-text\)/)
    assert.match(mobileAiChatCss, /--mobile-ai-composer-card-min-height:\s*calc\([\s\S]*?var\(--mobile-tap-min\) \+ var\(--mobile-tap-min\) \+ var\(--mobile-gap-item\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card__chip::after\s*\{[\s\S]*?inset-block:\s*calc\(0px - var\(--mobile-gap-inline\)\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card textarea\s*\{[\s\S]*?flex:\s*1 1 auto/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card__bar\s*\{[\s\S]*?margin-top:\s*auto/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card__actions\s*\{\s*gap:\s*var\(--mobile-gap-group\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card__icon-btn::after\s*\{[\s\S]*?width:\s*var\(--mobile-ai-composer-icon-hit-size\);[\s\S]*?height:\s*var\(--mobile-ai-composer-icon-hit-size\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card__icon-btn\s*\{[\s\S]*?border:\s*var\(--mobile-ai-composer-outline-width\) solid currentColor;[\s\S]*?background:\s*transparent;/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card__icon-btn \.mobile-top-control-svg--add\s*\{[\s\S]*?stroke-width:\s*3;/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card__icon-btn--send\s*\{[\s\S]*?background:\s*var\(--fc-color-primary\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card__icon-btn--send \.mobile-ai-svg\s*\{[\s\S]*?width:\s*var\(--mobile-gap-group\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card__icon-btn--send \.mobile-ai-svg :is\(path, rect\)\s*\{[\s\S]*?vector-effect:\s*non-scaling-stroke/)
})

test('AI 模型选择器与标准顶栏表面消费同一高度 Token', () => {
    assert.match(tokensCss, /--mobile-top-surface-size:\s*2\.5rem/)
    assert.match(mobileTopControlsCss, /\.mobile-top-action-pill\s*\{[\s\S]*?height:\s*var\(--mobile-top-surface-size\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-model-pill\s*\{[\s\S]*?--fc-control-tap-min:\s*var\(--mobile-top-surface-size\);[\s\S]*?height:\s*var\(--mobile-top-surface-size\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-model-pill::after\s*\{[\s\S]*?inset-block:\s*calc\(0px - var\(--mobile-gap-text\)\)/)
})

test('AI 模型按钮使用左对齐正文字号，菜单选中态使用 SVG', () => {
    assert.match(mobileAiChatCss, /\.mobile-ai-model-pill\s*\{[\s\S]*?justify-content:\s*flex-start;[\s\S]*?font-size:\s*var\(--mobile-text-body-sm\);[\s\S]*?text-align:\s*left;/)
    assert.match(mobileTopControlsSource, /export function MobileCheckIcon\(\)[\s\S]*?<svg[\s\S]*?<path/)
    // 2 处：模型列表与插件列表。工具模式菜单已改用左侧标记 + 语义色，不再放对钩。
    assert.equal((mobileAiComposerSource.match(/<MobileCheckIcon\/>/g) ?? []).length, 2)
    assert.doesNotMatch(mobileAiChatCss, /content:\s*["']✓["']/)
})

test('AI 会话抽屉使用紧凑且统一的搜索与筛选高度', () => {
    assert.match(mobileAiConversationDrawerSource, /<Input[^\n]*aria-label="搜索对话"[^\n]*size="md"[^\n]*className="mobile-drawer-search"/)
    assert.match(mobileAiChatCss, /--mobile-ai-drawer-control-height:\s*var\(--fc-control-height-md\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-drawer \.mobile-drawer-search \.fc-input__field\s*\{[\s\S]*?font-size:\s*var\(--mobile-text-body-sm\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-drawer \.mobile-drawer-segmented\s*\{[\s\S]*?height:\s*var\(--mobile-ai-drawer-control-height\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-drawer \.mobile-drawer-segmented button::after\s*\{[\s\S]*?inset-block:\s*calc\(0px - var\(--mobile-gap-text\) - 1px\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-model-menu__row \.mobile-ai-svg\s*\{[\s\S]*?width:\s*1\.375rem;[\s\S]*?height:\s*1\.375rem;/)
})

test('AI 工具模式菜单用左侧标记表示选中，颜色与输入卡胶囊同一套', () => {
    assert.match(mobileAiComposerSource, /MobileAiIcon type=\{option\.mode\} strokeWidth=\{1\.7\}/)
    // 标题后面不再跟对钩：选中态由左侧标记与文字颜色表达。
    assert.match(mobileAiComposerSource, /mobile-ai-tool-mode-menu__label[^>]*>\{option\.label\}<\/span>/)
    assert.doesNotMatch(mobileAiChatCss, /mobile-ai-tool-mode-menu__label \.mobile-check-icon/)
    assert.match(mobileAiChatUiSource, /writer:\s*'写入免确认'/)
    // 2026-08-24：本条曾要求菜单自带 0.875rem/0.71875rem 两个局部字号变量，与
    // mobileUiBaseline 的「字号只有 5 档」断言直接冲突，整套 test:mobile-shell 因此长期阻塞。
    // 以基线为准，改为断言菜单消费标尺内字号。
    // 宽度按内容取，11rem 只作为上限；左下角锚点由 --left/--placement-top 的 left/bottom 决定，
    // 与宽度无关，所以这里只钉宽度策略，不钉具体像素。
    assert.match(mobileAiChatCss, /\.mobile-ai-tool-mode-menu\s*\{[\s\S]*?width:\s*max-content;\s*max-width:\s*min\(11rem,[\s\S]*?padding:\s*var\(--mobile-gap-text\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-tool-mode-menu__label\s*\{[\s\S]*?font-size:\s*var\(--mobile-text-body-sm\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-tool-mode-menu__row .mobile-anchored-menu__text small\s*\{[\s\S]*?font-size:\s*var\(--mobile-text-meta\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-tool-mode-menu__row\s*\{[\s\S]*?grid-template-columns:\s*1\.375rem minmax\(0, 1fr\);[\s\S]*?min-height:\s*calc\(var\(--mobile-tap-min\) \+ var\(--mobile-gap-text\)\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-tool-mode-menu__row \.mobile-ai-svg\s*\{[\s\S]*?width:\s*1\.375rem;[\s\S]*?height:\s*1\.375rem;/)
    assert.match(mobileAiChatCss, /\.mobile-ai-tool-mode-menu__row\.active\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?color:\s*var\(--fc-color-primary\)/)
    // 左侧标记跟随行的文字色，否则三种模式的标记会全变成主色蓝。
    assert.match(mobileAiChatCss, /\.mobile-ai-tool-mode-menu__row\.active::before\s*\{[\s\S]*?width:\s*2px;[\s\S]*?background:\s*currentColor/)
    // 与 .mobile-ai-composer-card__chip--mode 的读者绿 / 作家黄保持同一套语义色；
    // assistant 不单列，沿用 .row.active 的主色蓝。
    assert.match(mobileAiChatCss, /\.mobile-ai-tool-mode-menu__row--reader\.active\s*\{\s*color:\s*var\(--fc-color-success\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-tool-mode-menu__row--writer\.active\s*\{\s*color:\s*var\(--fc-color-warning\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card__chip--mode\.is-reader\s*\{[\s\S]*?color:\s*var\(--fc-color-success\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card__chip--mode\.is-writer\s*\{[\s\S]*?color:\s*var\(--fc-color-warning\)/)
})

test('AI 更多面板通过公共 Overlay 完整绘制进退场', () => {
    assert.match(mobileAiComposerSource, /<MobileBottomSheet open=\{p\.morePanelOpen\}/)
    assert.match(overlaySource, /if \(variant === 'sheet'\)/)
    assert.match(overlaySource, /mountedFrame = window\.requestAnimationFrame\(\(\) => \{[\s\S]*?activeFrame = window\.requestAnimationFrame/)
    assert.match(overlaySource, /closedFrame = window\.requestAnimationFrame\(\(\) => \{\s*unmountFrame = window\.requestAnimationFrame/)
    assert.match(overlaySource, /data-state=\{active \? 'open' : 'closed'\}/)
    // 起手位置压到屏幕外再多 2rem，让加速段走完在视野外；时长与 SHEET_TRANSITION_MS 对齐。
    assert.match(overlayCss, /\.fc-overlay--sheet \.fc-overlay__panel\s*\{\s*transform:\s*translateY\(calc\(100% \+ 2rem\)\)/)
    assert.match(overlayCss, /\.fc-overlay--sheet\s*\{[\s\S]*?--fc-overlay-transition-duration:\s*250ms/)
    // y1 决定起手速度。真机 screencast 实测：y1=1 时 83% 行程 95ms 走完、y1=0.45 时 127ms，
    // 都读作闪现；现值 y1=0.25 + 450ms 摊到约 245ms。改这两个值要重新量。
    assert.match(overlayCss, /--fc-overlay-transition-easing:\s*cubic-bezier\(0\.33, 0\.25, 0\.25, 1\)/)
    assert.match(overlaySource, /SHEET_TRANSITION_MS = 250/)
    /*
     * 进场必须是关键帧动画，不能退回纯过渡。
     * 过渡依赖「起始状态被绘制过一帧」，而真实触摸事件在一帧开头派发、早于该帧的
     * rAF，Overlay.tsx 的双 rAF 兜不住，过渡整个不启动；合成 click 测不出来。
     */
    assert.match(overlayCss, /\.fc-overlay--sheet\[data-state='open'\] \.fc-overlay__panel\s*\{[\s\S]*?animation:\s*fc-overlay-sheet-rise/)
    assert.match(overlayCss, /@keyframes fc-overlay-sheet-rise\s*\{[\s\S]*?from\s*\{[\s\S]*?translateY\(calc\(100% \+ 2rem\)\)/)
    assert.match(overlayCss, /\.fc-overlay\[data-state='open'\] \.fc-overlay__panel\s*\{\s*transform:\s*none/)
})

test('AI 操作图标使用通过审计的 SVG 轮廓与统一描边', () => {
    assert.match(mobileAiChatUiSource, /M7\.6 8h8\.8v4\.2a4\.4 4\.4 0 0 1-8\.8 0Z/)
    assert.match(mobileAiChatUiSource, /M13\.3 3\.5 6\.9 12\.6h4\.9l-1\.1 7\.9 6\.4-9\.4h-4\.8Z/)
    assert.match(mobileAiChatUiSource, /fill: 'currentColor', strokeWidth: 2\.1/)
    assert.match(mobileAiChatUiSource, /M12 8\.8C10 7\.2 7\.6 6\.4 4\.7 6\.4v10\.3/)
    assert.match(mobileAiChatUiSource, /M12 3\.6 19 6\.3v5\.2c0 4\.3-2\.8 7\.3-7 8\.9/)
    assert.match(mobileAiChatUiSource, /m5 19 1\.2-4\.7L15\.5 5a1\.6 1\.6 0 0 1 2\.3 0/)
})

test('AI 空消息态不重复避让键盘且不会把拖动升级成视觉视口平移', () => {
    assert.match(mobileAiMessageListSource, /const showEmptyState = messages\.length === 0 && !isStreaming/)
    assert.match(mobileAiMessageListSource, /mobile-ai-chat__messages--empty/)
    const messagesRule = mobileAiChatCss.match(/\.mobile-ai-chat__messages\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    assert.match(messagesRule, /padding:[\s\S]*?var\(--mobile-ai-messages-bottom-space\)/)
    assert.match(messagesRule, /scroll-padding-bottom:\s*var\(--mobile-ai-messages-bottom-space\)/)
    assert.doesNotMatch(messagesRule, /--mobile-keyboard-extra/)
    assert.match(mobileAiChatCss, /\.mobile-ai-chat__messages--empty\s*\{[\s\S]*?gap:\s*0;[\s\S]*?overflow-y:\s*hidden;[\s\S]*?overscroll-behavior:\s*none;[\s\S]*?touch-action:\s*none;/)
    assert.match(mobileAiMessageScrollSource, /container\.scrollTop = messageListEmpty \? 0 : container\.scrollHeight/)
})

test('移动 AI 首次进入新对话，灵感页打开时不抢输入焦点', () => {
    assert.doesNotMatch(mobileAiChatSource, /initialConversationRestoreAttemptedRef/)
    assert.doesNotMatch(mobileAiChatSource, /activeHistoryConversation/)
    assert.doesNotMatch(mobileAiChatSource, /switchConversation\([^)]*conversations\[0\]/)
    assert.doesNotMatch(mobileIdeaSource, /\bautoFocus\b/)
    // 用户主动点“新建灵感”仍可直接开始输入；只取消页面挂载时的隐式聚焦。
    assert.match(mobileIdeaSource, /controller\.startNewIdea\(\)[\s\S]*requestAnimationFrame\(\(\) => contentRef\.current\?\.focus\(\)\)/)
})

test('系统主题偏好与解析结果分离，iOS system 模式不反向锁死 WebView 外观', () => {
    assert.match(appBootstrapSource, /setAttribute\('data-theme-preference', initialTheme\)[\s\S]*prefers-color-scheme: dark/)
    assert.match(appShellSource, /const \{theme\} = useTheme\(\)/)
    assert.match(appShellSource, /setAttribute\('data-theme-preference', theme\)/)
    assert.match(themeProviderSource, /const handler = \(\) => setSystemTheme[\s\S]*handler\(\)[\s\S]*addEventListener\('change', handler\)/)
    assert.match(iosBridge, /UIUserInterfaceStyleUnspecified/)
    assert.match(iosBridge, /preference === 'light' \|\| preference === 'dark'/)
    assert.match(iosBridge, /attributeFilter: \['data-theme', 'data-theme-preference'\]/)
})

test('iOS 与 Android 系统栏跟随应用解析后的主题', () => {
    assert.match(androidBridge, /MutationObserver\(syncNativeTheme\)/)
    assert.match(androidBridge, /isAppearanceLightStatusBars = light/)
    assert.match(androidBridge, /isAppearanceLightNavigationBars = light/)
    assert.match(iosBridge, /MutationObserver\(syncNativeTheme\)/)
    assert.match(iosBridge, /window\.overrideUserInterfaceStyle = style/)
    assert.match(iosBridge, /setNeedsStatusBarAppearanceUpdate/)
})

test('两端原生桥实现 success、warning、impact、selection 四种触觉语义', () => {
    assert.match(androidManifest, /android\.permission\.VIBRATE/)
    assert.match(androidBridge, /VibrationEffect\.EFFECT_DOUBLE_CLICK/)
    assert.match(androidBridge, /VibrationEffect\.EFFECT_HEAVY_CLICK/)
    assert.match(androidBridge, /VibrationEffect\.EFFECT_CLICK/)
    assert.match(androidBridge, /VibrationEffect\.EFFECT_TICK/)
    assert.match(iosBridge, /UINotificationFeedbackTypeSuccess/)
    assert.match(iosBridge, /UINotificationFeedbackTypeWarning/)
    assert.match(iosBridge, /UIImpactFeedbackStyleMedium/)
    assert.match(iosBridge, /UISelectionFeedbackGenerator/)
    assert.match(mobileUiApi, /'success' \| 'warning' \| 'impact' \| 'selection'/)
    // 底部 Tab 不再震动：高频连点场景下触觉是噪音，不是反馈。
    assert.doesNotMatch(mobileNavSource, /mobile_haptic/)
    // 侧栏开合到位才震，且只在状态真的翻转时（半途松手弹回不算）。
    assert.match(sideDrawerGestureSource, /mobile_haptic\('impact'\)/)
    assert.match(sideDrawerGestureSource, /drawerSettleHapticRef\.current = stateChanged/)
})

test('Android 按系统导航模式选择预测式返回或应用内边缘手势', () => {
    assert.match(androidBridge, /handleOnBackStarted\(backEvent: BackEventCompat\)/)
    assert.match(androidBridge, /handleOnBackProgressed\(backEvent: BackEventCompat\)/)
    assert.match(androidBridge, /handleOnBackCancelled\(\)/)
    assert.match(androidBridge, /flowcloudai:android-back-invoked/)
    assert.match(androidBridge, /fun getNavigationMode\(\): String/)
    assert.match(mobileUiApi, /getAndroidNavigationMode/)
    assert.match(mobileAppSource, /platformInfo\.os === 'android' \? getAndroidNavigationMode\(\) : 'unknown'/)
    assert.match(mobileAppSource, /platformInfo\.os === 'android' && androidNavigationMode === 'buttons'/)
    assert.match(mobileAppSource, /useAndroidPredictiveBack\(/)
    assert.match(androidPredictiveBackHook, /flowcloudai:android-back-progress/)
    assert.match(androidPredictiveBackHook, /setPhase\('tracking'\)/)
    assert.match(androidPredictiveBackHook, /setProgress\(latestProgressRef\.current\)/)
})
