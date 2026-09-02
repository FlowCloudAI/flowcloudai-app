/*
 * 颜色主题覆盖在移动端的作用域契约。
 *
 * 配方的四个背景令牌只给桌面端：移动端整屏几乎只有底色，铺满全屏后读起来是「换了个应用」。
 * 其余令牌（主色、边框、文字、滚动条）双端一致，这样中性色仍然跟着配方的色相走，
 * 整体色调是一套而不是「彩色控件 + 灰色底」。
 *
 * 这里只钉住源码里的结构决定；真实级联行为在真机上用 CDP 注入验证，
 * 因为 fcThemeRecipe.ts 依赖 @material/material-color-utilities 的无扩展名 ESM，
 * 裸 Node 解析不了，import 进来跑不起来。
 */

import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {URL} from 'node:url'

const recipeSource = readFileSync(new URL('../../features/settings/fcThemeRecipe.ts', import.meta.url), 'utf8')
const bootstrapSource = readFileSync(new URL('../../main.tsx', import.meta.url), 'utf8')
const sectionSource = readFileSync(new URL('./pages/MobileThemeColorSection.tsx', import.meta.url), 'utf8')
const appearanceSource = readFileSync(new URL('./pages/MobileSettingsSections.tsx', import.meta.url), 'utf8')
const sectionCss = readFileSync(new URL('./pages/MobileThemeColorSection.css', import.meta.url), 'utf8')
const fontsCss = readFileSync(new URL('../../assets/fonts/fonts.css', import.meta.url), 'utf8')

test('桌面端专属令牌只写进排除 touch density 的作用域', () => {
    // 用 :not() 而不是给移动端另发一份 CSS：密度是 ThemeProvider 运行时写/删的属性。
    assert.match(recipeSource, /FC_THEME_DESKTOP_SCOPE\s*=\s*'html:root:not\(\[data-fc-density="touch"\]\)'/)
    assert.match(recipeSource, /block\(FC_THEME_DESKTOP_SCOPE, desktopOnly, lightCssOf\)/)
    assert.match(recipeSource, /block\(`\$\{FC_THEME_DESKTOP_SCOPE\}\[data-theme="dark"\]`, desktopOnly, darkCssOf\)/)
})

test('三级文字不发给移动端，可读性别名才压得住', () => {
    /*
     * 深色侧覆盖写在 html:root[data-theme="dark"]（0,2,1），比别名所在的
     * :root[data-fc-density="touch"]（0,2,0）特异性更高——只靠 !important
     * 是浅色能赢、深色赢不了。所以这个令牌根本不往移动端发。
     */
    assert.match(recipeSource, /DESKTOP_ONLY_TOKENS = new Set\(\[[\s\S]*?'--fc-color-text-tertiary',[\s\S]*?\]\)/)
})

test('非背景令牌仍然双端生效', () => {
    assert.match(recipeSource, /block\('html:root', shared, lightCssOf\)/)
    assert.match(recipeSource, /block\('html:root\[data-theme="dark"\]', shared, darkCssOf\)/)
    // shared / background 必须是同一份 tokens 的互补切分，漏掉哪一边都会静默少发令牌。
    assert.match(recipeSource, /const shared = preview\.tokens\.filter\(\(item\) => !isDesktopOnlyToken\(item\)\)/)
    assert.match(recipeSource, /const desktopOnly = preview\.tokens\.filter\(isDesktopOnlyToken\)/)
    // 四个背景令牌仍在桌面专属集合里
    for (const token of ['--fc-color-bg', '--fc-color-bg-secondary', '--fc-color-bg-tertiary', '--fc-color-bg-elevated']) {
        assert.match(recipeSource, new RegExp(`'${token}',`))
    }
})

test('启动时先写密度再应用颜色主题', () => {
    // 属性还没写上去的那一刻 :not([data-fc-density="touch"]) 是命中的，顺序反了移动端会短暂拿到桌面底色。
    const densityIndex = bootstrapSource.indexOf("setAttribute('data-fc-density', 'touch')")
    const applyIndex = bootstrapSource.indexOf('applyPersistedThemeColorConfig(themeColorConfig)')
    assert.ok(densityIndex > 0, '未找到密度写入')
    assert.ok(applyIndex > 0, '未找到颜色主题应用')
    assert.ok(densityIndex < applyIndex, '颜色主题必须在 data-fc-density 之后应用')
})

