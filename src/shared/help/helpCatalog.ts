import helpAiFigure from './assets/help-ai.svg'
import helpBasicsFigure from './assets/help-basics.svg'
import helpMapFigure from './assets/help-map.svg'
import {getHelpSectionMarkdown} from './helpMarkdown'

export type HelpModuleKey = 'basics' | 'knowledge' | 'ai' | 'visualization' | 'safety'

export type HelpTopicKey =
    | 'getting-started'
    | 'workspace'
    | 'entries'
    | 'relations-timeline'
    | 'maps'
    | 'ai-guide'
    | 'plugins'
    | 'snapshots'
    | 'troubleshooting'

export interface HelpModule {
    key: HelpModuleKey
    label: string
    description: string
}

export interface HelpFigure {
    src: string
    alt: string
    caption: string
}

export interface HelpTopicSection {
    id: string
    title: string
    lead: string
    items: string[]
    figure?: HelpFigure
}

export interface HelpTopic {
    key: HelpTopicKey
    moduleKey: HelpModuleKey
    label: string
    summary: string
    category: string
    readingTime: string
    sections: HelpTopicSection[]
    tips: string[]
}

export interface HelpHomeLink {
    key: string
    title: string
    description: string
    topicKey: HelpTopicKey
    sectionId?: string
}

export interface ParsedHelpTarget {
    topicKey: HelpTopicKey
    sectionId: string | null
}

export interface HelpTopicGroup {
    module: HelpModule
    topics: HelpTopic[]
}

export const HELP_MODULES: HelpModule[] = [
    {key: 'basics', label: '开始创作', description: '创建世界并熟悉日常工作区。'},
    {key: 'knowledge', label: '管理资料', description: '组织词条、分类、关系和时间。'},
    {key: 'ai', label: '使用 AI 与插件', description: '使用创作辅助并完成插件配置。'},
    {key: 'visualization', label: '地图与可视化', description: '地图、形状和地理复核。'},
    {key: 'safety', label: '恢复与排查', description: '找回历史版本并处理常见问题。'},
]

