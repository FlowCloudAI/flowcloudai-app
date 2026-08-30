/**
 * 项目封面选择页。表单本体与桌面共用 ProjectCoverPickerForm；
 * 理由与 MobileEntryImageAdd 相同（AI 提示词是输入型重操作）。
 */
import {useState} from 'react'
import {Button} from 'flowcloudai-ui'
import {
    ProjectCoverPickerForm,
    type ProjectCoverPickerFormProps,
} from '../../../features/project-editor/components/ProjectCoverPicker/ProjectCoverPickerModal'
import {MobileBackIcon, MobilePageTopBar, MobileTopActionPill} from '../components/MobileTopControls'
import {readProvidedMobilePageProps} from './useMobilePageProps'
import {type MobileBridgedPageParams} from '../usePageStack'
import './MobileSubEditor.css'

export type MobileProjectCoverPickerBridgedProps =
    Omit<ProjectCoverPickerFormProps, 'open' | 'onClose' | 'onBusyChange'>

interface Props {
    pop: () => void
    params: MobileBridgedPageParams
}

export default function MobileProjectCoverPicker({pop, params}: Props) {
    const [busy, setBusy] = useState(false)
    const bridged = readProvidedMobilePageProps<MobileProjectCoverPickerBridgedProps>(params.propsToken)

    if (!bridged) {
        return (
            <div className="mobile-page__error" role="alert">
                <span>封面设置会话已结束，请返回项目重新进入。</span>
                <Button type="button" size="sm" variant="outline" onClick={pop}>返回</Button>
            </div>
        )
    }

    return (
        <div className="mobile-page mobile-sub-editor">
            <MobilePageTopBar
                sticky
                edgeToEdge
                ariaLabel="设置项目封面"
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
                <h2 className="mobile-page__hero-title">设置项目封面</h2>
                <p className="mobile-sub-editor__desc">可以从已有词条图片中选择，也可以上传或 AI 生成。</p>
            </div>
            <ProjectCoverPickerForm {...bridged} open onClose={pop} onBusyChange={setBusy}/>
        </div>
    )
}
