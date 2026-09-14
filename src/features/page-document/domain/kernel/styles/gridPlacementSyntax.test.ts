// 本测试固定 Grid 子项位置的等价写法、范围判断与序列化边界。
import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {
    gridItemPlacementFitsTracks,
    gridItemPlacementPropertiesOverlap,
    parseGridItemPlacementLonghands,
    parseGridItemPlacementShorthand,
    placementFromGridLineValues,
    serializeGridItemPlacement,
} from './gridPlacementSyntax.ts'

describe('gridPlacementSyntax', () => {
    it('把简写与长写投影到同一位置模型', () => {
        const shorthand = parseGridItemPlacementShorthand('2 / span 3')
        assert.ok(shorthand)
        assert.deepEqual(placementFromGridLineValues(...shorthand, '2 / span 3'), {
            mode: 'positioned',
            start: 2,
            span: 3,
        })
        assert.deepEqual(parseGridItemPlacementLonghands('2', 'span 3'), {
            mode: 'positioned',
            start: 2,
            span: 3,
        })
    })

    it('保留自动跨度并拒绝未接管的命名线', () => {
        assert.deepEqual(parseGridItemPlacementLonghands('auto', 'span 2'), {
            mode: 'auto',
            span: 2,
        })
        assert.equal(parseGridItemPlacementLonghands('main', null).mode, 'custom')
    })

    it('统一检查轨道范围并稳定序列化', () => {
        const value = {mode: 'positioned' as const, start: 2, span: 2}
        assert.equal(gridItemPlacementFitsTracks(value, 3), true)
        assert.equal(gridItemPlacementFitsTracks(value, 2), false)
        assert.equal(serializeGridItemPlacement(value), '2 / span 2')
        assert.equal(serializeGridItemPlacement({mode: 'auto', span: 1}), 'auto')
        assert.equal(serializeGridItemPlacement({mode: 'unset'}), null)
    })

    it('位置简写只与实际控制的行列分量重叠', () => {
        assert.equal(gridItemPlacementPropertiesOverlap('grid-area', 'grid-column-start'), true)
        assert.equal(gridItemPlacementPropertiesOverlap('grid-column', 'grid-row'), false)
        assert.equal(gridItemPlacementPropertiesOverlap('grid-row', 'grid-row-end'), true)
        assert.equal(gridItemPlacementPropertiesOverlap('grid-row-start', 'color'), false)
    })
})
