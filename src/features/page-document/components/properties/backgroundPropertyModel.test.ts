import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {
    parseControlledBackgroundGradient,
    serializeControlledBackgroundGradient,
} from './backgroundPropertyModel.ts'

describe('background property model', () => {
    it('受控线性渐变可按角度与两个色标往返', () => {
        const value = {
            angle: 135 as const,
            start: 'var(--fc-entry-accent)' as const,
            end: 'transparent' as const,
        }
        const serialized = serializeControlledBackgroundGradient(value)

        assert.equal(serialized, 'linear-gradient(135deg, var(--fc-entry-accent), transparent)')
        assert.deepEqual(parseControlledBackgroundGradient(serialized), value)
    })

    it('任意角度、任意颜色和其他背景函数不进入结构化渐变控件', () => {
        assert.equal(parseControlledBackgroundGradient('linear-gradient(12deg, red, blue)'), null)
        assert.equal(parseControlledBackgroundGradient('radial-gradient(red, blue)'), null)
        assert.throws(() => serializeControlledBackgroundGradient({
            angle: 12,
            start: 'red',
            end: 'blue',
        } as never), /受控范围/u)
    })
})
