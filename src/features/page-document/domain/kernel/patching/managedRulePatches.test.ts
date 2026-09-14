// 本模块验证规范节点规则跨多个 fc-node layer 的精确更新、条件隔离与清除语义。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {parseSourceSnapshot, sourceKey, type SourceDocument} from '../contracts/index.ts'
import {applySourcePatches} from './sourcePatches.ts'
import {createManagedRulePropertyPatches} from './managedRulePatches.ts'

const NODE_ID = '22222222-2222-4222-8222-222222222222'
const SELECTOR = `[data-fc-node-id="${NODE_ID}"][data-fc-node-kind="container"]`

function document(content: string): SourceDocument {
    return Object.freeze({
        key: sourceKey('entry', 'style.css'),
        content,
        contentHash: 'fixture',
        persistentRevision: 4,
    })
}

function apply(
    input: SourceDocument,
    channel: Parameters<typeof createManagedRulePropertyPatches>[3],
    property: string,
    value: string | null,
): string {
    const planned = createManagedRulePropertyPatches(
        input,
        NODE_ID,
        'container',
        channel,
        property,
        value,
    )
    if (planned.status === 'unchanged') return input.content
    assert.equal(planned.status, 'ready')
    if (planned.status !== 'ready') return input.content
    const snapshot = parseSourceSnapshot({
        id: 'snapshot:managed-css',
        templateVersion: 1,
        documents: [input],
    })
    const result = applySourcePatches(snapshot, planned.patches)
    assert.notEqual(result.status, 'rejected')
    return result.snapshot.documents[0].content
}

