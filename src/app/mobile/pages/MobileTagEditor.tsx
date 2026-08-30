/**
 * 标签新建/编辑页。
 *
 * 表单本体与桌面共用 TagCreatorForm，这里只提供页面外壳——输入型重操作在手机上
 * 不进浮层。保存后刷新项目详情 store，并按需把新对象回递给打开它的页面。
 */
import {useCallback, useState} from 'react'
import {type TagSchema} from '../../../api'
import {TagCreatorForm} from '../../../features/entries/components/TagCreator'
import {invalidateProjectDetail, useProjectDetailStore} from '../../../features/projects/projectDetailStore'
import {publishMobileEditorResult} from '../stores/mobileEditorHandoff'
import {MobileBackIcon, MobilePageTopBar, MobileTopActionPill} from '../components/MobileTopControls'
import {type MobileTagEditorPageParams} from '../usePageStack'
import './MobileSubEditor.css'

interface Props {
    pop: () => void
    params: MobileTagEditorPageParams
}

export default function MobileTagEditor({pop, params}: Props) {
    const projectId = params.projectId
    const {entryTypes, tagSchemas} = useProjectDetailStore(projectId)
    const [busy, setBusy] = useState(false)
    const initialTag = params.tagId ? tagSchemas.find(schema => schema.id === params.tagId) ?? null : null

    const finish = useCallback((saved?: TagSchema) => {
        void invalidateProjectDetail(projectId)
        if (saved && params.resultToken) publishMobileEditorResult(params.resultToken, saved)
        pop()
    }, [params.resultToken, pop, projectId])

    return (
        <div className="mobile-page mobile-sub-editor">
            <MobilePageTopBar
                sticky
                edgeToEdge
                ariaLabel={initialTag ? '编辑标签' : '新建标签'}
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
                <h2 className="mobile-page__hero-title">{initialTag ? '编辑标签' : '新建标签'}</h2>
            </div>
            <TagCreatorForm
                open
                projectId={projectId}
                entryTypes={entryTypes}
                initialTag={initialTag}
                existingNames={tagSchemas
                    .filter(schema => schema.id !== initialTag?.id)
                    .map(schema => schema.name)}
                existingCount={tagSchemas.length}
                onClose={pop}
                onBusyChange={setBusy}
                onSaved={saved => finish(saved)}
                onDeleted={() => finish()}
            />
        </div>
    )
}
