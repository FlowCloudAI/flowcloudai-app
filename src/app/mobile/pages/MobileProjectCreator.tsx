/**
 * 新建世界观页。表单本体与桌面共用 ProjectCreatorForm，这里只提供页面外壳——
 * 名称与描述都是输入型重操作，手机上不进浮层。
 *
 * 创建成功后先 pop 掉本页，再把新项目按 token 回递给打开它的页面，
 * 由它决定跳到项目主页还是留在原地（页面栈用 ref 同步维护，pop→push 顺序可靠）。
 */
import {useCallback, useState} from 'react'
import {type Project} from '../../../api'
import {ProjectCreatorForm} from '../../../features/projects/components/ProjectCreator'
import {publishMobileEditorResult} from '../stores/mobileEditorHandoff'
import {MobileBackIcon, MobilePageTopBar, MobileTopActionPill} from '../components/MobileTopControls'
import {type MobileProjectCreatorPageParams} from '../usePageStack'
import './MobileSubEditor.css'

interface Props {
    pop: () => void
    params: MobileProjectCreatorPageParams
}

export default function MobileProjectCreator({pop, params}: Props) {
    const [busy, setBusy] = useState(false)

    const handleCreated = useCallback((project: Project) => {
        pop()
        if (params.resultToken) publishMobileEditorResult(params.resultToken, project)
    }, [params.resultToken, pop])

    return (
        <div className="mobile-page mobile-sub-editor">
            <MobilePageTopBar
                sticky
                edgeToEdge
                ariaLabel="新建世界观"
                left={<MobileTopActionPill
                    actions={[{
                        key: 'back',
                        label: '返回',
                        icon: <MobileBackIcon/>,
                        disabled: busy,
                        onClick: pop,
                    }]}
                />}
            />
            <div className="mobile-sub-editor__heading">
                <h2 className="mobile-page__hero-title">新建世界观</h2>
            </div>
            <ProjectCreatorForm
                open
                existingNames={params.existingNames ?? []}
                onClose={pop}
                onBusyChange={setBusy}
                onCreated={handleCreated}
            />
        </div>
    )
}
