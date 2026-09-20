// 这些测试固定数值控件的步进、单位、快捷值与超范围显示，不涉及 React 或 DOM。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {
    authorNumericUnitLabel,
    authorNumericUnitTitle,
    changeNumericPropertyUnit,
    matchingNumericPropertyPreset,
    numericPropertyDefinition,
    numericSliderDisplayValue,
    stepNumericPropertyValue,
} from './numericPropertyModel.ts'

describe('页面属性数值模型', () => {
    it('单位只向作者显示名称并保留 CSS 单位说明', () => {
        assert.equal(authorNumericUnitLabel('px'), '像素')
        assert.equal(authorNumericUnitLabel('em'), '字')
        assert.equal(authorNumericUnitLabel('rem'), '标准字')
        assert.equal(authorNumericUnitLabel(''), '倍数')
        assert.match(authorNumericUnitTitle('px'), /px/u)
    })
    it('按当前单位步进并守住非负语义边界', () => {
        const definition = numericPropertyDefinition('padding-block-start')
        assert.ok(definition)
        const zero = {kind: 'numeric' as const, value: 0, unit: 'rem' as const, numberText: '0'}
        assert.deepEqual(stepNumericPropertyValue(zero, -1, definition), zero)
        assert.equal(stepNumericPropertyValue(zero, 1, definition).value, 0.125)
    })

    it('单位切换保留数值且拒绝属性白名单外单位', () => {
        const definition = numericPropertyDefinition('font-size')
        assert.ok(definition)
        const value = {kind: 'numeric' as const, value: 16, unit: 'px' as const, numberText: '16'}
        assert.deepEqual(changeNumericPropertyUnit(value, 'rem', definition), {...value, unit: 'rem'})
        assert.throws(() => changeNumericPropertyUnit(value, '', definition), /白名单/u)
    })

    it('快捷值按数值与单位共同匹配', () => {
        const definition = numericPropertyDefinition('font-size')
        assert.ok(definition)
        assert.equal(matchingNumericPropertyPreset(definition.presets, {value: 16, unit: 'px'})?.label, '正文')
        assert.equal(matchingNumericPropertyPreset(definition.presets, {value: 16, unit: 'rem'}), null)
    })

    it('超出滑杆常用范围的已有值只钳制显示位置', () => {
        const definition = numericPropertyDefinition('font-size')
        assert.ok(definition)
        const range = definition.sliderRange('px')
        assert.equal(numericSliderDisplayValue(range, 144), 96)
        assert.equal(numericSliderDisplayValue(range, -4), 6)
    })
})
