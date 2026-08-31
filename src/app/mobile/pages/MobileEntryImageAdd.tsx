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
import {readProvidedMobilePageProps, type RequireExplicitProps} from './useMobilePageProps'
import {type MobileEntryImageAddPageParams} from '../usePageStack'
import './MobileSubEditor.css'

/**
 * 外壳自己决定的部分不从桥上取。mode 也不走桥：它是打开那一刻才定的，
 * 而桥要等打开方下一次 commit 后的 effect 才刷新（见 usePageStack 的 MobileEntryImageAddPageParams）。
 */
export type MobileEntryImageAddBridgedProps = RequireExplicitProps<
    Omit<EntryImageAddFormProps, 'open' | 'onClose' | 'onBusyChange' | 'mode'>
>

interface Props {
    pop: () => void
    params: MobileEntryImageAddPageParams
}

export default function MobileEntryImageAdd({pop, params}: Props) {
    const [busy, setBusy] = useState(false)
    const bridged = readProvidedMobilePageProps<MobileEntryImageAddBridgedProps>(params.propsToken)
    const mode = params.mode ?? 'add'
    const pageTitle = mode === 'insert' ? '插入图片' : '添加图片'

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
                ariaLabel={pageTitle}
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
                <h2 className="mobile-page__hero-title">{pageTitle}</h2>
            </div>
            <EntryImageAddForm {...bridged} mode={mode} open onClose={pop} onBusyChange={setBusy}/>
        </div>
    )
}
