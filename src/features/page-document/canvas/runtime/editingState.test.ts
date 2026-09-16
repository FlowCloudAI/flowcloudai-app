// 本测试固定运行时编辑权限只覆盖四类受管节点，并在每次渲染后从零重建。

import assert from 'node:assert/strict'
import test from 'node:test'
import {applyCanvasEditingState, CANVAS_EDITABLE_KINDS} from './editingState.ts'

class FakeElement {
    readonly attributes = new Map<string, string>()
    readonly kind: string
    readonly managed: boolean

    constructor(kind: string, managed = true) {
        this.kind = kind
        this.managed = managed
        if (managed) this.attributes.set('data-fc-node-id', 'node')
        this.attributes.set('data-fc-node-kind', kind)
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null
    }

    hasAttribute(name: string): boolean {
        return this.attributes.has(name)
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value)
    }

    removeAttribute(name: string): void {
        this.attributes.delete(name)
    }
}

function rootFor(elements: FakeElement[]): ParentNode {
    return {
        querySelectorAll(selector: string) {
            if (selector === '[data-fc-node-id][data-fc-node-kind]') {
                return elements.filter(element => element.managed)
            }
            return elements.filter(element =>
                element.hasAttribute('data-fc-canvas-editable') || element.hasAttribute('contenteditable'),
            )
        },
    } as unknown as ParentNode
}

test('可信编辑命令只给 paragraph、heading、list-item、table-cell 挂载运行时属性', () => {
    const elements = [
        ...CANVAS_EDITABLE_KINDS.map(kind => new FakeElement(kind)),
        new FakeElement('container'),
        new FakeElement('asset'),
    ]

    applyCanvasEditingState(rootFor(elements), true)

    for (const element of elements) {
        const editable = CANVAS_EDITABLE_KINDS.includes(element.kind as never)
        assert.equal(element.getAttribute('contenteditable'), editable ? 'plaintext-only' : null)
        assert.equal(element.hasAttribute('data-fc-canvas-editable'), editable)
    }
})

test('重新渲染后编辑属性施加到新节点且关闭命令会全部移除', () => {
    const first = new FakeElement('paragraph')
    applyCanvasEditingState(rootFor([first]), true)
    assert.equal(first.getAttribute('contenteditable'), 'plaintext-only')

    const second = new FakeElement('heading')
    applyCanvasEditingState(rootFor([second]), true)
    assert.equal(second.getAttribute('contenteditable'), 'plaintext-only')
    applyCanvasEditingState(rootFor([second]), false)
    assert.equal(second.getAttribute('contenteditable'), null)
    assert.equal(second.hasAttribute('data-fc-canvas-editable'), false)
})