export const HELP_TOPICS: HelpTopic[] = [
    {
        key: 'getting-started',
        moduleKey: 'basics',
        label: '创建第一个世界',
        summary: '从创建世界观到写下第一批词条，建立一个可持续扩展的创作起点。',
        category: '入门',
        readingTime: '约 3 分钟',
        sections: [
            {
                id: 'create-world',
                title: '创建第一个世界',
                lead: '先把作品范围和管理边界定下来，不急着补满所有细节。',
                items: ['在首页创建世界观，名称建议使用作品名或企划名。', '项目简介写清题材、基调和当前阶段，后续 AI 辅助会更稳定。'],
                figure: {
                    src: helpBasicsFigure,
                    alt: '帮助文档中的工作区结构示意图',
                    caption: '先确定项目边界，再进入分类、词条和辅助工具的工作流。',
                },
            },
            {
                id: 'build-structure',
                title: '搭建基础结构',
                lead: '分类是长期维护的骨架，先少后多比一次铺满更容易调整。',
                items: ['先建立角色、地点、组织、事件等顶层分类。', '把不确定内容放进灵感便签，确认后再转成正式词条。'],
            },
            {
                id: 'first-review',
                title: '完成首次复盘',
                lead: '第一次复盘的目标是确认能继续写，而不是追求设定完整。',
                items: ['用关系图检查关键词条是否孤立。', '重要改动前保存版本，避免早期试错覆盖掉可用版本。'],
            },
        ],
        tips: ['先搭结构再追求细节。', '不要把草稿直接删掉，先归档到便签或保存版本。'],
    },
    {
        key: 'workspace',
        moduleKey: 'basics',
        label: '熟悉工作区',
        summary: '理解主工作区、右侧 Dock 工具和底部设置入口之间的关系。',
        category: '界面',
        readingTime: '约 2 分钟',
        sections: [
            {
                id: 'main-area',
                title: '主工作区',
                lead: '主工作区承载长期编辑对象，适合打开项目、词条和项目工具。',
                items: ['顶部标签会保留最近打开的项目、词条和工具。', '切换主标签不会关闭右侧 Dock 中的辅助工具。'],
            },
            {
                id: 'right-dock',
                title: '右侧 Dock',
                lead: 'Dock 适合放临时辅助流程，避免打断主编辑现场。',
                items: ['灵感便签、AI 对话、历史版本和帮助都在右侧 Dock 中切换。', '拖动左侧手柄可以调整宽度，拖到边缘可折叠。'],
            },
        ],
        tips: ['Dock 工具适合辅助流程，主工作区适合核心编辑。', '右侧工具不会接管当前项目标签。'],
    },
    {
        key: 'entries',
        moduleKey: 'knowledge',
        label: '创建并整理词条',
        summary: '用分类、标签、正文和链接管理角色、地点、组织与事件。',
        category: '资料',
        readingTime: '约 4 分钟',
        sections: [
            {
                id: 'write-entry',
                title: '写词条',
                lead: '词条是世界观资料的最小稳定单位，应当围绕一个明确对象展开。',
                items: ['标题使用读者或作者能快速识别的名称。', '正文先写核心设定，再补充历史、动机、限制和未解问题。'],
                figure: {
                    src: helpBasicsFigure,
                    alt: '词条资料和侧边目录的示意图',
                    caption: '词条正文保持稳定，临时想法先放在便签或待整理区域。',
                },
            },
            {
                id: 'classify-entry',
                title: '分类与标签',
                lead: '分类解决“放在哪里”，标签解决“如何筛选”。',
                items: ['分类建议保持树状结构清晰，不要把临时状态做成分类。', '标签适合记录阵营、时期、重要程度、叙事功能等横向属性。'],
            },
            {
                id: 'entry-links',
                title: '词条内链',
                lead: '内链让阅读和 AI 上下文都能更准确地找到相关资料。',
                items: ['在正文中引用关键角色、地点和事件，形成可追溯关系。', '重命名词条后检查常用链接，避免旧称造成理解偏差。'],
            },
        ],
        tips: ['一个词条只解决一个主要对象。', '状态、阵营、时期这类信息优先用标签表达。'],
    },
    {
        key: 'relations-timeline',
        moduleKey: 'knowledge',
        label: '检查关系与时间顺序',
        summary: '通过关系图检查连接，通过时间线整理事件顺序。',
        category: '分析',
        readingTime: '约 3 分钟',
        sections: [
            {
                id: 'relation-map',
                title: '关系图',
                lead: '关系图用于检查设定之间是否连通，以及某些词条是否承担过多叙事压力。',
                items: ['先补全核心角色、组织、地点之间的关系。', '发现孤立节点时，判断它是未完成设定还是可以移除的噪音。'],
            },
            {
                id: 'timeline',
                title: '时间线',
                lead: '时间线适合整理事件顺序、因果链和同一时期的并行行动。',
                items: ['为重要事件保留清晰日期或阶段描述。', '大纲重写时先调整时间线，再回到词条正文补细节。'],
            },
            {
                id: 'review-loop',
                title: '复核流程',
                lead: '关系和时间顺序会随着写作推进变化，建议阶段性复核。',
                items: ['完成一组章节或一轮设定后打开关系图。', '出现人物动机冲突时，用时间线检查信息获取顺序。'],
            },
        ],
        tips: ['关系图看结构，时间线看顺序。', '不要把临时脑暴关系直接当成稳定设定。'],
    },
    {
        key: 'maps',
        moduleKey: 'visualization',
        label: '编辑地图与形状',
        summary: '维护世界地图、区域边界和地点语义，服务地理叙事。',
        category: '可视化',
        readingTime: '约 3 分钟',
        sections: [
            {
                id: 'map-purpose',
                title: '地图用途',
                lead: '地图不是单纯插图，它帮助你确认距离、边界、路线和冲突区域。',
                items: ['先标注叙事中会反复出现的地点。', '对边境、海岸、山脉这类影响剧情的地理要素保持命名一致。'],
                figure: {
                    src: helpMapFigure,
                    alt: '地图区域和地点连线的示意图',
                    caption: '地图帮助你把地点、路线和势力范围放回同一个空间里检查。',
                },
            },
            {
                id: 'shape-editing',
                title: '形状编辑',
                lead: '形状适合表达国家、城区、势力范围和特殊区域。',
                items: ['编辑前先保存当前项目版本。', '复杂边界分阶段处理，避免一次修改过多导致难以回到旧版本。'],
            },
            {
                id: 'map-review',
                title: '地理复核',
                lead: '地图改动应当回流到词条和事件，不要让地图成为孤立资料。',
                items: ['重要地点改名后同步检查相关词条。', '跨区域事件写作前先确认路线和距离是否合理。'],
            },
        ],
        tips: ['地图优先服务叙事，不必追求一次画完。', '地理命名应和词条标题保持一致。'],
    },
    {
        key: 'ai-guide',
        moduleKey: 'ai',
        label: '使用 AI 辅助创作',
        summary: '使用对话、角色聊天、总结和矛盾检测来辅助创作。',
        category: 'AI',
        readingTime: '约 4 分钟',
        sections: [
            {
                id: 'chat',
                title: '普通对话',
                lead: '普通对话适合提纲、润色、设定追问和资料整理。',
                items: ['先在设置中配置插件、模型和访问密钥。', '提问时说明目标、范围和希望输出的格式。'],
                figure: {
                    src: helpAiFigure,
                    alt: 'AI 对话和上下文整理的示意图',
                    caption: '把目标、范围和输出格式说清楚，比单纯让 AI 自由发挥更可靠。',
                },
            },
            {
                id: 'character-chat',
                title: '角色聊天',
                lead: '角色聊天用于测试角色口吻、动机和冲突反应。',
                items: ['从角色词条启动对话，确保角色设定足够清晰。', '把有价值的回答整理回词条，不要只留在会话里。'],
            },
            {
                id: 'contradiction',
                title: '矛盾检测',
                lead: '矛盾检测适合长项目复核和大纲重写前的风险排查。',
                items: ['检测前先确保核心词条已经保存。', '报告生成后可以继续让 AI 解释冲突原因和修复方案。'],
            },
        ],
        tips: ['AI 输出应作为草案，关键设定仍需要人工确认。', '长对话建议定期归档，保留当前最重要的上下文。'],
    },
    {
        key: 'plugins',
        moduleKey: 'ai',
        label: '配置插件与密钥',
                summary: '管理模型插件、访问密钥和本地能力扩展。',
        category: '设置',
        readingTime: '约 3 分钟',
        sections: [
            {
                id: 'plugin-source',
                title: '插件来源',
                lead: '流云AI使用 .fcplug 插件接入模型、图像生成和语音能力。',
                items: ['插件包通常包含 manifest、wasm 模块和图标。', '只安装来源明确、与你当前需求匹配的插件。'],
                figure: {
                    src: helpAiFigure,
                    alt: '插件连接模型能力的示意图',
                    caption: '插件负责把本地应用和具体模型能力连接起来。',
                },
            },
            {
                id: 'api-key',
                title: '密钥管理',
                lead: '访问密钥属于敏感信息，应当交给系统密钥链保存。',
                items: ['在设置页为对应插件配置访问密钥。', '不要把真实密钥写入普通配置文件、模板或项目文档。'],
            },
            {
                id: 'plugin-errors',
                title: '调用失败排查',
                lead: '插件失败通常来自安装状态、密钥、网络或模型名称。',
                items: ['先确认插件已安装并能读取模型列表。', '再检查密钥状态、网络连接和模型名称是否匹配。'],
            },
        ],
        tips: ['同类插件建议只保留常用的一两个，减少模型选择成本。', '迁移机器时需要重新配置本机密钥。'],
    },
    {
        key: 'snapshots',
        moduleKey: 'safety',
        label: '恢复历史版本',
        summary: '用保存版本和分支路线保护世界观数据。',
        category: '安全',
        readingTime: '约 3 分钟',
        sections: [
            {
                id: 'manual-save',
                title: '保存版本',
                lead: '保存版本是可回看的项目状态，适合在阶段性成果后保存。',
                items: ['保存时写清这次改动的意图。', '大改剧情、导入资料或批量重命名前先保存版本。'],
            },
            {
                id: 'branches',
                title: '分支路线',
                lead: '分支路线适合尝试互斥剧情或大规模重写方案。',
                items: ['稳定主线保留在默认分支。', '实验分支命名应表达用途，例如“重写王都线”。'],
            },
            {
                id: 'restore',
                title: '回到旧版本',
                lead: '回到旧版本会影响当前路线，操作前应确认目标版本。',
                items: ['回到旧版本前先阅读版本说明。', '不确定时优先从旧版本创建分支路线，而不是直接覆盖当前进展。'],
            },
        ],
        tips: ['重要改动前先保存版本。', '版本说明要写意图，不要只写“备份”。'],
    },
    {
        key: 'troubleshooting',
        moduleKey: 'safety',
        label: '排查常见问题',
        summary: '遇到插件、数据、界面和 AI 调用问题时的排查顺序。',
        category: '排查',
        readingTime: '约 3 分钟',
        sections: [
            {
                id: 'data-missing',
                title: '内容看起来丢失',
                lead: '先确认自己所在的项目、分支路线和筛选条件，再判断是否真的丢失。',
                items: ['检查当前项目和分类筛选。', '打开历史版本查看最近保存和分支路线记录。'],
            },
            {
                id: 'ai-not-working',
                title: 'AI 没有响应',
                lead: 'AI 调用依赖插件、密钥、网络和模型配置，排查时按顺序缩小范围。',
                items: ['确认插件已安装且访问密钥已配置。', '切换到更简单的问题测试模型是否可用。'],
            },
            {
                id: 'ui-stuck',
                title: '界面状态异常',
                lead: '多数界面问题可以通过保存当前工作、重新打开项目或重启应用恢复。',
                items: ['先保存正在编辑的内容。', '如果问题重复出现，记录触发步骤并通过反馈入口提交。'],
            },
        ],
        tips: ['排查时一次只改变一个条件。', '反馈问题时附上触发步骤比只描述现象更有用。'],
    },
]

