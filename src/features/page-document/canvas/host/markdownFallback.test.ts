// 这些测试固定旧 Markdown 降级时的分段、换行和 HTML 转义边界。

import assert from 'node:assert/strict'
import test from 'node:test'
import {markdownParagraphsToHtml} from './markdownFallback.ts'

test('Markdown 正文按空行分段并保留段内换行', () => {
    assert.equal(
        markdownParagraphsToHtml('第一行\r\n第二行\r\n \r\n第三段'),
        '<p>第一行<br>第二行</p>\n<p>第三段</p>',
    )
})

test('Markdown 降级只显示原文并转义全部 HTML 边界字符', () => {
    assert.equal(
        markdownParagraphsToHtml('# 标题 <img onerror="x"> & \'引号\''),
        '<p># 标题 &lt;img onerror=&quot;x&quot;&gt; &amp; &#39;引号&#39;</p>',
    )
    assert.equal(markdownParagraphsToHtml(' \n\n '), '')
})
