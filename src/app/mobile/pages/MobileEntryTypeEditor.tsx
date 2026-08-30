/**
 * 词条类型新建/编辑页。表单本体与桌面共用 EntryTypeCreatorForm，
 * 这里只提供页面外壳；理由与 MobileTagEditor 相同。
 */
import {useCallback, useState} from 'react'
import {type CustomEntryType} from '../../../api'
import {EntryTypeCreatorForm} from '../../../features/entries/components/EntryTypeCreator'
import {invalidateProjectDetail, useProjectDetailStore} from '../../../features/projects/projectDetailStore'
import {publishMobileEditorResult} from '../stores/mobileEditorHandoff'
import {MobileBackIcon, MobilePageTopBar, MobileTopActionPill} from '../components/MobileTopControls'
import {type MobileEntryTypeEditorPageParams} from '../usePageStack'
import './MobileSubEditor.css'

interface Props {
    pop: () => void
    params: MobileEntryTypeEditorPageParams
}

export default function MobileEntryTypeEditor({pop, params}: Props) {
    const projectId = params.projectId
    const {entryTypes} = useProjectDetailStore(projectId)
    const [busy, setBusy] = useState(false)
    const initialEntryType = params.entryTypeId
        ? entryTypes.find((type): type is {kind: 'custom'} & CustomEntryType =>
            type.kind === 'custom' && type.id === params.entryTypeId) ?? null
        : null

    const finish = useCallback((saved?: CustomEntryType) => {
        void invalidateProjectDetail(projectId)
        if (saved && params.resultToken) publishMobileEditorResult(params.resultToken, saved)
        pop()
    }, [params.resultToken, pop, projectId])

    return (
        <div className="mobile-page mobile-sub-editor">
            <MobilePageTopBar
                sticky
                edgeToEdge
                ariaLabel={initialEntryType ? '编辑词条类型' : '新建词条类型'}
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
                <h2 className="mobile-page__hero-title">{initialEntryType ? '编辑词条类型' : '新建词条类型'}</h2>
            </div>
            <EntryTypeCreatorForm
                open
                projectId={projectId}
                initialEntryType={initialEntryType}
                existingNames={entryTypes
                    .filter(type => !(type.kind === 'custom' && type.id === initialEntryType?.id))
                    .map(type => type.name)}
                onClose={pop}
                onBusyChange={setBusy}
                onSaved={saved => finish(saved)}
                onDeleted={() => finish()}
            />
        </div>
    )
}
