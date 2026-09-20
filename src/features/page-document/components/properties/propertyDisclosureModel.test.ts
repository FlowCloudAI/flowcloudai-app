// 本测试锁定属性分组只因当前档位的作者值而默认展开，不把继承值误算为已设置。

import assert from 'node:assert/strict'
import test from 'node:test'
import type {VisualPropertyState} from '../../application/visualPropertyEditing.ts'
import {propertyDisclosurePresentation} from './propertyDisclosureModel.ts'

function field(overrides: Partial<VisualPropertyState> = {}): VisualPropertyState {
    return {
        property: 'font-size',
        label: '字号',
        group: 'text',
        value: '16px',
        localValue: null,
        sourceState: 'inherited',
        statusText: '继承',
        clearTitle: '清除后继承上层作者样式。',
        disabled: false,
        reason: null,
        ...overrides,
    }
}

test('属性折叠段只在当前段存在作者值时默认展开并显示已设置数量', () => {
    const inherited = propertyDisclosurePresentation([field()], ['font-size'])
    assert.deepEqual(inherited, {
        authorValueCount: 0,
        defaultOpen: false,
        summary: '使用继承或默认设置',
    })

    const authored = propertyDisclosurePresentation([
        field({localValue: '18px', sourceState: 'local'}),
        field({property: 'font-weight', localValue: '700', sourceState: 'local'}),
        field({property: 'line-height'}),
    ], ['font-size', 'font-weight', 'line-height'])
    assert.deepEqual(authored, {
        authorValueCount: 2,
        defaultOpen: true,
        summary: '已设置 2 项',
    })
})
