// 本测试固定内核 Grid 轨道语法的可编辑子集、局部写回和未知源码保留边界。
import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {
    createFractionGridTrack,
    gridNamedLineNames,
    insertGridTrackAt,
    parseGridTrackList,
    removeGridTrackAt,
    replaceAdaptiveGridRepeatMode,
    replaceGridTrackAt,
    serializeGridTrackSize,
    setGridNamedLineNames,
} from './gridTrackSyntax.ts'

describe('gridTrackModel', () => {
    it('读取固定、比例、内容与有限 minmax 轨道', () => {
        const model = parseGridTrackList('12rem minmax(0, 2.3fr) auto 25%')

        assert.equal(model.status, 'explicit')
        assert.equal(model.canResize, true)
        assert.equal(model.canRestructure, true)
        assert.deepEqual(
            model.tracks.map(track => track.size.kind),
            ['length', 'minmax', 'keyword', 'length'],
        )
        assert.deepEqual(model.tracks[0].size, {
            kind: 'length',
            value: 12,
            unit: 'rem',
            numberText: '12',
        })
        assert.deepEqual(model.tracks[1].size, {
            kind: 'minmax',
            minimum: {kind: 'zero', numberText: '0'},
            maximum: {kind: 'fraction', value: 2.3, numberText: '2.3'},
        })
    })

    it('区分裸 fr 与零最小尺寸比例轨道', () => {
        const model = parseGridTrackList('1fr minmax(0, 1fr)')

        assert.equal(model.tracks[0].size.kind, 'fraction')
        assert.equal(model.tracks[1].size.kind, 'minmax')
        assert.equal(model.tracks[0].raw, '1fr')
        assert.equal(model.tracks[1].raw, 'minmax(0, 1fr)')
        const created = createFractionGridTrack(2.3)
        assert.notEqual(created.kind, 'custom')
        if (created.kind === 'custom') return
        assert.equal(serializeGridTrackSize(created), 'minmax(0, 2.3fr)')
    })

    it('展开固定 repeat 并只展开被修改的 repeat 片段', () => {
        const model = parseGridTrackList('12rem  repeat(2, minmax(0, 1fr) auto)  20px')
        assert.equal(model.tracks.length, 6)
        assert.equal(model.canRestructure, true)

        const changed = replaceGridTrackAt(model, 3, {
            kind: 'fraction',
            value: 2,
            numberText: '2',
        })
        assert.equal(changed, '12rem  minmax(0, 1fr) auto 2fr auto  20px')
    })

    it('回读多名称命名线，并只修改目标边界或轨道尺寸', () => {
        const model = parseGridTrackList('[main] 1fr [aside content] 2fr [end]')
        assert.equal(model.hasNamedLines, true)
        assert.equal(model.canEditNamedLines, true)
        assert.equal(model.canResize, true)
        assert.equal(model.canRestructure, false)
        assert.deepEqual(gridNamedLineNames(model, 1), ['aside', 'content'])

        const changed = replaceGridTrackAt(model, 1, {
            kind: 'fraction',
            value: 3,
            numberText: '3',
        })
        assert.equal(changed, '[main] 1fr [aside content] 3fr [end]')
        assert.equal(
            setGridNamedLineNames(model, 1, ['body', 'rail']),
            '[main] 1fr [body rail] 2fr [end]',
        )
        assert.equal(setGridNamedLineNames(model, 0, []), ' 1fr [aside content] 2fr [end]')
        assert.equal(
            setGridNamedLineNames(model, 2, ['finish']),
            '[main] 1fr [aside content] 2fr [finish]',
        )
    })

    it('可为普通显式轨道增加命名线，并保留复杂命名源码', () => {
        const plain = parseGridTrackList('1fr 2fr')
        assert.equal(setGridNamedLineNames(plain, 1, ['aside']), '1fr [aside] 2fr')

        const escaped = parseGridTrackList('[main\\ start] 1fr')
        assert.equal(escaped.hasNamedLines, true)
        assert.equal(escaped.canEditNamedLines, false)
        assert.match(escaped.reason ?? '', /暂由源码维护/u)
    })

    it('只禁用未知轨道，并把单模板自适应 repeat 作为动态数量编辑', () => {
        const mixed = parseGridTrackList('1fr fit-content(20rem) auto')
        assert.equal(mixed.status, 'explicit')
        assert.equal(mixed.canResize, true)
        assert.equal(mixed.canRestructure, false)
        assert.equal(mixed.tracks[1].editable, false)
        assert.match(mixed.tracks[1].reason ?? '', /轨道函数/u)

        const adaptive = parseGridTrackList('repeat(auto-fit, minmax(12rem, 1fr))')
        assert.equal(adaptive.status, 'explicit')
        assert.equal(adaptive.adaptiveRepeat?.mode, 'auto-fit')
        assert.equal(adaptive.fixedTrackCount, null)
        assert.equal(adaptive.tracks[0].editable, true)
        assert.equal(adaptive.canResize, false)
        assert.equal(adaptive.canRestructure, false)
        assert.match(adaptive.reason ?? '', /浏览器/u)
        assert.equal(
            replaceGridTrackAt(adaptive, 0, {
                kind: 'minmax',
                minimum: {kind: 'length', value: 16, unit: 'rem', numberText: '16'},
                maximum: {kind: 'fraction', value: 1, numberText: '1'},
            }),
            'repeat(auto-fit, minmax(16rem, 1fr))',
        )
        assert.equal(
            replaceAdaptiveGridRepeatMode(adaptive, 'auto-fill'),
            'repeat(auto-fill, minmax(12rem, 1fr))',
        )

        const multiTemplate = parseGridTrackList('repeat(auto-fill, 1fr 2fr)')
        assert.equal(multiTemplate.tracks[0].editable, false)
        assert.match(multiTemplate.reason ?? '', /一个/u)

        const flexibleOnly = parseGridTrackList('repeat(auto-fit, 1fr)')
        assert.equal(flexibleOnly.tracks[0].editable, false)
        assert.match(flexibleOnly.reason ?? '', /固定尺寸边界/u)
    })

    it('限制展开轨道数量并拒绝无效比例', () => {
        const tooMany = parseGridTrackList('repeat(13, 1fr)')
        assert.equal(tooMany.canResize, false)
        assert.equal(tooMany.canRestructure, false)
        assert.match(tooMany.reason ?? '', /12/u)

        const invalid = parseGridTrackList('-1fr minmax(1fr, 2fr)')
        assert.equal(
            invalid.tracks.every(track => !track.editable),
            true,
        )
    })

    it('只在声明可安全重组时增删轨道，并限制至少保留一条', () => {
        const model = parseGridTrackList('repeat(2, minmax(0, 1fr)) auto')
        const fixed = {
            kind: 'length' as const,
            value: 12,
            unit: 'rem' as const,
            numberText: '12',
        }

        assert.equal(insertGridTrackAt(model, 1, fixed), 'minmax(0, 1fr) 12rem minmax(0, 1fr) auto')
        assert.equal(removeGridTrackAt(model, 1), 'minmax(0, 1fr) auto')
        assert.equal(removeGridTrackAt(parseGridTrackList('1fr'), 0), null)
        assert.equal(insertGridTrackAt(parseGridTrackList('[main] 1fr'), 1, fixed), null)
        assert.equal(removeGridTrackAt(parseGridTrackList('1fr fit-content(20rem)'), 0), null)
    })

    it('从未设置或 none 新建首条轨道，但不突破每轴上限', () => {
        const fraction = createFractionGridTrack(1)
        assert.notEqual(fraction.kind, 'custom')
        if (fraction.kind === 'custom') return
        assert.equal(insertGridTrackAt(parseGridTrackList(null), 0, fraction), 'minmax(0, 1fr)')
        assert.equal(insertGridTrackAt(parseGridTrackList('none'), 0, fraction), 'minmax(0, 1fr)')
        assert.equal(insertGridTrackAt(parseGridTrackList('repeat(12, 1fr)'), 12, fraction), null)
    })

    it('区分未设置、none 与源码关键字', () => {
        assert.equal(parseGridTrackList(undefined).status, 'absent')
        assert.equal(parseGridTrackList(' none ').status, 'none')
        const cssWide = parseGridTrackList('revert-layer')
        assert.equal(cssWide.status, 'custom')
        assert.match(cssWide.reason ?? '', /源码维护/u)
        const subgrid = parseGridTrackList('subgrid [content-start] [content-end]')
        assert.equal(subgrid.status, 'custom')
        assert.equal(subgrid.fixedTrackCount, null)
        assert.match(subgrid.reason ?? '', /父网格轨道.*跨度.*命名线/u)
    })
})
