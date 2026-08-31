import {useCallback, useId, useRef, useState} from 'react'
import ProjectRelationGraph from '../../../features/relation-graph/components/ProjectRelationGraph'
import {
    MobileAnchoredActionMenu,
    MobileBackIcon,
    MobileMoreIcon,
    MobilePageTopBar,
    MobileTopActionPill,
} from '../components/MobileTopControls'
import type {MobilePage, MobileProjectScopedPageParams} from '../usePageStack'
import {useProvideMobilePageProps} from './useMobilePageProps'
import {type MobileRelationGraphPanelBridgedProps} from './MobileRelationGraphPanels'
import './MobileRelationGraph.css'

interface Props {
    params: MobileProjectScopedPageParams
    push: (page: MobilePage) => void
    pop: () => void
}

/**
 * 移动端关系图谱外壳。
 *
 * 画布、关系索引与布局参数都复用桌面端的 ProjectRelationGraph；后两者是重内容，
 * 按移动端约定进独立子页（见 MobileRelationGraphPanels），本页只负责顶栏与 portal 容器。
 *
 * 组件自带的标题栏在这里关掉：那排动作已经搬进顶栏的更多菜单，其中的「刷新」不再提供——
 * 数据在进页时加载，图谱没有会在后台变化的外部数据源，留一颗刷新只是在暗示它会不同步。
 */
export default function MobileRelationGraph({params, push, pop}: Props) {
    const tokenBase = useId()
    const indexToken = `${tokenBase}-index`
    const layoutToken = `${tokenBase}-layout`
    const [relationsHost, setRelationsHost] = useState<HTMLDivElement | null>(null)
    const [layoutHost, setLayoutHost] = useState<HTMLDivElement | null>(null)
    const [menuOpen, setMenuOpen] = useState(false)
    const menuAnchorRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    /*
     * 子页把自己的容器交回来，本页据此决定把哪一块 portal 过去。
     * 子页卸载时 ref 回调会带着 null 再调一次，容器自然收回，不用另外清理。
     */
    useProvideMobilePageProps<MobileRelationGraphPanelBridgedProps>(indexToken, {
        onHostReady: setRelationsHost,
    })
    useProvideMobilePageProps<MobileRelationGraphPanelBridgedProps>(layoutToken, {
        onHostReady: setLayoutHost,
    })

    const openIndexPage = useCallback(() => {
        push({type: 'relationIndex', params: {propsToken: indexToken, displayName: '关系索引'}})
    }, [indexToken, push])

    const openLayoutPage = useCallback(() => {
        push({type: 'relationLayout', params: {propsToken: layoutToken, displayName: '布局参数'}})
    }, [layoutToken, push])

    /** 只有关系索引页在栈顶时才回退：没开子页时 pop 会把图谱本身退掉。 */
    const handleRelationSelect = useCallback(() => {
        if (relationsHost) pop()
    }, [pop, relationsHost])

    const handleLayoutClose = useCallback(() => {
        if (layoutHost) pop()
    }, [layoutHost, pop])

    return (
        <div ref={containerRef} className="mobile-page mobile-nav-safe-fixed mobile-relation-graph-page">
            <MobilePageTopBar
                className="mobile-relation-graph-page__topbar"
                sticky
                center={<h1 className="mobile-relation-graph-page__title">关系图谱</h1>}
                left={(
                    <MobileTopActionPill actions={[{
                        key: 'back',
                        label: '返回项目',
                        icon: <MobileBackIcon/>,
                        onClick: pop,
                    }]}/>
                )}
                right={(
                    <MobileTopActionPill
                        ref={menuAnchorRef}
                        actions={[{
                            key: 'more',
                            label: '更多操作',
                            icon: <MobileMoreIcon/>,
                            kind: 'more',
                            ariaHasPopup: 'menu',
                            ariaExpanded: menuOpen,
                            onClick: () => setMenuOpen(open => !open),
                        }]}
                    />
                )}
                ariaLabel="关系图谱操作"
            />
            <MobileAnchoredActionMenu
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
                anchorRef={menuAnchorRef}
                containerRef={containerRef}
                ariaLabel="关系图谱更多操作"
                items={[
                    {key: 'index', label: '关系索引', description: '按词条查看全部关系', onSelect: openIndexPage},
                    {key: 'layout', label: '布局参数', description: '调整排布松紧与力学参数', onSelect: openLayoutPage},
                ]}
            />
            <div className="mobile-relation-graph-page__graph" data-mobile-horizontal-scroll="true">
                <ProjectRelationGraph
                    projectId={params.projectId}
                    hideHeader
                    sidebarContainer={relationsHost}
                    layoutContainer={layoutHost}
                    onLayoutClose={handleLayoutClose}
                    onRelationSelect={handleRelationSelect}
                />
            </div>
        </div>
    )
}