describe('managed rule property patches', () => {
    for (const [label, channel] of [
        ['移动', {kind: 'base-rule'}],
        ['桌面', {kind: 'conditional-rule', context: 'desktop'}],
    ] as const) {
        it(`${label}档写入再删除规范受管规则后逐字恢复原文`, () => {
            const css = `/* before */
@layer fc-node {
  [data-fc-node-id="33333333-3333-4333-8333-333333333333"][data-fc-node-kind="container"] {
    color: red;
  }
}
/* after */`
            const written = apply(document(css), channel, 'gap', '12px')
            const removed = apply(document(written), channel, 'gap', null)

            assert.equal(removed, css)
        })
    }

    it('多个同名 layer 中只修改最后一个当前声明并保留其他源码', () => {
        const css = `@layer fc-node {
  ${SELECTOR} { gap: 8px; color: red; }
}
/* keep */
@layer fc-node {
  ${SELECTOR} { gap : 12px; }
}`
        const result = apply(document(css), {kind: 'base-rule'}, 'gap', '20px')

        assert.match(result, /gap: 8px; color: red/u)
        assert.match(result, /\/\* keep \*\//u)
        assert.match(result, /gap : 20px/u)
    })

    it('条件规则只写目标断点，连续修改复用同一规则', () => {
        const first = apply(
            document('@layer fc-node {\n}\n'),
            {kind: 'conditional-rule', context: 'desktop'},
            'gap',
            '12px',
        )
        const second = apply(
            document(first),
            {kind: 'conditional-rule', context: 'desktop'},
            'gap',
            '18px',
        )

        assert.equal((second.match(/@media/g) ?? []).length, 1)
        assert.equal((second.match(new RegExp(escapeRegExp(SELECTOR), 'g')) ?? []).length, 1)
        assert.match(second, /gap: 18px/u)
        assert.doesNotMatch(second, /gap: 12px/u)
    })

    it('后补基础值时写在条件规则之前，避免覆盖目标设备值', () => {
        const css = `@layer fc-node {
  @media (min-width: 48rem) {
    ${SELECTOR} { gap: 20px; }
  }
}`
        const result = apply(document(css), {kind: 'base-rule'}, 'gap', '12px')

        assert.ok(result.indexOf('gap: 12px') < result.indexOf('@media'))
        assert.ok(result.indexOf('@media') < result.indexOf('gap: 20px'))
    })

    it('更新位于条件规则后的基础声明时迁回条件规则之前', () => {
        const css = `@layer fc-node {
  @media (min-width: 48rem) {
    ${SELECTOR} { gap: 20px; }
  }
  ${SELECTOR} { gap: 8px; color: red; }
}`
        const result = apply(document(css), {kind: 'base-rule'}, 'gap', '12px')

        assert.ok(result.indexOf('gap: 12px') < result.indexOf('@media'))
        assert.doesNotMatch(result, /gap: 8px/u)
        assert.match(result, /color: red/u)
    })

    it('清除覆盖会移除同一上下文全部同名声明，但不碰简写和其他上下文', () => {
        const css = `@layer fc-node {
  ${SELECTOR} { gap: 8px; row-gap: 4px; }
  @media (hover: hover) {
    ${SELECTOR}:where(:hover) { gap: 20px; }
  }
}
@layer fc-node { ${SELECTOR} { gap: 12px; } }`
        const result = apply(document(css), {kind: 'base-rule'}, 'gap', null)

        assert.doesNotMatch(result, /gap: 8px/u)
        assert.doesNotMatch(result, /gap: 12px/u)
        assert.match(result, /row-gap: 4px/u)
        assert.match(result, /:where\(:hover\) \{ gap: 20px/u)
    })

    it('规则还有其他声明时只删除目标声明', () => {
        const css = `@layer fc-node {
  ${SELECTOR} {
    color: red;
    gap: 12px;
  }
}`
        const result = apply(document(css), {kind: 'base-rule'}, 'gap', null)

        assert.equal(
            result,
            `@layer fc-node {
  ${SELECTOR} {
    color: red;\n` +
                '    \n' +
                `  }
}`,
        )
    })

    it('规则含注释时保留规则与注释', () => {
        const css = `@layer fc-node {
  ${SELECTOR} {
    /* keep */
    gap: 12px;
  }
}`
        const result = apply(document(css), {kind: 'base-rule'}, 'gap', null)

        assert.match(result, new RegExp(`${escapeRegExp(SELECTOR)} \\{`, 'u'))
        assert.match(result, /\/\* keep \*\//u)
        assert.doesNotMatch(result, /gap:/u)
    })

    it('共享选择器不属于规范受管规则，删除请求保持原文', () => {
        const css = `@layer fc-node {
  ${SELECTOR}, [data-fc-node-kind="container"] { gap: 12px; }
}`

        assert.equal(apply(document(css), {kind: 'base-rule'}, 'gap', null), css)
    })

    it('媒体块内还有其他节点规则时只删除目标规则并保留媒体块', () => {
        const otherSelector =
            '[data-fc-node-id="33333333-3333-4333-8333-333333333333"][data-fc-node-kind="container"]'
        const css = `@layer fc-node {
  @media (min-width: 48rem) {
    ${SELECTOR} { gap: 12px; }
    ${otherSelector} { color: red; }
  }
}`
        const result = apply(
            document(css),
            {kind: 'conditional-rule', context: 'desktop'},
            'gap',
            null,
        )

        assert.match(result, /@media \(min-width: 48rem\)/u)
        assert.doesNotMatch(result, new RegExp(escapeRegExp(SELECTOR), 'u'))
        assert.match(result, new RegExp(escapeRegExp(otherSelector), 'u'))
        assert.match(result, /color: red/u)
    })

    for (const [channelLabel, channel] of [
        ['移动', {kind: 'base-rule'}],
        ['桌面', {kind: 'conditional-rule', context: 'desktop'}],
    ] as const) {
        for (const [sourceLabel, css] of [
            ['空文件', ''],
            ['无结尾换行的作者注释', '/* author */'],
            ['以 LF 结尾的作者注释', '/* author */\n'],
            ['以 LF 结尾的普通规则', 'a { color: red; }\n'],
            ['以双 LF 结尾的普通规则', 'a { color: red; }\n\n'],
            ['以 CRLF 结尾的作者注释', '/* author */\r\n'],
            ['紧凑空 layer', '@layer fc-node {}\n'],
            ['含空行的空 layer', '@layer fc-node {\n\n}\n'],
            ['标准空 layer', '@layer fc-node {\n}\n'],
            ['含注释的 layer', '@layer fc-node {\n  /* keep */\n}\n'],
            ['含其他规则和结尾空行的 layer', '@layer fc-node {\n  .x { color: red; }\n\n}\n'],
            [
                '含条件块和结尾空行的 layer',
                '@layer fc-node {\n  @media (min-width: 48rem) {\n    .x { color: red; }\n\n  }\n}\n',
            ],
        ] as const) {
            it(`${sourceLabel}在${channelLabel}写入再删除时逐字恢复`, () => {
                const written = apply(document(css), channel, 'display', 'grid')
                const removed = apply(document(written), channel, 'display', null)

                assert.equal(removed, css)
            })
        }
    }

    it('没有 fc-node layer 时创建规范规则，重复相同值不再增长源码', () => {
        const first = apply(document('/* author */'), {kind: 'base-rule'}, 'display', 'grid')
        const second = apply(document(first), {kind: 'base-rule'}, 'display', 'grid')

        assert.equal(second, first)
        assert.match(second, /@layer fc-node/u)
        assert.match(second, /display: grid/u)
    })

    it('同值目的地被后续规则覆盖时可移到受管层末尾重新确立级联', () => {
        const css = `@layer fc-node {
  @media (min-width: 48rem) {
    ${SELECTOR} { gap: 20px; }
  }
  @media (max-width: 47.99rem) {
    ${SELECTOR} { gap: 3rem; }
  }
}`
        const input = document(css)
        const planned = createManagedRulePropertyPatches(
            input,
            NODE_ID,
            'container',
            {kind: 'conditional-rule', context: 'desktop'},
            'gap',
            '20px',
            null,
            {forceWinningWrite: true},
        )
        assert.equal(planned.status, 'ready')
        if (planned.status !== 'ready') return
        const applied = applySourcePatches(
            parseSourceSnapshot({
                id: 'snapshot:force-winning-rule',
                templateVersion: 1,
                documents: [input],
            }),
            planned.patches,
        )
        assert.equal(applied.status, 'applied')
        const result = applied.snapshot.documents[0].content
        assert.equal((result.match(/gap: 20px/g) ?? []).length, 1)
        assert.ok(result.lastIndexOf('gap: 20px') > result.indexOf('gap: 3rem'))
    })

    it('内部图片规则使用稳定语义选择器并可重复精确更新', () => {
        const first = createManagedRulePropertyPatches(
            document('@layer fc-node {\n}\n'),
            NODE_ID,
            'asset',
            {kind: 'base-rule'},
            'object-fit',
            'contain',
            'asset-image',
        )
        assert.equal(first.status, 'ready')
        if (first.status !== 'ready') return
        const snapshot = parseSourceSnapshot({
            id: 'snapshot:semantic-rule',
            templateVersion: 1,
            documents: [document('@layer fc-node {\n}\n')],
        })
        const applied = applySourcePatches(snapshot, first.patches)
        assert.equal(applied.status, 'applied')
        const css = applied.snapshot.documents[0].content
        assert.match(css, /\[data-fc-node-kind="asset"\]:is\(img\),/u)
        assert.match(css, /\[data-fc-node-kind="asset"\] img \{\s*object-fit: contain;/u)

        const second = createManagedRulePropertyPatches(
            document(css),
            NODE_ID,
            'asset',
            {kind: 'base-rule'},
            'object-fit',
            'cover',
            'asset-image',
        )
        assert.equal(second.status, 'ready')
        if (second.status !== 'ready') return
        const updated = applySourcePatches(
            parseSourceSnapshot({
                id: 'snapshot:semantic-rule-update',
                templateVersion: 1,
                documents: [document(css)],
            }),
            second.patches,
        )
        assert.equal(updated.status, 'applied')
        assert.match(updated.snapshot.documents[0].content, /object-fit: cover/u)
        assert.equal((updated.snapshot.documents[0].content.match(/object-fit/g) ?? []).length, 1)
    })
})

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
