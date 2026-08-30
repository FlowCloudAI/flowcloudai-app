import {type TagSchema} from '../../../api'
import {useProjectDetailStore} from '../../../features/projects/projectDetailStore'
import {MobileAddIcon, MobileBackIcon, MobilePageTopBar, MobileTopActionPill} from '../components/MobileTopControls'
import {type MobilePage, type MobileProjectScopedPageParams} from '../usePageStack'
import './MobileTypeTagManager.css'

interface Props {
    push: (page: MobilePage) => void
    pop: () => void
    params: MobileProjectScopedPageParams
}

function tagTypeLabel(type: string): string {
    if (type === 'number') return '数值'
    if (type === 'boolean') return '是/否'
    if (type === 'string') return '文本'
    return type
}

export default function MobileTagManager({push, pop, params}: Props) {
    const projectId = params.projectId

    // 标签列表改读项目详情 store：编辑页保存后 invalidate，这里自动跟上。
    const {tagSchemas, loading, hasLoaded} = useProjectDetailStore(projectId)

    const openEditor = (tag: TagSchema | null = null) => {
        push({
            type: 'tagEditor',
            params: {projectId, tagId: tag?.id, displayName: tag ? '编辑标签' : '新建标签'},
        })
    }

    return (
        <div className="mobile-page mobile-type-tag">
            <MobilePageTopBar
                sticky
                edgeToEdge
                ariaLabel="标签管理操作"
                left={<MobileTopActionPill
                    actions={[{
                        key: 'back',
                        label: '返回',
                        icon: <MobileBackIcon/>,
                        onClick: pop,
                    }]}
                />}
                right={<MobileTopActionPill
                    actions={[{
                        key: 'create',
                        label: '新建标签',
                        icon: <MobileAddIcon/>,
                        kind: 'add',
                        onClick: () => openEditor(null),
                    }]}
                />}
            />
            <div className="mobile-type-tag__heading">
                <span className="mobile-page__eyebrow mobile-type-tag__eyebrow">{loading && !hasLoaded ? '正在同步' : `${tagSchemas.length} 个标签`}</span>
                <h2 className="mobile-page__hero-title">标签管理</h2>
            </div>

            {loading && !hasLoaded ? (
                <div className="mobile-page__loading">加载中…</div>
            ) : (
                <div className="mobile-type-tag__list">
                    {tagSchemas.length === 0 ? (
                        <div className="mobile-page__empty mobile-type-tag__empty">还没有标签定义</div>
                    ) : tagSchemas.map(schema => (
                        <button
                            type="button"
                            className="mobile-list-card"
                            key={schema.id}
                            onClick={() => openEditor(schema)}
                        >
                            <span className="mobile-list-card__row">
                                <span className="mobile-list-card__main">
                                    <span className="mobile-list-card__title">{schema.name}</span>
                                    {schema.description && (
                                        <span className="mobile-list-card__description">{schema.description}</span>
                                    )}
                                </span>
                                <span className="mobile-list-card__tag mobile-type-tag__value-tag">
                                    {tagTypeLabel(schema.type)}
                                </span>
                            </span>
                        </button>
                    ))}
                </div>
            )}

        </div>
    )
}
