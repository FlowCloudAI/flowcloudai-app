// 这些测试从共享样例驱动作者链接白名单，防止前端内核与生产侧 Rust 重校验再次漂移。
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'
import {validateAuthorHref} from './hrefPolicy.ts'

interface HrefCases {
    accepted: string[]
    rejected: string[]
}

const FIXTURE_PATH = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../../../tests/fixtures/page-document/v1/href-cases.json',
)
const CASES = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as HrefCases

test('共享 href 样例与作者链接白名单一致', () => {
    for (const href of CASES.accepted) {
        assert.deepEqual(validateAuthorHref(href), {allowed: true}, `应接受 ${JSON.stringify(href)}`)
    }
    for (const href of CASES.rejected) {
        assert.equal(
            validateAuthorHref(href).allowed,
            false,
            `应拒绝 ${JSON.stringify(href)}`,
        )
    }
})
