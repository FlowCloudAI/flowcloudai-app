import {useCallback} from 'react'
import ProjectTimeline from '../../../features/project-editor/components/ProjectTimeline'
import {useProjectDetailStore} from '../../../features/projects/projectDetailStore'
import {
    MobileBackIcon,
    MobilePageTopBar,
    MobileTopActionPill,
} from '../components/MobileTopControls'
import type {MobilePage, MobileProjectScopedPageParams} from '../usePageStack'
import './MobileTimeline.css'

interface Props {
    params: MobileProjectScopedPageParams
    push: (page: MobilePage) => void
    pop: () => void
}

/** 移动端时间线外壳；数据识别与旗帜布局继续复用桌面端的同一套实现。 */
export default function MobileTimeline({params, push, pop}: Props) {
    const {tagSchemas} = useProjectDetailStore(params.projectId)
    const handleOpenEntry = useCallback((entry: {id: string; title: string}) => {
        push({
            type: 'entryDetail',
            params: {
                projectId: params.projectId,
                entryId: entry.id,
                displayName: entry.title,
                mode: 'view',
            },
        })
    }, [params.projectId, push])

    return (
        <div className="mobile-page mobile-nav-safe-fixed mobile-timeline-page">
            <MobilePageTopBar
                className="mobile-timeline-page__topbar"
                center={<h1 className="mobile-timeline-page__title">时间线</h1>}
                left={(
                    <MobileTopActionPill actions={[{
                        key: 'back',
                        label: '返回项目',
                        icon: <MobileBackIcon/>,
                        onClick: pop,
                    }]}/>
                )}
                ariaLabel="时间线操作"
            />
            <div className="mobile-timeline-page__content">
                <ProjectTimeline
                    projectId={params.projectId}
                    tagSchemas={tagSchemas}
                    onOpenEntry={handleOpenEntry}
                    scrollableRows
                    compact
                />
            </div>
        </div>
    )
}
