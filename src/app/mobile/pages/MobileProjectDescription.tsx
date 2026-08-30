/**
 * 项目描述编辑页。
 *
 * 原先是项目主页里的一个 FloatingPanel，但输入型重操作不该放浮层：
 * 键盘一弹就要和浮层高度抢空间，返回键语义也和页面栈不一致。
 * 见 designs/mobile-ui-baseline.md 对浮层用途的约束。
 */
import {logger} from '../../../shared/logger'
import {useEffect, useRef, useState} from 'react'
import {Button, useAlert} from 'flowcloudai-ui'
import {db_update_project, formatApiError, toApiError} from '../../../api'
import {patchProjectDetail, useProjectDetailStore} from '../../../features/projects/projectDetailStore'
import {invalidateProjectList} from '../../../features/projects/projectListStore'
import type {MobileBeforeLeave} from '../mobileBackNavigation'
import {MobileBackIcon, MobilePageTopBar, MobileTopActionPill} from '../components/MobileTopControls'
import {type MobileProjectScopedPageParams} from '../usePageStack'
import './MobileProjectDescription.css'

interface Props {
    pop: () => void
    setBeforeLeave: (handler: MobileBeforeLeave | null) => void
    params: MobileProjectScopedPageParams
}

export default function MobileProjectDescription({pop, setBeforeLeave, params}: Props) {
    const projectId = params.projectId
    const {showAlert} = useAlert()
    const projectDetail = useProjectDetailStore(projectId)
    const project = projectDetail.project

    const initial = project?.description ?? ''
    // 初值等详情就位后才有；用 ref 记住是否已经把初值灌进过草稿，避免覆盖用户已输入的内容。
    const seededRef = useRef(false)
    const [draft, setDraft] = useState(initial)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (seededRef.current || !project) return
        seededRef.current = true
        setDraft(project.description ?? '')
    }, [project])

    const dirty = draft !== initial

    useEffect(() => {
        setBeforeLeave(async () => {
            if (!dirty) return true
            const result = await showAlert('未保存的描述将丢失，是否继续？', 'warning', 'confirm')
            return result === 'yes'
        })
        return () => setBeforeLeave(null)
    }, [dirty, setBeforeLeave, showAlert])

    const handleSave = async () => {
        setSaving(true)
        setError(null)
        try {
            const description = draft.trim() || null
            const updated = await db_update_project({id: projectId, description})
            patchProjectDetail(projectId, {description: updated.description ?? null})
            invalidateProjectList()
            // 先解除闸门再返回，否则保存成功还会弹一次「未保存」确认。
            setBeforeLeave(null)
            pop()
        } catch (e) {
            logger.error('保存项目描述失败', e)
            setError(`保存描述失败：${formatApiError(toApiError(e))}`)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="mobile-page mobile-project-description">
            <MobilePageTopBar
                sticky
                edgeToEdge
                ariaLabel="编辑项目描述"
                left={<MobileTopActionPill
                    actions={[{
                        key: 'back',
                        label: '返回',
                        icon: <MobileBackIcon/>,
                        disabled: saving,
                        onClick: pop,
                    }]}
                />}
                right={(
                    <Button
                        type="button"
                        size="sm"
                        radius="full"
                        disabled={saving || !dirty}
                        onClick={() => void handleSave()}
                    >
                        {saving ? '保存中…' : '保存'}
                    </Button>
                )}
            />

            <div className="mobile-project-description__heading">
                <span className="mobile-page__eyebrow">{project?.name ?? '项目'}</span>
                <h2 className="mobile-page__hero-title">项目描述</h2>
            </div>

            {error && <div className="mobile-page__error-banner" role="alert">{error}</div>}

            <textarea
                value={draft}
                aria-label="项目描述"
                className="mobile-project-description__input"
                placeholder="记录这个世界的设定基调、时间跨度或创作目标。"
                disabled={saving}
                onChange={event => setDraft(event.currentTarget.value)}
            />
        </div>
    )
}
