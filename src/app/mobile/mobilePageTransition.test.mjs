import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {URL} from 'node:url'

import {getMobilePageTransitionLayers} from './mobilePageTransition.ts'

const mobileAppCss = readFileSync(new URL('./MobileApp.css', import.meta.url), 'utf8')
const mobileAppSource = readFileSync(new URL('./MobileApp.tsx', import.meta.url), 'utf8')
const transitionHostSource = readFileSync(new URL('./MobilePageTransitionHost.tsx', import.meta.url), 'utf8')
const sideDrawerGestureSource = readFileSync(new URL('./useMobileSideDrawerGesture.ts', import.meta.url), 'utf8')
const pagePopTransitionSource = readFileSync(new URL('./useMobilePagePopTransition.ts', import.meta.url), 'utf8')
const mobileTokensCss = readFileSync(new URL('./mobileTokens.css', import.meta.url), 'utf8')

test('双层转场在空栈中只保留根页', () => {
    assert.deepEqual(getMobilePageTransitionLayers([], 'home-root'), [
        {key: 'home-root', page: null},
    ])
})

test('双层转场只保留当前页和直接前驱，并保持稳定 key', () => {
    const entries = [
        {key: 'page-1', page: {type: 'projectList'}},
        {key: 'page-2', page: {type: 'projectHome', params: {projectId: 'world-1'}}},
        {key: 'page-3', page: {type: 'entryList', params: {projectId: 'world-1'}}},
    ]
    assert.deepEqual(getMobilePageTransitionLayers(entries, 'home-root'), [
        entries[1],
        entries[2],
    ])
})

