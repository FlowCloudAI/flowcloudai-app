// 这些测试锁定 UTF-8 字节下标、字符边界、原始换行与跨文件整批前置检查。
import assert from 'node:assert/strict'
import test from 'node:test'
import type {SourceEdit, SourceFileSet} from './contract.ts'
import {applySourceEdits, SourceEditError} from './sourceEdits.ts'

function sources(articleHtml: string, styleCss = ''): SourceFileSet {
    return {'article.html': articleHtml, 'style.css': styleCss}
}

test('UTF-8 字节区间可精确替换 emoji', () => {
    const original = sources('A😀B')
    const result = applySourceEdits(original, [
        {
            file: 'article.html',
            from: 1,
            to: 5,
            expected: '😀',
            insert: '🌊',
        },
    ])

    assert.equal(original['article.html'], 'A😀B')
    assert.equal(result.sources['article.html'], 'A🌊B')
    assert.deepEqual(result.changedFiles, ['article.html'])
})

test('区间编辑保留 CRLF、注释与所有无关源码字节', () => {
    const original = sources('<p>旧值</p>\r\n<!-- keep -->\r\n')
    const result = applySourceEdits(original, [
        {
            file: 'article.html',
            from: 3,
            to: 9,
            expected: '旧值',
            insert: '新值',
        },
    ])

    assert.equal(result.sources['article.html'], '<p>新值</p>\r\n<!-- keep -->\r\n')
})

test('同文件多项编辑基于原始源码检查并按位置倒序应用', () => {
    const result = applySourceEdits(sources('甲乙丙丁'), [
        {file: 'article.html', from: 0, to: 3, expected: '甲', insert: '一'},
        {file: 'article.html', from: 9, to: 12, expected: '丁', insert: '四'},
    ])

    assert.equal(result.sources['article.html'], '一乙丙四')
})

test('expected 不匹配时拒绝整批修改并报告原始 edit 下标', () => {
    const original = sources('<p>正文</p>', '.entry { color: red; }')
    const edits: SourceEdit[] = [
        {file: 'article.html', from: 3, to: 9, expected: '正文', insert: '内容'},
        {file: 'style.css', from: 16, to: 19, expected: 'blue', insert: 'green'},
    ]

    assert.throws(
        () => applySourceEdits(original, edits),
        (error: unknown) => {
            assert.ok(error instanceof SourceEditError)
            assert.equal(error.code, 'source_precondition_failed')
            assert.equal(error.file, 'style.css')
            assert.equal(error.editIndex, 1)
            return true
        },
    )
    assert.deepEqual(original, sources('<p>正文</p>', '.entry { color: red; }'))
})

test('重叠区间与同一位置的多个插入均被拒绝', () => {
    const original = sources('abcdef')
    const overlapping: SourceEdit[] = [
        {file: 'article.html', from: 1, to: 4, expected: 'bcd', insert: 'B'},
        {file: 'article.html', from: 3, to: 5, expected: 'de', insert: 'D'},
    ]
    assert.throws(
        () => applySourceEdits(original, overlapping),
        (error: unknown) =>
            error instanceof SourceEditError && error.code === 'overlapping_source_edits',
    )

    const samePosition: SourceEdit[] = [
        {file: 'article.html', from: 2, to: 2, expected: '', insert: 'X'},
        {file: 'article.html', from: 2, to: 2, expected: '', insert: 'Y'},
    ]
    assert.throws(
        () => applySourceEdits(original, samePosition),
        (error: unknown) =>
            error instanceof SourceEditError && error.code === 'overlapping_source_edits',
    )
})

test('UTF-8 区间不得落在多字节字符内部', () => {
    assert.throws(
        () =>
            applySourceEdits(sources('A😀B'), [
                {
                    file: 'article.html',
                    from: 2,
                    to: 5,
                    expected: '😀',
                    insert: 'X',
                },
            ]),
        (error: unknown) =>
            error instanceof SourceEditError && error.code === 'invalid_source_range',
    )
})

test('HTML 与 CSS 可在一次调用中生成同一个原子结果', () => {
    const result = applySourceEdits(sources('<p>雾港</p>', '.entry { color: red; }'), [
        {file: 'article.html', from: 3, to: 9, expected: '雾港', insert: '潮港'},
        {file: 'style.css', from: 16, to: 19, expected: 'red', insert: 'blue'},
    ])

    assert.deepEqual(result.sources, sources('<p>潮港</p>', '.entry { color: blue; }'))
    assert.deepEqual(result.changedFiles, ['article.html', 'style.css'])
})
