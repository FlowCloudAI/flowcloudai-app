import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {URL} from 'node:url'

import {getMobilePageTransitionLayers} from './mobilePageTransition.ts'

const mobileAppCss = readFileSync(new URL('./MobileApp.css', import.meta.url), 'utf8')
const mobileAppSource = readFileSync(new URL('./MobileApp.tsx', import.meta.url), 'utf8')
const transitionHostSource = readFileSync(new URL('./MobilePageTransitionHost.tsx', import.meta.url), 'utf8')
const sideDrawerGestureSource = readFileSync(new URL('./useMobileSideDrawerGesture.ts', import.meta.url), 'utf8')

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

test('直接前驱保持可绘制但不可交互，手势开始不再从 visibility hidden 冷启动', () => {
    const baseLayerRule = mobileAppCss.match(/\.mobile-page-transition-host__layer\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
    assert.match(baseLayerRule, /visibility:\s*visible/)
    assert.doesNotMatch(baseLayerRule, /^\s*visibility:\s*hidden/m)
    assert.match(transitionHostSource, /inert=\{!layerInteractive\}/)
    assert.match(mobileAppCss, /\.mobile-page-transition-host__layer\.is-underlay\s*\{[\s\S]*?z-index:\s*1/)
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
