// 桌面设置与项目工具页只保留必要标签，并守住时间线的有效操作说明。

import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import {URL} from 'node:url'

const readSource = relativePath => readFile(new URL(relativePath, import.meta.url), 'utf8')

test('设置大项与外观配置不再渲染说明性副标题', async () => {
    const [settings, themePreview, tokenEditor] = await Promise.all([
        readSource('../pages/Settings.tsx'),
        readSource('../pages/settings/ThemeColorPreview.tsx'),
        readSource('../pages/settings/ThemeTokenColorEditor.tsx'),
    ])

    assert.doesNotMatch(settings, /className="fc-page-subtitle"/)
    assert.doesNotMatch(settings, /启用组件毛玻璃背景/)
    assert.match(settings, /aria-label="毛玻璃效果"/)
    assert.doesNotMatch(settings, /AI 搜索工具仅会使用已启用的信源组/)
    assert.doesNotMatch(themePreview, /主色、背景、边框和文字层级/)
    assert.doesNotMatch(tokenEditor, /主色令牌通用/)
})

test('更新与许可诊断只保留标题、状态和操作', async () => {
    const [updateSection, aboutSection] = await Promise.all([
        readSource('../features/about/UpdateSection.tsx'),
        readSource('../features/about/AboutSection.tsx'),
    ])

    assert.doesNotMatch(updateSection, /自动更新会从官网获取/)
    assert.doesNotMatch(updateSection, /软件启动时静默检查一次/)
    assert.doesNotMatch(aboutSection, /查看应用使用中的数据与权限说明/)
    assert.doesNotMatch(aboutSection, /查看 Noto CJK、霞鹜文楷/)
    assert.doesNotMatch(aboutSection, /app\.log 位于配置目录内/)
})

test('项目主页不再显示高级工具、词条类型和标签的装饰性描述', async () => {
    const [quickActions, configOverview] = await Promise.all([
        readSource('../features/project-editor/components/ProjectOverview/ProjectQuickActions.tsx'),
        readSource('../features/project-editor/components/ProjectOverview/ProjectConfigOverview.tsx'),
    ])

    assert.doesNotMatch(quickActions, />结构管理</)
    assert.doesNotMatch(configOverview, /浏览全部词条类型；自定义类型可直接编辑/)
    assert.doesNotMatch(configOverview, /管理标签类型、默认值和默认植入范围/)
})

test('高级工具页移除标题说明，但保留时间线视图操作说明', async () => {
    const [relationGraph, timeline, contradiction, worldMap] = await Promise.all([
        readSource('../features/relation-graph/components/ProjectRelationGraph.tsx'),
        readSource('../features/project-editor/components/ProjectTimeline.tsx'),
        readSource('../features/project-editor/components/ProjectContradiction/ProjectContradictionPanel.tsx'),
        readSource('../features/maps/components/WorldMapPanel.tsx'),
    ])

    assert.doesNotMatch(relationGraph, /可视化展示项目内词条之间的关联结构/)
    assert.doesNotMatch(timeline, /系统会扫描项目中的词条标签/)
    assert.doesNotMatch(contradiction, /检查项目设定的一致性、契合度与公开发布风险/)
    assert.doesNotMatch(worldMap, /编辑区域、地点与海岸线风格/)
    assert.doesNotMatch(timeline, /按时间顺序浏览事件/)
    assert.match(timeline, /滚轮平移 · Ctrl\/⌘ \+ 滚轮缩放 · ←\/→ 切换事件/)
})
