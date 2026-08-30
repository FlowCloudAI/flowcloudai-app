import {type CSSProperties} from 'react'
import {Button} from 'flowcloudai-ui'
import {formatProjectDate} from '../../../features/projects/projectDisplay'
import ProjectDefaultCover from '../../../features/projects/ProjectDefaultCover'
import {MobileAddIcon} from '../components/MobileTopControls'

export interface ProjectHomeStatItem {
    key: string
    label: string
    value: string
}

export interface ProjectHomeTool {
    key: string
    label: string
    meta: string
    disabled?: boolean
    unavailableReason?: string
}

interface ProjectHomeHeroProps {
    projectId: string
    projectName: string
    description?: string | null
    image?: string
    createdAt?: string | null
    updatedAt?: string | null
    statItems: ProjectHomeStatItem[]
    onOpenDescription: () => void
}

export function ProjectHomeHero({
    projectId,
    projectName,
    description,
    image,
    createdAt,
    updatedAt,
    statItems,
    onOpenDescription,
}: ProjectHomeHeroProps) {
    return (
        <section className="mobile-project-home__hero">
            {image ? (
                <img
                    src={image}
                    alt={projectName}
                    className="mobile-project-home__cover"
                />
            ) : (
                <ProjectDefaultCover
                    className="mobile-project-home__cover"
                    projectId={projectId}
                    projectName={projectName}
                    variant="hero"
                />
            )}
            <div className="mobile-project-home__title-row">
                <div className="mobile-project-home__title-copy">
                    <span className="mobile-page__eyebrow mobile-project-home__eyebrow">世界观</span>
                    <h2 className="mobile-project-home__title">{projectName}</h2>
                </div>
            </div>
            <button
                type="button"
                className={`mobile-project-home__description${description ? '' : ' is-placeholder'}`}
                onClick={onOpenDescription}
            >
                {description || '添加项目描述'}
            </button>
            <div className="mobile-project-home__meta-row">
                <span>创建 {formatProjectDate(createdAt)}</span>
                <span>更新 {formatProjectDate(updatedAt)}</span>
            </div>
            <div
                className="mobile-project-home__stats"
                aria-label="项目统计"
                data-mobile-horizontal-scroll="true"
            >
                {statItems.map(item => (
                    <span key={item.key} className="mobile-project-home__stat">
                        <strong>{item.value}</strong>
                        <span>{item.label}</span>
                    </span>
                ))}
            </div>
        </section>
    )
}

interface ProjectHomePrimaryActionsProps {
    onCreateEntry: () => void
    onOpenAi: () => void
}

export function ProjectHomePrimaryActions({onCreateEntry, onOpenAi}: ProjectHomePrimaryActionsProps) {
    return (
        <div className="mobile-project-home__actions">
            <Button type="button" size="sm" className="mobile-project-home__action" onClick={onCreateEntry}><MobileAddIcon className="mobile-top-control-svg--inline"/>新建词条</Button>
            <Button type="button" size="sm" variant="outline" className="mobile-project-home__action" onClick={onOpenAi}>AI 讨论</Button>
        </div>
    )
}

/** 少于这个词条数不给分：样本太小，算出来的分数没有参考价值（与桌面 HealthMeter 一致）。 */
const HEALTH_SCORE_MIN_ENTRIES = 10

interface ProjectHomeHealthScoreProps {
    score: number
    entryCount: number
}

/*
 * 桌面 HealthMeter 的简化版：只有环形分值 + 一句结论，没有「详情」展开态。
 * 阈值与文案跟桌面保持一致，避免两端对同一个项目给出不同的口径。
 */
export function ProjectHomeHealthScore({score, entryCount}: ProjectHomeHealthScoreProps) {
    const hasEnoughEntries = entryCount >= HEALTH_SCORE_MIN_ENTRIES
    const status = !hasEnoughEntries
        ? '资料量不足'
        : score >= 80 ? '结构稳定' : score >= 55 ? '仍需补强' : '基础偏弱'
    const ringStyle = {
        '--mobile-health-ring-value': `${hasEnoughEntries ? Math.max(4, Math.round(score)) : 0}%`,
    } as CSSProperties
    return (
        <section className="mobile-project-home__section">
            <div className="mobile-project-home__section-head">
                <h3 className="mobile-project-home__section-title">资料整理评分</h3>
            </div>
            <div className="mobile-project-home__health">
                <div className="mobile-project-home__health-ring" style={ringStyle} aria-hidden="true">
                    <span>{hasEnoughEntries ? Math.round(score) : '—'}</span>
                </div>
                <div className="mobile-project-home__health-body">
                    <strong>{status}</strong>
                    <small>
                        {hasEnoughEntries
                            ? '按内容完整、组织归属、关系连通和结构配置估算。'
                            : `至少 ${HEALTH_SCORE_MIN_ENTRIES} 个词条后显示评分。`}
                    </small>
                </div>
            </div>
        </section>
    )
}

interface ProjectHomeResourceListProps {
    /** 类型总数含内置类型：管理页里内置类型同样可见可改，只数自定义会和页面对不上。 */
    entryTypeCount: string
    tagSchemaCount: string
    onOpenTypeManager: () => void
    onOpenTagManager: () => void
}

/*
 * 「全部词条」不在这里：它已按桌面的结构内嵌到项目主页底部，
 * 这一段只剩两个管理入口，并排放，不再写说明小字——标题本身已经说清去向。
 */
export function ProjectHomeResourceList({
    entryTypeCount,
    tagSchemaCount,
    onOpenTypeManager,
    onOpenTagManager,
}: ProjectHomeResourceListProps) {
    return (
        <section className="mobile-project-home__section">
            <div className="mobile-project-home__section-head">
                <h3 className="mobile-project-home__section-title">资料</h3>
            </div>
            <div className="mobile-project-home__list mobile-project-home__list--pair">
                <button
                    type="button"
                    className="mobile-project-home__cell"
                    onClick={onOpenTypeManager}
                >
                    <span>
                        <strong>类型管理</strong>
                    </span>
                    <em>{entryTypeCount}</em>
                </button>

                <button
                    type="button"
                    className="mobile-project-home__cell"
                    onClick={onOpenTagManager}
                >
                    <span>
                        <strong>标签管理</strong>
                    </span>
                    <em>{tagSchemaCount}</em>
                </button>
            </div>
        </section>
    )
}

interface ProjectHomeToolGridProps {
    tools: ProjectHomeTool[]
    onSelectTool: (tool: ProjectHomeTool) => void
}

export function ProjectHomeToolGrid({tools, onSelectTool}: ProjectHomeToolGridProps) {
    return (
        <section className="mobile-project-home__section">
            <div className="mobile-project-home__section-head">
                <h3 className="mobile-project-home__section-title">高级工具</h3>
            </div>
            <div className="mobile-project-home__tool-grid">
                {tools.map(tool => (
                    <button
                        type="button"
                        key={tool.key}
                        className="mobile-project-home__tool"
                        aria-label={tool.disabled && tool.unavailableReason
                            ? `${tool.label}，${tool.unavailableReason}`
                            : undefined}
                        disabled={tool.disabled}
                        onClick={() => onSelectTool(tool)}
                    >
                        <span>{tool.label}</span>
                        <small>{tool.unavailableReason ?? tool.meta}</small>
                    </button>
                ))}
            </div>
        </section>
    )
}
