import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {resolveAnchoredOverlayPosition} from '../../../../shared/ui/overlay/anchoredOverlayPosition.ts'

describe('颜色浮层锚定定位', () => {
    it('优先贴在触发按钮下方并对齐左边', () => {
        assert.deepEqual(resolveAnchoredOverlayPosition({
            anchor: {top: 40, right: 132, bottom: 72, left: 100},
            panelWidth: 224,
            panelHeight: 240,
            viewportWidth: 900,
            viewportHeight: 700,
            gap: 4,
            edge: 8,
        }), {
            top: 76,
            left: 100,
            maxWidth: 884,
            maxHeight: 616,
            side: 'bottom',
        })
    })

    it('下方空间不足时翻到上方并避免越过右边界', () => {
        assert.deepEqual(resolveAnchoredOverlayPosition({
            anchor: {top: 540, right: 892, bottom: 572, left: 860},
            panelWidth: 224,
            panelHeight: 240,
            viewportWidth: 900,
            viewportHeight: 600,
            gap: 4,
            edge: 8,
        }), {
            top: 296,
            left: 668,
            maxWidth: 884,
            maxHeight: 528,
            side: 'top',
        })
    })
})