export const HELP_HOME_LINKS: HelpHomeLink[] = [
    {
        key: 'getting-started',
        title: '新手指南',
        description: '从创建世界观到完成第一次复盘。',
        topicKey: 'getting-started',
        sectionId: 'create-world',
    },
    {
        key: 'entries',
        title: '词条怎么写',
        description: '理解分类、标签、正文和内链的配合方式。',
        topicKey: 'entries',
        sectionId: 'write-entry',
    },
    {
        key: 'ai-guide',
        title: 'AI 功能说明',
        description: '查看对话、角色聊天和矛盾检测的使用方式。',
        topicKey: 'ai-guide',
        sectionId: 'chat',
    },
    {
        key: 'plugins',
        title: '插件与密钥',
                description: '了解模型插件、访问密钥和调用失败排查。',
        topicKey: 'plugins',
        sectionId: 'api-key',
    },
]

const HELP_TOPIC_KEYS = new Set(HELP_TOPICS.map(topic => topic.key))
const HELP_MODULE_MAP = new Map(HELP_MODULES.map(module => [module.key, module]))

function normalizeSearchText(value: string) {
    return value.trim().toLocaleLowerCase()
}

export function normalizeHelpTopicKey(topicKey?: string | null): HelpTopicKey {
    return HELP_TOPIC_KEYS.has(topicKey as HelpTopicKey) ? (topicKey as HelpTopicKey) : 'getting-started'
}