test('外观设置里的颜色主题只做配方切换', () => {
    // 逐令牌编辑没有迁过来：46 个取色输入排不下，且系统取色器只有 8 个固定色块。
    assert.doesNotMatch(sectionSource, /type="color"/)
    assert.doesNotMatch(sectionSource, /type="file"/)
    assert.doesNotMatch(sectionSource, /saveFileDialog|openFileDialog|setting_export_theme_config/)
    assert.match(sectionSource, /FC_THEME_RECIPES\.map\(recipe =>/)
})

test('配方选中态由设置值推导，不在组件里另存一份', () => {
    // 本地再存一份就要写双向同步 effect，桌面端那段正是最难读的部分。
    assert.doesNotMatch(sectionSource, /useState/)
    assert.match(sectionSource, /resolveThemeColorState\(value, defaultRecipe, defaultValues\)/)
    assert.match(sectionSource, /const active = recipe\.id === state\.recipeId/)
    assert.match(sectionSource, /aria-pressed=\{active\}/)
})

test('覆盖不随设置页卸载而清除', () => {
    /*
     * 覆盖是文档级 <style>，离开设置页仍要留着；effect 里一旦 return 清理函数，
     * 切走 Tab 颜色就会掉回默认。清除只发生在选回默认配方那一条分支。
     */
    const effect = sectionSource.slice(
        sectionSource.indexOf('useEffect(() => {'),
        sectionSource.indexOf('const selectRecipe'),
    )
    assert.match(effect, /clearFcThemeTokenOverride\(\)/)
    assert.match(effect, /applyFcThemeTokenOverride\(preview, state\.tokenColors\)/)
    assert.doesNotMatch(effect, /return \(\) =>/)
})

test('颜色主题挂在外观分区里', () => {
    assert.match(appearanceSource, /<MobileThemeColorSection\s+value=\{themeColorConfig\}/)
    assert.match(appearanceSource, /onChange=\{onThemeColorConfigChange\}/)
})

test('配方名用的字全在玄宗体子集里', () => {
    /*
     * 玄宗体原始 otf 38.6 MB，内嵌的是只含配方名那 12 个字的 27 KB 子集。
     * 新增配方时若名称用到集外的字，浏览器会静默回落到正文字体——只有这条断言看得见。
     * 修法是重新跑一次子集（把新字加进 --text）并同步 fonts.css 注释里的字表。
     */
    assert.match(sectionCss, /font-family: "FC XuanZongTi"/)
    assert.match(fontsCss, /font-family: "FC XuanZongTi"/)

    const covered = new Set(
        (fontsCss.match(/只含颜色主题六个配方名用到的 \d+ 个字（([^）]+)）/) ?? [])[1] ?? '',
    )
    assert.ok(covered.size > 0, 'fonts.css 里没找到玄宗体子集的字表注释')

    const labels = [...recipeSource.matchAll(/^\s{8}label: '([^']+)',$/gm)].map(m => m[1])
    assert.ok(labels.length >= 5, `只解析到 ${labels.length} 个配方名，正则可能失配`)

    const missing = [...new Set(labels.join(''))].filter(ch => !covered.has(ch))
    assert.deepEqual(missing, [], `这些字不在子集里，需重新生成 woff2：${missing.join('')}`)
})

test('选中卡的主色取自配方自己的令牌，不读当前生效主题', () => {
    /*
     * --fc-color-primary 是「当前生效的主题色」，而卡片画的是「这个配方长什么样」。
     * 默认配方不注入覆盖，深色模式下这个令牌是 lib_ui 的基线亮蓝，压在浅色题图上
     * 只有 2.4:1（2026-09-02 真机实测）。所以名称与勾选标记都不能直接消费它。
     */
    assert.match(sectionSource, /getPrimaryTokenColor\(state\.tokenColors, selectedRecipe\.primarySeed\)/)
    assert.match(sectionSource, /'--mobile-theme-color-accent': activeAccent/)
    assert.doesNotMatch(sectionCss, /(?<![-a-z])color:\s*var\(--fc-color-primary\)\s*;/)
})

test('卡片上除了名称没有别的标记', () => {
    /*
     * 卡片高度由 12:5 锁死，字号却跟随系统 --mobile-font-scale。
     * 任何和名称抢位置的东西（「默认」徽章、勾选标记）在字号调大后都会被放大的名称撞上——
     * 2026-09-02 实测徽章竖排在名称下方时，常态就只剩 0.6px 间隙。
     */
    assert.doesNotMatch(sectionSource, /mobile-theme-color__(?:badge|check|caption-row)/)
    assert.doesNotMatch(sectionCss, /mobile-theme-color__(?:badge|check|caption-row)/)
})

test('配方名的选中态是放大、变色与位移，且三者都有过渡', () => {
    const declaredSize = block => {
        const rule = sectionCss.match(new RegExp(`\\.mobile-theme-color__${block} \\{([^}]*)\\}`, 's'))
        return rule?.[1].match(/font-size: (var\(--mobile-text-[a-z-]+\));/)?.[1] ?? null
    }
    const activeRule = sectionCss.match(/--active \.mobile-theme-color__name \{([\s\S]*?)\n\}/)?.[1] ?? ''
    const base = declaredSize('name')
    const active = activeRule.match(/font-size: (var\(--mobile-text-[a-z-]+\));/)?.[1] ?? null
    assert.ok(base && active, `没解析到字号：base=${base} active=${active}`)
    assert.notEqual(base, active, '选中态字号必须比常态大一档')
    assert.match(activeRule, /color: color-mix\([\s\S]*--mobile-theme-color-accent/)
    assert.match(activeRule, /transform: translate\(calc\(-1 \* var\(--mobile-gap-inline\)\), var\(--mobile-gap-inline\)\) scale\(/)

    // 放大、位移、变色三条过渡缺一条动画就断一截。
    for (const property of ['transform', 'font-size', 'color']) {
        assert.match(
            sectionCss,
            new RegExp(`\\.mobile-theme-color__name \\{[^}]*transition:[\\s\\S]*?${property} var\\(--mobile-duration-base\\)`, 's'),
            `名称缺少 ${property} 过渡`,
        )
    }
})
