import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {URL} from 'node:url'

import {getMobilePageTransitionLayers} from './mobilePageTransition.ts'

const mobileAppCss = readFileSync(new URL('./MobileApp.css', import.meta.url), 'utf8')
const mobileAppSource = readFileSync(new URL('./MobileApp.tsx', import.meta.url), 'utf8')
const transitionHostSource = readFileSync(new URL('./MobilePageTransitionHost.tsx', import.meta.url), 'utf8')
const sideDrawerGestureSource = readFileSync(new URL('./useMobileSideDrawerGesture.ts', import.meta.url), 'utf8')
const glassEffectCss = readFileSync(new URL('../../glassEffect.css', import.meta.url), 'utf8')

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
    assert.match(sideDrawerGestureSource, /if \(hadMotion\) beginDrawerSettle\(\)/)
    // transitionend 之后再空转两帧，保证静止画面已经真正绘制过才拆几何。
    assert.match(
        sideDrawerGestureSource,
        /drawerSettleFrameRef\.current = window\.requestAnimationFrame\(\(\) => \{\s*drawerSettleFrameRef\.current = window\.requestAnimationFrame\(/,
    )
    // transform 终点与起点相同、WebView 丢事件、reduced-motion 压成 0ms 时都收不到 transitionend。
    assert.match(sideDrawerGestureSource, /drawerSettleTimerRef\.current = window\.setTimeout/)
    assert.match(sideDrawerGestureSource, /getMobileShellTransitionDurationMs\(\) \+ 1\d\d\)/)
})

test('运动期间连滤镜带半透明一起降级，复用关闭态那份清单', () => {
    const degradeRule = glassEffectCss.match(
        /^:root:not\(\[data-glass-effect="enabled"\]\),[\s\S]*?\n\}/m,
    )?.[0] ?? ''
    // 两个触发点必须共用同一条规则，否则新增玻璃面会漏登记其中一个。
    assert.match(degradeRule, /\.mobile-app-side-drawer-shell\.is-drawer-dragging,/)
    assert.match(degradeRule, /\.mobile-app-side-drawer-shell\.is-drawer-moving \{/)
    // 滤镜档
    for (const token of ['--mobile-glass-filter', '--mobile-glass-filter-soft',
        '--mobile-nav-glass-filter', '--mobile-topbar-bg-filter', '--mobile-topbar-pill-filter']) {
        assert.match(degradeRule, new RegExp(`${token}:\\s*none`))
    }
    // 底色档：只摘滤镜会让背景从模糊跳成清晰，半透明必须同时换成不透明。
    for (const token of ['--mobile-surface-glass', '--mobile-surface-panel', '--mobile-surface-dialog',
        '--mobile-surface-control', '--mobile-surface-menu', '--mobile-surface-translucent',
        '--mobile-surface-translucent-strong', '--mobile-nav-surface', '--mobile-topbar-pill-background']) {
        assert.match(degradeRule, new RegExp(`${token}:\\s*var\\(--fc-color-`))
    }
    // 降级值只有这一处，MobileApp.css 不得再写一份平行清单。
    assert.doesNotMatch(mobileAppCss, /--mobile-nav-glass-filter\s*:/)

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
})
