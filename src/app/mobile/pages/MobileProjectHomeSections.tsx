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

interface ProjectHomeResourceListProps {
    entryCount: string
    customTypeCount: string
    tagSchemaCount: string
    onOpenEntries: () => void
    onOpenTypeManager: () => void
    onOpenTagManager: () => void
}

export function ProjectHomeResourceList({
    entryCount,
    customTypeCount,
    tagSchemaCount,
    onOpenEntries,
    onOpenTypeManager,
    onOpenTagManager,
}: ProjectHomeResourceListProps) {
    return (
        <section className="mobile-project-home__section">
            <div className="mobile-project-home__section-head">
                <h3 className="mobile-project-home__section-title">资料</h3>
            </div>
            <div className="mobile-project-home__list">
                <button
                    type="button"
                    className="mobile-project-home__cell"
                    onClick={onOpenEntries}
                >
                    <span>
                        <strong>全部词条</strong>
                        <small>浏览项目中所有词条</small>
                    </span>
                    <em>{entryCount}</em>
                </button>

                <button
                    type="button"
                    className="mobile-project-home__cell"
                    onClick={onOpenTypeManager}
                >
                    <span>
                        <strong>类型管理</strong>
                        <small>管理自定义词条类型</small>
                    </span>
                    <em>{customTypeCount}</em>
                </button>

                <button
                    type="button"
                    className="mobile-project-home__cell"
                    onClick={onOpenTagManager}
                >
                    <span>
                        <strong>标签管理</strong>
                        <small>管理词条标签定义</small>
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
