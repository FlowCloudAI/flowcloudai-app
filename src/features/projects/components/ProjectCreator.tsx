import {useEffect, useState} from 'react'
import {Button, useAlert} from 'flowcloudai-ui'
import {db_create_project, formatApiError, type Project, toApiError} from '../../../api'
import {FloatingPanel} from '../../../shared/ui/overlay'
import {invalidateProjectList} from '../projectListStore'
import './ProjectCreator.css'

interface ProjectCreatorFormProps {
    /** 浮层用它做打开时重置；独立页面每次挂载都是新的，固定传 true。 */
    open: boolean
    onClose: () => void
    onCreated?: (project: Project) => void
    existingNames?: string[]
    /** 提交中状态回传给外壳：浮层据此禁用点背板关闭，页面据此禁用返回。 */
    onBusyChange?: (busy: boolean) => void
}

/**
 * 新建世界观的表单本体，不含浮层/页面外壳。
 * 桌面端包在 FloatingPanel 里（本文件默认导出），移动端包在独立页面里
 * （见 app/mobile/pages/MobileProjectCreator）。
 */
export function ProjectCreatorForm({open, onClose, onCreated, existingNames = [], onBusyChange}: ProjectCreatorFormProps) {
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [createDefaultTemplate, setCreateDefaultTemplate] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    const [apiError, setApiError] = useState<string | null>(null)
    const {showAlert} = useAlert()

    useEffect(() => {
        onBusyChange?.(submitting)
    }, [onBusyChange, submitting])

    useEffect(() => {
        if (open) {
            queueMicrotask(() => {
                setName('')
                setDescription('')
                setCreateDefaultTemplate(true)
                setApiError(null)
                setSubmitting(false)
            })
        }
    }, [open])

    const trimmedName = name.trim()
    const isDuplicate = trimmedName.length > 0 &&
        existingNames.some(n => n.trim().toLowerCase() === trimmedName.toLowerCase())
    const canSubmit = trimmedName.length > 0 && !isDuplicate && !submitting

    async function handleSubmit() {
        if (!canSubmit) return
        setSubmitting(true)
        setApiError(null)
        try {
            const project = await db_create_project({
                name: trimmedName,
                description: description.trim() || null,
                createDefaultTemplate,
            })
            void showAlert('世界观已创建', 'success', 'nonInvasive', 1000)
            void invalidateProjectList()
            onCreated?.(project)
            onClose()
        } catch (e) {
            setApiError(formatApiError(toApiError(e)))
            setSubmitting(false)
        }
    }

    return (
        <>
            <div className="project-creator-body">
                    <div className="project-creator-field">
                        <label className="project-creator-label">
                            世界观名称
                            <span className="project-creator-required" aria-hidden="true"> *</span>
                        </label>
                        <input
                            className="project-creator-input"
                            data-tour-id="project-creator-name"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') void handleSubmit()
                            }}
                            placeholder="给你的世界取个名字…"
                            disabled={submitting}
                            autoFocus
                            maxLength={120}
                        />
                        {isDuplicate && (
                            <p className="project-creator-field-hint error">已有同名世界观，请换一个名字</p>
                        )}
                    </div>

                    <div className="project-creator-field">
                        <label className="project-creator-label">简介</label>
                        <textarea
                            className="project-creator-textarea"
                            data-tour-id="project-creator-description"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="用一两句话描述这个世界…（可选）"
                            rows={3}
                            disabled={submitting}
                            maxLength={500}
                        />
                    </div>

                    <label className="project-creator-template-toggle" data-tour-id="project-creator-template">
                        <input
                            type="checkbox"
                            checked={createDefaultTemplate}
                            onChange={event => setCreateDefaultTemplate(event.target.checked)}
                            disabled={submitting}
                        />
                        <span className="project-creator-template-toggle__control" aria-hidden="true">
                            <span className="project-creator-template-toggle__thumb"/>
                        </span>
                        <span className="project-creator-template-toggle__text">
                            <span>创建默认模板</span>
                            <small>按内置类型创建分类，并添加常用标签</small>
                        </span>
                    </label>

                    {apiError && (
                        <p className="project-creator-api-error">创建失败：{apiError}</p>
                    )}
                </div>

                <div className="project-creator-footer">
                    <Button type="button" variant="ghost" size="sm" radius="full" onClick={onClose} disabled={submitting}>
                        取消
                    </Button>
                    <Button type="button" size="sm" radius="full" disabled={!canSubmit} onClick={() => void handleSubmit()} data-tour-id="project-creator-submit">
                        {submitting ? '创建中…' : '创建'}
                    </Button>
                </div>
        </>
    )
}

/** 桌面端的浮层外壳。表单本体见 ProjectCreatorForm。 */
export default function ProjectCreator(props: ProjectCreatorFormProps) {
    const [busy, setBusy] = useState(false)
    return (
        <FloatingPanel
            open={props.open}
            onClose={props.onClose}
            dismissible={!busy}
            title="新建世界观"
            ariaLabel="新建世界观"
            className="project-creator-dialog"
            dataTourId="project-creator-dialog"
        >
            <ProjectCreatorForm {...props} onBusyChange={setBusy}/>
        </FloatingPanel>
    )
}
