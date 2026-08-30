import {useState} from 'react'
import {type CustomEntryType, type EntryTypeView} from '../../../api'
import EntryTypeIcon from '../../../features/project-editor/components/EntryTypeIcon'
import {useProjectDetailStore} from '../../../features/projects/projectDetailStore'
import {MobileAddIcon, MobileBackIcon, MobilePageTopBar, MobileTopActionPill} from '../components/MobileTopControls'
import {type MobilePage, type MobileProjectScopedPageParams} from '../usePageStack'
import './MobileTypeTagManager.css'

interface Props {
    push: (page: MobilePage) => void
    pop: () => void
    params: MobileProjectScopedPageParams
}

export default function MobileEntryTypeManager({push, pop, params}: Props) {
    const projectId = params.projectId

    // 类型列表改读项目详情 store：编辑页保存后 invalidate，这里自动跟上，
    // 不再各自 db_list_* 一份。
    const {entryTypes: allEntryTypes, loading, hasLoaded} = useProjectDetailStore(projectId)
    const [builtinExpanded, setBuiltinExpanded] = useState(true)

    const openEditor = (type: CustomEntryType | null = null) => {
        push({
            type: 'typeEditor',
            params: {projectId, entryTypeId: type?.id, displayName: type ? '编辑词条类型' : '新建词条类型'},
        })
    }
    const builtinTypes = allEntryTypes.filter((type): type is Extract<EntryTypeView, {kind: 'builtin'}> => type.kind === 'builtin')
    const customTypes = allEntryTypes.filter((type): type is {kind: 'custom'} & CustomEntryType => type.kind === 'custom')

    return (
        <div className="mobile-page mobile-type-tag">
            <MobilePageTopBar
                sticky
                edgeToEdge
                ariaLabel="类型管理操作"
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
                        label: '新建类型',
                        icon: <MobileAddIcon/>,
                        kind: 'add',
                        onClick: () => openEditor(null),
                    }]}
                />}
            />
            <div className="mobile-type-tag__heading">
                <span className="mobile-page__eyebrow mobile-type-tag__eyebrow">{loading && !hasLoaded ? '正在同步' : `${allEntryTypes.length} 个类型`}</span>
                <h2 className="mobile-page__hero-title">类型管理</h2>
            </div>

            {loading && !hasLoaded ? (
                <div className="mobile-page__loading">加载中…</div>
            ) : (
                <div className="mobile-type-tag__list">
                    <button
                        type="button"
                        className="mobile-type-tag__section-toggle"
                        aria-expanded={builtinExpanded}
                        onClick={() => setBuiltinExpanded(expanded => !expanded)}
                    >
                        <span>内置类型</span>
                        <span className="mobile-type-tag__section-toggle-meta">{builtinTypes.length}</span>
                        <svg
                            className={`mobile-type-tag__section-toggle-icon${builtinExpanded ? ' is-expanded' : ''}`}
                            viewBox="0 0 20 20"
                            focusable="false"
                            aria-hidden="true"
                        >
                            <path d="M6 8 10 12l4-4"/>
                        </svg>
                    </button>
                    {builtinExpanded && builtinTypes.map(type => (
                        <div
                            className="mobile-list-card mobile-type-tag__type-card mobile-type-tag__type-card--readonly"
                            key={type.key}
                        >
                            <span className="mobile-list-card__row">
                                <span className="mobile-list-card__main">
                                    <span className="mobile-list-card__title mobile-type-tag__type-title">
                                        <EntryTypeIcon entryType={type} className=""/> {type.name}
                                    </span>
                                    <span className="mobile-list-card__description">{type.description}</span>
                                </span>
                                <span className="mobile-list-card__tag mobile-type-tag__value-tag">内置</span>
                            </span>
                        </div>
                    ))}

                    <div className="mobile-type-tag__section-label">自定义类型</div>
                    {customTypes.length === 0 ? (
                        <div className="mobile-page__empty mobile-type-tag__empty">还没有自定义类型（内置类型始终可用）</div>
                    ) : customTypes.map(type => (
                        <button
                            type="button"
                            className="mobile-list-card"
                            key={type.id}
                            onClick={() => openEditor(type)}
                        >
                            <span className="mobile-list-card__row">
                                <span className="mobile-list-card__main">
                                    <span className="mobile-list-card__title mobile-type-tag__type-title">
                                        <EntryTypeIcon entryType={type} className=""/> {type.name}
                                    </span>
                                    {type.description && <span className="mobile-list-card__description">{type.description}</span>}
                                </span>
                                <span className="mobile-list-card__tag mobile-type-tag__value-tag">自定义</span>
                            </span>
                        </button>
                    ))}
                </div>
            )}

        </div>
    )
}
