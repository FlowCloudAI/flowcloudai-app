// 本模块只为显式开关入口读取共享契约样例；探针构造逻辑位于可由 Node 测试复用的相邻纯模块。

import fixtureHtml from '../../../../../tests/fixtures/page-document/v1/entry/article.html?raw'
import fixtureCss from '../../../../../tests/fixtures/page-document/v1/entry/style.css?raw'
import projectHtml from '../../../../../tests/fixtures/page-document/v1/project/article.html?raw'
import projectCss from '../../../../../tests/fixtures/page-document/v1/project/style.css?raw'
import manifest from '../../../../../tests/fixtures/page-document/v1/manifest.json'
import maliciousFixture from '../../../../../tests/fixtures/page-document/v1/malicious-cases.json'
import {
    createCanvasProbeCases,
    type CanvasProbeCase,
    type CanvasProbeMutation,
} from './probeCases.ts'

export type {CanvasProbeCase} from './probeCases.ts'

export const CANVAS_PROBE_CASES: readonly CanvasProbeCase[] = createCanvasProbeCases({
    fixtureHtml,
    fixtureCss,
    assetIds: manifest.assets.map(asset => asset.id),
    maliciousCases: (maliciousFixture as {cases: CanvasProbeMutation[]}).cases,
})

export const CANVAS_PROBE_PROJECT = {
    html: projectHtml,
    css: projectCss,
    metadata: manifest.entry,
} as const
