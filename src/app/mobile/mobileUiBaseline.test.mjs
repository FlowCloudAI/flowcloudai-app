/* designs/mobile-ui-baseline.md §13 中可机器检查红线的静态回归。 */

import assert from 'node:assert/strict'
import {readFileSync, readdirSync} from 'node:fs'
import {extname, join} from 'node:path'
import {fileURLToPath, URL} from 'node:url'
import test from 'node:test'

const mobileRoot = fileURLToPath(new URL('./', import.meta.url))
const tokenFile = join(mobileRoot, 'mobileTokens.css')
const mobileAppCss = readFileSync(join(mobileRoot, 'MobileApp.css'), 'utf8')

function collectFiles(root, extension) {
    return readdirSync(root, {withFileTypes: true}).flatMap(entry => {
        const path = join(root, entry.name)
        if (entry.isDirectory()) return collectFiles(path, extension)
        return extname(entry.name) === extension ? [path] : []
    })
}

const businessCssFiles = collectFiles(mobileRoot, '.css').filter(path => path !== tokenFile)
const pageTsxFiles = collectFiles(join(mobileRoot, 'pages'), '.tsx')
const businessCss = businessCssFiles.map(path => ({path, source: readFileSync(path, 'utf8')}))
const mobileTsxSource = collectFiles(mobileRoot, '.tsx')
    .map(path => readFileSync(path, 'utf8'))
    .join('\n')

function assertNoMatch(pattern, label) {
    const violations = businessCss.flatMap(({path, source}) => {
        pattern.lastIndex = 0
        return pattern.test(source) ? [path.replace(`${mobileRoot}/`, '')] : []
    })
    assert.deepEqual(violations, [], `${label}: ${violations.join(', ')}`)
}

function assertDeclarations(propertyPattern, label, isAllowed) {
    const declarationPattern = new RegExp(`(?:${propertyPattern})\\s*:\\s*([^;{}]+);`, 'g')
    const violations = businessCss.flatMap(({path, source}) => {
        const invalidValues = [...source.matchAll(declarationPattern)]
            .map(match => match[1].trim())
            .filter(value => !isAllowed(value))
        return invalidValues.map(value => `${path.replace(`${mobileRoot}/`, '')}: ${value}`)
    })
    assert.deepEqual(violations, [], `${label}: ${violations.join(', ')}`)
}

test('业务 CSS 不出现颜色字面量、原始色板或裸安全区', () => {
    assertNoMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g, '颜色字面量')
    assertNoMatch(/var\(--fc-(?:gray|blue|red|green|yellow|orange|purple|pink)-/g, '原始色板')
    assertNoMatch(/env\(safe-area-inset-/g, '裸安全区')
})

test('废止 token、裸大 z-index 与第三档阴影保持为零', () => {
    assertNoMatch(/--mobile-(?:font-weight-(?:label|strong|heading|display)|border-(?:soft|medium|strong|emphasis|bold)|shadow-[a-z-]+)/g, '废止 token')
    assertNoMatch(/z-index\s*:\s*(?:-\d+|[3-9]|\d{2,})\s*;/g, '裸 z-index')
    assertDeclarations('box-shadow', '非标准阴影', value => (
        /^none(?:\s*!important)?$/.test(value)
        || /^var\(--mobile-elevation-(?:raised|floating)\)$/.test(value)
    ))
    assertNoMatch(/--mobile-inset-highlight|var\(--fc-shadow-/g, '旧阴影来源')
    assertNoMatch(/border-radius\s*:\s*(?!0(?:\s+0){0,3}\s*;)[^;{}]*(?:[1-9]|%)/g, '裸圆角')
    assertNoMatch(/var\(--fc-radius-(?!full\))[^)]+\)/g, '业务层直接消费基础圆角')
})

