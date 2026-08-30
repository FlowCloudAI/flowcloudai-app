/**
 * 添加/插入图片页。表单本体与桌面共用 EntryImageAddForm——AI 提示词是输入型重操作，
 * 手机上不进浮层。
 *
 * 上传、拍照、写回草稿这些都是打开方手上的闭包，序列化不进页面参数，
 * 所以走 props 桥按 token 取（见 stores/mobileEditorHandoff 末尾）。
 */
import {useState} from 'react'
import {Button} from 'flowcloudai-ui'
import {
    EntryImageAddForm,
    type EntryImageAddFormProps,
} from '../../../features/entries/components/EntryImageAddModal'
import {MobileBackIcon, MobilePageTopBar, MobileTopActionPill} from '../components/MobileTopControls'
import {readProvidedMobilePageProps} from './useMobilePageProps'
import {type MobileBridgedPageParams} from '../usePageStack'
import './MobileSubEditor.css'

/** 外壳自己决定的部分不从桥上取。 */
export type MobileEntryImageAddBridgedProps = Omit<EntryImageAddFormProps, 'open' | 'onClose' | 'onBusyChange'>

interface Props {
    pop: () => void
    params: MobileBridgedPageParams
}

export default function MobileEntryImageAdd({pop, params}: Props) {
    const [busy, setBusy] = useState(false)
    const bridged = readProvidedMobilePageProps<MobileEntryImageAddBridgedProps>(params.propsToken)

    if (!bridged) {
        return (
            <div className="mobile-page__error" role="alert">
                <span>图片添加会话已结束，请返回词条重新进入。</span>
                <Button type="button" size="sm" variant="outline" onClick={pop}>返回</Button>
            </div>
        )
    }

    return (
        <div className="mobile-page mobile-sub-editor">
            <MobilePageTopBar
                sticky
                edgeToEdge
                ariaLabel={bridged.mode === 'insert' ? '插入图片' : '添加图片'}
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
                <h2 className="mobile-page__hero-title">{bridged.mode === 'insert' ? '插入图片' : '添加图片'}</h2>
            </div>
            <EntryImageAddForm {...bridged} open onClose={pop} onBusyChange={setBusy}/>
        </div>
    )
}
