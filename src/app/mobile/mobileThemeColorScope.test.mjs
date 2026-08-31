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

const recipeSource = readFileSync(new URL('../../pages/settings/fcThemeRecipe.ts', import.meta.url), 'utf8')
const bootstrapSource = readFileSync(new URL('../../main.tsx', import.meta.url), 'utf8')

test('背景令牌只写进排除 touch density 的作用域', () => {
    // 用 :not() 而不是给移动端另发一份 CSS：密度是 ThemeProvider 运行时写/删的属性。
    assert.match(recipeSource, /FC_THEME_DESKTOP_SCOPE\s*=\s*'html:root:not\(\[data-fc-density="touch"\]\)'/)
    assert.match(recipeSource, /block\(FC_THEME_DESKTOP_SCOPE, background, lightCssOf\)/)
    assert.match(recipeSource, /block\(`\$\{FC_THEME_DESKTOP_SCOPE\}\[data-theme="dark"\]`, background, darkCssOf\)/)
})

test('非背景令牌仍然双端生效', () => {
    assert.match(recipeSource, /block\('html:root', shared, lightCssOf\)/)
    assert.match(recipeSource, /block\('html:root\[data-theme="dark"\]', shared, darkCssOf\)/)
    // shared / background 必须是同一份 tokens 的互补切分，漏掉哪一边都会静默少发令牌。
    assert.match(recipeSource, /const shared = preview\.tokens\.filter\(\(item\) => !isBackgroundToken\(item\)\)/)
    assert.match(recipeSource, /const background = preview\.tokens\.filter\(isBackgroundToken\)/)
    assert.match(recipeSource, /item\.group === '背景'/)
})

test('启动时先写密度再应用颜色主题', () => {
    // 属性还没写上去的那一刻 :not([data-fc-density="touch"]) 是命中的，顺序反了移动端会短暂拿到桌面底色。
    const densityIndex = bootstrapSource.indexOf("setAttribute('data-fc-density', 'touch')")
    const applyIndex = bootstrapSource.indexOf('applyPersistedThemeColorConfig(themeColorConfig)')
    assert.ok(densityIndex > 0, '未找到密度写入')
    assert.ok(applyIndex > 0, '未找到颜色主题应用')
    assert.ok(densityIndex < applyIndex, '颜色主题必须在 data-fc-density 之后应用')
})
