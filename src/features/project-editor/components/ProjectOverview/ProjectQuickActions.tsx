import {memo, type ReactNode} from 'react'
import {DashboardActionList} from './ProjectDashboard/ProjectDashboardParts'
import {ConflictIcon, RelationGraphIcon, TimelineIcon, WorldMapIcon} from './ProjectToolIcons'
import {buildProjectQuickActionItems, type ProjectQuickActionInput} from './ProjectDashboard/ProjectDashboardModel'
import './ProjectDashboard/ProjectDashboard.css'
import './ProjectDashboard/ProjectDashboardControls.css'
import './ProjectQuickActions.css'

const QUICK_ACTION_ICONS: Record<string, ReactNode> = {
    relation: <RelationGraphIcon/>,
    timeline: <TimelineIcon/>,
    map: <WorldMapIcon/>,
    contradiction: <ConflictIcon/>,
}

function ProjectQuickActions(props: ProjectQuickActionInput) {
    const items = buildProjectQuickActionItems(props).map(item => ({
        ...item,
        icon: QUICK_ACTION_ICONS[item.key],
    }))
    return (
        <section className="pe-quick-actions" data-tour-id="project-overview-tools">
            <article className="pe-dashboard-panel">
                <div className="pe-dashboard-panel__header">
                    <h3>高级工具</h3>
                </div>
                <DashboardActionList items={items}/>
            </article>
        </section>
    )
}

export default memo(ProjectQuickActions)