export function parseHelpTarget(rawTarget?: string | null): ParsedHelpTarget {
    const [rawTopicKey, rawSectionId] = (rawTarget ?? '').split('#', 2)
    const topicKey = normalizeHelpTopicKey(rawTopicKey)
    const sectionId = rawSectionId?.trim() || null
    const topic = HELP_TOPICS.find(item => item.key === topicKey)
    const matchedSectionId = topic?.sections.some(section => section.id === sectionId) ? sectionId : null

    return {topicKey, sectionId: matchedSectionId}
}

export function buildHelpTargetId(topicKey: HelpTopicKey, sectionId?: string) {
    return sectionId ? `${topicKey}#${sectionId}` : topicKey
}

export function getHelpSectionDomId(topicKey: HelpTopicKey, sectionId: string) {
    return `help-section-${topicKey}-${sectionId}`
}

export function getHelpModule(moduleKey: HelpModuleKey) {
    return HELP_MODULE_MAP.get(moduleKey) ?? HELP_MODULES[0]
}

export function groupHelpTopicsByModule(topics: HelpTopic[]): HelpTopicGroup[] {
    return HELP_MODULES
        .map(module => ({
            module,
            topics: topics.filter(topic => topic.moduleKey === module.key),
        }))
        .filter(group => group.topics.length > 0)
}

export function filterHelpTopics(topics: HelpTopic[], query: string) {
    const keyword = normalizeSearchText(query)
    if (!keyword) return topics

    return topics.filter(topic => {
        const module = getHelpModule(topic.moduleKey)
        const source = [
            module.label,
            module.description,
            topic.label,
            topic.summary,
            topic.category,
            ...topic.sections.flatMap(section => [
                section.title,
                section.lead,
                getHelpSectionMarkdown(topic.key, section.id),
                section.figure?.caption ?? '',
                ...section.items,
            ]),
            ...topic.tips,
        ].join('\n').toLocaleLowerCase()

        return source.includes(keyword)
    })
}