test('动效、排版与间距只消费移动语义 token', () => {
    assertDeclarations('(?:transition|animation)(?:-[a-z-]+)?', '裸动效', value => {
        const withoutTokens = value.replace(/var\([^)]*\)/g, '')
        return !/\d+(?:ms|s)|cubic-bezier\(|\bease(?:-in|-out|-in-out)?\b/.test(withoutTokens)
    })
    assertNoMatch(/(?:padding|margin|gap)(?:-[a-z]+)?\s*:[^;{}]*[0-9]*\.[0-9]+rem/g, '网格外间距')
    assertNoMatch(/(?:padding|margin|gap)(?:-[a-z]+)?\s*:[^;{}]*\b[1-9]\d*px\b/g, '裸像素间距')
    assertNoMatch(/var\(--fc-space-[^)]+\)/g, '业务层直接消费 L0 间距')
    assertNoMatch(/margin(?:-[a-z]+)?\s*:[^;{}]*(?:-\d|calc\([^)]*\*\s*-1)/g, '负边距')
    assertDeclarations('font-size', '第六档字号', value => (
        /^var\(--mobile-(?:text-(?:meta|body-sm|body|title|display)|decorative-mark-size)\)(?:\s*!important)?$/.test(value)
    ))
    assertDeclarations('line-height', '非标准行高', value => (
        /^(?:var\(--mobile-leading-(?:tight|snug|normal)\)|inherit)(?:\s*!important)?$/.test(value)
    ))
})

test('常态移动界面不使用虚线边框', () => {
    assertNoMatch(/border(?:-[a-z]+)?(?:-style)?\s*:[^;{}]*\bdashed\b/g, '虚线边框')
})

test('移动页面文件不超过 800 行', () => {
    const oversized = pageTsxFiles.flatMap(path => {
        const lines = readFileSync(path, 'utf8').split(/\r?\n/).length
        return lines > 800 ? [`${path.replace(`${mobileRoot}/`, '')}: ${lines}`] : []
    })
    assert.deepEqual(oversized, [], oversized.join(', '))
})

test('所有动效都有减少动态效果降级', () => {
    const missingFallback = businessCss.flatMap(({path, source}) => {
        const hasMotion = /(?:transition|animation)(?:-[a-z-]+)?\s*:\s*(?!none)/.test(source)
        return hasMotion && !/prefers-reduced-motion:\s*reduce/.test(source)
            ? [path.replace(`${mobileRoot}/`, '')]
            : []
    })
    assert.deepEqual(missingFallback, [], missingFallback.join(', '))
})

test('横向滚动区声明手势豁免属性', () => {
    const scrollClasses = [
        'mobile-entry-detail__type-options',
        'mobile-entry-detail__image-grid',
        'mobile-entry-detail__markdown-toolbar',
        'mobile-entry-list__filters',
        'mobile-idea__summary',
        'mobile-project-home__stats',
    ]
    for (const className of scrollClasses) {
        const classBeforeAttribute = new RegExp(`className="[^"]*${className}[^"]*"[^>]*data-mobile-horizontal-scroll="true"`, 's')
        const attributeBeforeClass = new RegExp(`data-mobile-horizontal-scroll="true"[^>]*className="[^"]*${className}[^"]*"`, 's')
        assert.ok(
            classBeforeAttribute.test(mobileTsxSource) || attributeBeforeClass.test(mobileTsxSource),
            `${className} 缺少 data-mobile-horizontal-scroll`,
        )
    }
})

test('纵向页面根容器不会被宽内容拖离可见区域', () => {
    const mobilePageRule = mobileAppCss.match(/\.mobile-page\s*\{([^}]*)\}/)?.[1] ?? ''
    assert.match(mobilePageRule, /min-width:\s*0;/)
    assert.match(mobilePageRule, /max-width:\s*100%;/)
    assert.match(mobilePageRule, /overflow-x:\s*hidden;/)
    assert.match(mobilePageRule, /overflow-y:\s*auto;/)
    assert.match(mobilePageRule, /overscroll-behavior-x:\s*none;/)
    assert.match(mobilePageRule, /overscroll-behavior-y:\s*contain;/)
})