test('直接前驱默认停止绘制，仅在边缘返回预热后显示', () => {
    const baseLayerRule = mobileAppCss.match(/\.mobile-page-transition-host__layer\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
    assert.match(baseLayerRule, /visibility:\s*hidden/)
    assert.match(transitionHostSource, /inert=\{!layerInteractive\}/)
    assert.match(mobileAppCss, /\.mobile-page-transition-host__layer\.is-underlay\s*\{[\s\S]*?z-index:\s*1/)
    assert.match(mobileAppCss, /\.is-edge-back-prepared \.mobile-page-transition-host__layer\.is-underlay\s*\{[\s\S]*?visibility:\s*visible/)
    assert.match(mobileAppSource, /edgeBackOrigin \? ' is-edge-back-prepared'/)
    assert.match(sideDrawerGestureSource, /onPointerDownCapture:\s*preparePointerEdgeBack/)
})

test('边缘返回以 transform transitionend 完成结算并原子清理页面身份', () => {
    assert.match(sideDrawerGestureSource, /completeEdgeBackTransition/)
    assert.match(mobileAppSource, /onTransitionEnd=\{handleEdgeBackTransitionEnd\}/)
    assert.match(mobileAppSource, /onEdgeBackFinish:\s*pointerEdgeBackEnabled \? handleEdgeBackFinish/)
    assert.match(mobileAppSource, /onFinish:\s*handleEdgeBackFinish/)
    assert.doesNotMatch(mobileAppSource, /if \(activeEdgeBackPhase === 'idle'\) setEdgeBackOrigin\(null\)/)
})

test('无手势的返回也走滑出转场，顶栏按钮与三键返回和边缘手势同一个视觉', () => {
    // 顶栏返回、三键导航返回都没有手势输入，改由定时器把同一段位移跑完再出栈。
    assert.match(mobileAppSource, /runPagePopTransition\(\(\) => activeStack\.popWithoutAnimation\(\)\)/)
    assert.match(mobileAppSource, /runPagePopTransition\(\(\) => stack\.popWithoutAnimation\(\)\)/)
    // 出栈用 popWithoutAnimation：pop 会让新栈顶再叠一段 enter-pop 淡入，和滑出打架。
    assert.doesNotMatch(mobileAppSource, /pop: \(\) => stacks\[activeTab\]\.pop\(\)/)
    // 空栈没有可滑出的前景层，保持原来的直接调用。
    assert.match(mobileAppSource, /if \(!stack\.canGoBack\)\s*\{\s*stack\.pop\(\)/)
})

test('返回滑出有 50ms 硬下限，CSS 与提交定时器读同一组 token', () => {
    // 再短整页横移就不是「退回上一页」而是跳切：位移是整个视口宽，起止之间没有中间态可看。
    assert.match(mobileTokensCss, /--mobile-duration-back-floor:\s*50ms/)
    assert.match(
        mobileTokensCss,
        /--mobile-duration-back:\s*max\(var\(--mobile-duration-back-floor\), var\(--mobile-duration-base\)\)/,
    )
    // 减少动态效果要把下限一起归零，否则 max\(\) 会把归零后的 base 抬回 50ms。
    assert.match(
        mobileTokensCss,
        /@media \(prefers-reduced-motion: reduce\)[\s\S]*?--mobile-duration-back-floor:\s*0ms/,
    )
    assert.match(
        mobileAppCss,
        /\.mobile-page-transition-host__layer\.is-edge-back-foreground[\s\S]*?transition:\s*transform var\(--mobile-duration-back\) var\(--mobile-ease-back\)/,
    )
    /*
     * 返回不能复用 --mobile-ease-standard：它是 ease-out-quint，前 15% 的时间走完 65% 的路程。
     * 手势拖到一半再松手时剩下的路程本来就短，用 quint 只剩两三帧可看，观感是页面凭空消失。
     * 真机 A/B（松手位置同为 202px）：quint 走完 90% 用 2ms，quad 用 48ms。
     */
    assert.match(mobileTokensCss, /--mobile-ease-back:\s*cubic-bezier\(0\.25, 0\.46, 0\.45, 0\.94\)/)
    assert.doesNotMatch(mobileAppCss, /is-edge-back-foreground[\s\S]*?transition:\s*transform[^;]*--mobile-ease-standard/)
    /*
     * 定时器与 CSS 必须算出同一个数：短了会在动画没走完时就出栈，
     * 长了会让旧页停在屏幕右缘干等。两边都只依赖这两个 token，所以不会各自漂。
     */
    assert.match(pagePopTransitionSource, /Math\.max\(\s*readTimeTokenMs\('--mobile-duration-back-floor', 50\),\s*readTimeTokenMs\('--mobile-duration-base', 220\),\s*\)/)
    assert.match(pagePopTransitionSource, /prefers-reduced-motion: reduce\)'\)\.matches\) return 0/)
})

test('滑出转场空转两帧再给终点，且动画途中不再受理返回', () => {
    // 类名与终点位移落在同一次 commit 里时起始值就是终点值，transform 过渡不会启动。
    assert.match(pagePopTransitionSource, /requestAnimationFrame\([\s\S]*?requestAnimationFrame\([\s\S]*?setProgress\(1\)/)
    // 减少动态效果时直接提交，不排一次空动画。
    assert.match(pagePopTransitionSource, /if \(duration <= 0\)\s*\{\s*commit\(\)/)
    assert.match(pagePopTransitionSource, /if \(runningRef\.current\) return/)
    // 提交与复位同批，旧层在这次 commit 里卸载，不会有弹回原位的中间帧。
    assert.match(pagePopTransitionSource, /commit\(\)\s*\n\s*setProgress\(0\)\s*\n\s*setPhase\('idle'\)/)
    // 三条返回路径合流后，handleBack 的闸门必须认合流后的相位。
    assert.match(mobileAppSource, /const handleBack = useCallback\(\(\) => \{[\s\S]*?if \(activeEdgeBackPhase !== 'idle'\) return/)
})

test('边缘返回与侧边抽屉使用独立拖动态，返回手势不会改变整页外壳圆角', () => {
    assert.match(mobileAppSource, /sideDrawerDragging \? ' is-drawer-dragging'/)
    assert.match(mobileAppSource, /edgeBackTransitionDisabled \|\| activeEdgeBackPhase === 'tracking'/)
    assert.match(mobileAppCss, /\.is-drawer-dragging \.mobile-app-side-drawer-shell__surface[\s\S]*?border-radius:/)
    assert.match(mobileAppCss, /\.is-edge-back-direct \.mobile-page-transition-host__layer\.is-edge-back-foreground/)
    assert.doesNotMatch(mobileAppCss, /\.is-edge-back-direct \.mobile-app-side-drawer-shell__surface\s*\{[\s\S]*?border-radius:/)
})

test('侧边抽屉逐帧位移绕过 React state，只更新三个直接绘制节点', () => {
    assert.match(mobileAppSource, /drawerVisualRef:\s*sideDrawerPanelRef/)
    assert.match(mobileAppSource, /surfaceVisualRef:\s*sideDrawerSurfaceRef/)
    assert.match(mobileAppSource, /scrimVisualRef:\s*sideDrawerScrimRef/)
    assert.match(sideDrawerGestureSource, /requestAnimationFrame\(flushDrawerVisual\)/)
    assert.match(sideDrawerGestureSource, /drawer\.style\.transform/)
    assert.match(sideDrawerGestureSource, /surface\.style\.transform/)
    assert.match(sideDrawerGestureSource, /scrim\.style\.opacity/)
    assert.doesNotMatch(sideDrawerGestureSource, /style\.setProperty\('--mobile-entry-drawer-/)
    assert.doesNotMatch(sideDrawerGestureSource, /setOffset\(/)
    assert.doesNotMatch(mobileAppSource, /sideDrawerSurfaceOffset/)
})

test('抽屉吸附阶段保留运动几何，圆角不与 transform 收尾同帧拆除', () => {
    const surfaceRule = mobileAppCss.match(/^\.mobile-app-side-drawer-shell__surface \{[\s\S]*?\n\}/m)?.[0] ?? ''
    assert.match(surfaceRule, /transition:\s*transform var\(--mobile-duration-base\) var\(--mobile-ease-standard\);/)
    // 注释里可以提 border-radius，声明里不行：它一旦回到 transition 列表就会和 transform 同批收尾。
    assert.doesNotMatch(surfaceRule, /transition:[^;]*border-radius/)
    assert.doesNotMatch(surfaceRule, /\n\s*border-radius\s*:/)

    const motionRule = mobileAppCss.match(
        /^\.mobile-app-side-drawer-shell\.is-drawer-dragging \.mobile-app-side-drawer-shell__surface,[\s\S]*?\n\}/m,
    )?.[0] ?? ''
    assert.match(motionRule, /\.is-drawer-settling \.mobile-app-side-drawer-shell__surface/)
    assert.match(motionRule, /\.is-open \.mobile-app-side-drawer-shell__surface/)
    assert.match(motionRule, /border-left-color:\s*var\(--fc-color-border\)/)
    assert.match(motionRule, /border-radius:\s*var\(--mobile-radius-sheet\)/)

    assert.match(mobileAppSource, /sideDrawerSettling \? ' is-drawer-settling'/)
    assert.match(mobileAppSource, /onTransitionEnd=\{handleSurfaceTransitionEnd\}/)
    assert.match(
        mobileAppSource,
        /event\.propertyName !== 'transform'[\s\S]*?event\.target !== event\.currentTarget[\s\S]*?completeDrawerSettle\(\)/,
    )
    // 吸附态只作用于外壳 surface，不得渗到页面层，否则又变回泛化拖动态。
    assert.doesNotMatch(mobileAppCss, /is-drawer-settling[^{]*\.mobile-page-transition-host__layer/)
    assert.doesNotMatch(mobileAppCss, /is-drawer-settling[^{]*\.mobile-app__tab-view/)
})

test('吸附结束靠 transitionend 加静止帧，并对丢事件与 0ms 动效兜底', () => {
    assert.match(sideDrawerGestureSource, /const \[drawerSettling, setDrawerSettling\] = useState\(false\)/)
    assert.match(sideDrawerGestureSource, /if \(hadMotion\) beginDrawerSettle\(stateChanged\)/)
    // transitionend 之后再空转两帧，保证静止画面已经真正绘制过才拆几何。
    assert.match(
        sideDrawerGestureSource,
        /drawerSettleFrameRef\.current = window\.requestAnimationFrame\(\(\) => \{\s*drawerSettleFrameRef\.current = window\.requestAnimationFrame\(/,
    )
    // transform 终点与起点相同、WebView 丢事件、reduced-motion 压成 0ms 时都收不到 transitionend。
    assert.match(sideDrawerGestureSource, /drawerSettleTimerRef\.current = window\.setTimeout/)
    assert.match(sideDrawerGestureSource, /getMobileShellTransitionDurationMs\(\) \+ 1\d\d\)/)
})

test('降级态覆盖展开态，一个开合周期只在收起端切换一次', () => {
    const glassRule = mobileAppCss.match(
        /^\.mobile-app-side-drawer-shell\.is-drawer-dragging,\n[\s\S]*?\n\}/m,
    )?.[0] ?? ''
    for (const token of [
        '--mobile-nav-glass-filter',
        '--mobile-topbar-bg-filter',
        '--mobile-topbar-pill-filter',
        '--mobile-glass-filter',
        '--mobile-glass-filter-soft',
    ]) assert.match(glassRule, new RegExp(`${token}:\\s*none`))
    // 只降滤镜档：底色/渐变/边框/阴影不在降级态里改，静止态参数必须原样。
    assert.doesNotMatch(glassRule, /background|border|box-shadow|--mobile-nav-surface|--mobile-surface-/)

    // is-open 必须在列：少了它，抽屉停稳在完全展开处会多一次可见的材质跳变。
    assert.match(glassRule, /\.mobile-app-side-drawer-shell\.is-open \{/)
    assert.match(glassRule, /\.mobile-app-side-drawer-shell\.is-drawer-moving,/)

    assert.match(mobileAppSource, /sideDrawerMoving \? ' is-drawer-moving'/)
    // is-drawer-moving 必须早于 is-drawer-settling 结束，否则重建与拆除又落回同一帧。
    const finishBody = sideDrawerGestureSource.match(
        /const finishDrawerSettle = useCallback\([\s\S]*?\n {4}\}, \[/,
    )?.[0] ?? ''
    assert.match(finishBody, /setDrawerMoving\(false\)/)
    assert.ok(
        finishBody.indexOf('setDrawerMoving(false)') < finishBody.indexOf('requestAnimationFrame'),
        'setDrawerMoving(false) 必须在两帧空转之前，先于 setDrawerSettling(false) 生效',
    )
    assert.doesNotMatch(finishBody, /setDrawerSettling\(false\)[\s\S]*setDrawerMoving\(false\)/)
    // 关闭结算时 is-open 先摘、is-drawer-moving 同批补上，中间不能出现「已恢复」的空档。
    assert.match(
        sideDrawerGestureSource,
        /if \(hadMotion\) beginDrawerSettle\(stateChanged\)\n\s*setOpen\(nextOpen\)/,
    )
})
