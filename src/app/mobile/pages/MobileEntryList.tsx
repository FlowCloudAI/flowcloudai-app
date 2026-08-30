/**
 * 词条列表页：顶栏 + 标题 + 词条浏览区。
 * 浏览区（搜索、类型筛选、网格、分页）与项目主页底部的「全部词条」共用
 * MobileEntryBrowser / useMobileEntryBrowser，本文件只负责页面外壳与导航。
 */
import {logger} from '../../../shared/logger'
import {useRef, useState} from 'react'
import {Button} from 'flowcloudai-ui'
import {db_create_entry, type EntryBrief, formatApiError, toApiError} from '../../../api'
import {type MobileEntryListPageParams, type MobilePage} from '../usePageStack'
import {type AiFocus} from '../../../features/ai-chat/hooks/useAiController'
import {MobileAddIcon, MobileBackIcon, MobileMenuIcon, MobilePageTopBar, MobileTopActionPill} from '../components/MobileTopControls'
import {useMobilePageScrollMemory} from '../useMobilePageScrollMemory'
import MobileEntryBrowser from './MobileEntryBrowser'
import {useMobileEntryBrowser} from './useMobileEntryBrowser'
import './MobileEntryList.css'

interface Props {
    push: (page: MobilePage) => void
    pop: () => void
    setAiFocus: (focus: AiFocus) => void
    pageKey: string
    categoryDrawerOpen?: boolean
    onOpenCategoryDrawer?: () => void
    params: MobileEntryListPageParams
}

export default function MobileEntryList({push, pop, setAiFocus, pageKey, categoryDrawerOpen = false, onOpenCategoryDrawer, params}: Props) {
    const pageRef = useRef<HTMLDivElement>(null)
    useMobilePageScrollMemory(pageKey, pageRef)
    const projectId = params.projectId
    const uncategorizedOnly = Boolean(params.uncategorizedOnly)
    const categoryId = params.categoryId || null
    const listTitle = params.displayName || '全部词条'

    const [actionError, setActionError] = useState<string | null>(null)
    const browser = useMobileEntryBrowser({
        projectId,
        categoryId,
        uncategorizedOnly,
        memoryKey: pageKey,
        scrollRef: pageRef,
    })
    const {entries, total, currentPage, pageCount, loading, loadError, entryTypesError} = browser

    const handleCreateEntry = async () => {
        setActionError(null)
        try {
            const created = await db_create_entry({projectId, categoryId, title: '未命名词条'})
            setAiFocus({projectId, entryId: created.id})
            push({type: 'entryDetail', params: {projectId, entryId: created.id, displayName: '未命名词条', mode: 'edit', isPlaceholder: true}})
        } catch (e) {
            logger.error('新建词条失败', e)
            setActionError(formatApiError(toApiError(e)))
        }
    }

    const handleOpenEntry = (entry: EntryBrief) => {
        setAiFocus({projectId, entryId: entry.id})
        push({type: 'entryDetail', params: {projectId, entryId: entry.id, displayName: entry.title}})
    }

    return (
        <div ref={pageRef} className="mobile-page mobile-entry-list">
            <MobilePageTopBar
                className="mobile-entry-list__topbar"
                sticky
                edgeToEdge
                ariaLabel="词条列表操作"
                left={<MobileTopActionPill
                    actions={[
                        {
                            key: 'back',
                            label: '返回',
                            icon: <MobileBackIcon/>,
                            onClick: pop,
                        },
                        {
                            key: 'categories',
                            label: '打开分类树',
                            icon: <MobileMenuIcon/>,
                            ariaExpanded: categoryDrawerOpen,
                            onClick: () => onOpenCategoryDrawer?.(),
                        },
                    ]}
                />}
                right={<MobileTopActionPill
                    actions={[
                        {
                            key: 'create',
                            label: '新建词条',
                            icon: <MobileAddIcon/>,
                            kind: 'add',
                            onClick: () => void handleCreateEntry(),
                        },
                    ]}
                />}
            />

            {(actionError || (loadError && entries.length > 0) || entryTypesError) && (
                <div className="mobile-page__error-banner" role="alert">
                    <span>
                        {actionError
                            ? `新建词条失败：${actionError}`
                            : loadError
                                ? `词条列表刷新失败：${loadError}`
                                : `词条类型加载失败：${entryTypesError}`}
                    </span>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => actionError ? void handleCreateEntry() : browser.retry()}
                    >
                        重试
                    </Button>
                </div>
            )}

            <div className="mobile-entry-list__hero">
                {/*
                  * 显示后端 count 的真实总数，而不是本页条数——分页后两者不相等，
                  * 拿 entries.length 当总数会在大项目里直接谎报。
                  */}
                <span className="mobile-page__eyebrow mobile-entry-list__eyebrow">
                    {loading
                        ? '正在同步'
                        : pageCount > 1
                            ? `${total ?? entries.length} 个词条 · 第 ${currentPage} / ${pageCount} 页`
                            : `${total ?? entries.length} 个词条`}
                </span>
                <h2 className="mobile-page__hero-title">{listTitle}</h2>
            </div>

            <MobileEntryBrowser
                projectId={projectId}
                state={browser}
                onOpenEntry={handleOpenEntry}
                onCreateEntry={() => void handleCreateEntry()}
            />
        </div>
    )
}
