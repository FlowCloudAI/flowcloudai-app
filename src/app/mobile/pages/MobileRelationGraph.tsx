import {useState} from 'react'
import ProjectRelationGraph from '../../../features/relation-graph/components/ProjectRelationGraph'
import MobileBottomSheet from '../components/MobileBottomSheet'
import {
    MobileBackIcon,
    MobileMenuIcon,
    MobilePageTopBar,
    MobileTopActionPill,
} from '../components/MobileTopControls'
import type {MobileProjectScopedPageParams} from '../usePageStack'
import './MobileRelationGraph.css'

interface Props {
    params: MobileProjectScopedPageParams
    pop: () => void
}

/** 移动端关系图谱外壳；画布、布局参数和关系列表均复用桌面端能力。 */
export default function MobileRelationGraph({params, pop}: Props) {
    const [relationsOpen, setRelationsOpen] = useState(false)
    const [relationsHost, setRelationsHost] = useState<HTMLDivElement | null>(null)

    return (
        <div className="mobile-page mobile-nav-safe-fixed mobile-relation-graph-page">
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
                    <MobileTopActionPill actions={[{
                        key: 'relations',
                        label: '打开关系列表',
                        icon: <MobileMenuIcon/>,
                        ariaHasPopup: 'dialog',
                        ariaExpanded: relationsOpen,
                        onClick: () => setRelationsOpen(true),
                    }]}/>
                )}
                ariaLabel="关系图谱操作"
            />
            <div className="mobile-relation-graph-page__graph" data-mobile-horizontal-scroll="true">
                <ProjectRelationGraph
                    projectId={params.projectId}
                    sidebarContainer={relationsHost}
                    onRelationSelect={() => setRelationsOpen(false)}
                />
            </div>
            <MobileBottomSheet
                open={relationsOpen}
                onClose={() => setRelationsOpen(false)}
                ariaLabel="关系列表"
                className="mobile-relation-graph-page__sheet"
            >
                <h2 className="mobile-relation-graph-page__sheet-title">关系索引</h2>
                <div ref={setRelationsHost} className="mobile-relation-graph-page__relations-host"/>
            </MobileBottomSheet>
        </div>
    )
}
