// 桌面词条工作台只组织常驻顶栏、满高主体与浮层；草稿、保存和页面编辑状态仍由 EntryEditor 持有。

import {type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {Button} from 'flowcloudai-ui'
import {ActionMenu, FloatingPanel} from '../../../shared/ui/overlay'
import {
    setPageDocumentWorkbarHost,
    usePageDocumentWorkspace,
} from '../../page-document/editor/workspace/pageDocumentWorkspaceStore.ts'
import type {EntryEditorMode} from '../lib/entryEditorShortcutModel.ts'

interface EntryEditorWorkspaceProps {
    active: boolean
    entryId: string
    projectId: string
    editorMode: EntryEditorMode
    modeSwitch: ReactNode
    title: string
    titleEditingDisabled: boolean
    loading: boolean
    saving: boolean
    canSave: boolean
    saveStatus: {kind: string; text: string; detail?: string}
    toolbarExtras?: ReactNode
    informationPanel: ReactNode
    relationsPanel: ReactNode
    recoveryBanner?: ReactNode
    mainContent: ReactNode
    feedback?: ReactNode
    overlays?: ReactNode
    onBack?: () => void
    onTitleCommit: (title: string) => void
    onSave: () => void
    onDelete?: () => void
}

function EntryEditorTitleInput({
    value,
    disabled,
    onCommit,
}: {
    value: string
    disabled: boolean
    onCommit: (title: string) => void
}) {
    const [draft, setDraft] = useState(value)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => setDraft(value), [value])

    const commit = () => {
        if (draft !== value) onCommit(draft)
    }
    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault()
            inputRef.current?.blur()
        }
    }

    return <input
        ref={inputRef}
        className="entry-editor-workspace__title-input"
        aria-label="词条标题"
        value={draft}
        disabled={disabled}
        placeholder="未命名词条"
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
    />
}

export default function EntryEditorWorkspace({
    active,
    entryId,
    projectId,
    editorMode,
    modeSwitch,
    title,
    titleEditingDisabled,
    loading,
    saving,
    canSave,
    saveStatus,
    toolbarExtras,
    informationPanel,
    relationsPanel,
    recoveryBanner,
    mainContent,
    feedback,
    overlays,
    onBack,
    onTitleCommit,
    onSave,
    onDelete,
}: EntryEditorWorkspaceProps) {
    const [informationOpen, setInformationOpen] = useState(false)
    const [relationsOpen, setRelationsOpen] = useState(false)
    const [actionMenuOpen, setActionMenuOpen] = useState(false)
    const {active: activeWorkspace, relationsDockHost} = usePageDocumentWorkspace()
    const relationsPortalHost = active
        && editorMode === 'edit'
        && activeWorkspace?.projectId === projectId
        && activeWorkspace.entryId === entryId
        ? relationsDockHost
        : null

    useEffect(() => {
        setInformationOpen(false)
        setRelationsOpen(false)
        setActionMenuOpen(false)
    }, [active, editorMode, entryId])

    const actionItems = useMemo(() => [
        ...(editorMode === 'browse' ? [{
            key: 'entry-relations',
            label: '词条关系',
            onSelect: () => setRelationsOpen(true),
        }] : []),
        ...(onDelete ? [{
            key: 'delete-entry',
            label: '删除词条',
            danger: true,
            disabled: loading || saving,
            onSelect: onDelete,
        }] : []),
    ], [editorMode, loading, onDelete, saving])

    return <div className={`entry-editor-page is-${editorMode}`}>
        <header className="entry-editor-workspace__header">
            <div className="entry-editor-workspace__header-left">
                <button
                    type="button"
                    className="entry-editor-back-button"
                    onClick={onBack}
                    disabled={!onBack}
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M14.5 6.5L9 12l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8"
                              strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span>返回</span>
                </button>
                <EntryEditorTitleInput
                    value={title}
                    disabled={titleEditingDisabled}
                    onCommit={onTitleCommit}
                />
            </div>

            <div className="entry-editor-workspace__header-center">
                {modeSwitch}
                {active && editorMode === 'edit' && <div
                    className="entry-editor-workspace__page-workbar-host"
                    ref={setPageDocumentWorkbarHost}
                />}
            </div>

            <div className="entry-editor-workspace__toolbar-actions">
                {toolbarExtras}
                {editorMode === 'edit' && saveStatus.kind !== 'saved' && <span
                    className={`entry-editor-save-state is-${saveStatus.kind}`}
                    title={saveStatus.detail}
                    role={saveStatus.kind === 'error' ? 'alert' : 'status'}
                >{saveStatus.text}</span>}
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    radius="full"
                    onClick={() => setInformationOpen(true)}
                >词条信息</Button>
                {editorMode === 'edit' && (canSave || saving) && <Button
                    type="button"
                    size="sm"
                    radius="full"
                    disabled={!canSave}
                    onClick={onSave}
                >{saving ? '保存中…' : '保存词条信息'}</Button>}
                {actionItems.length > 0 && <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    radius="full"
                    className="entry-editor-more-button"
                    aria-label="更多词条操作"
                    disabled={loading || saving}
                    onClick={() => setActionMenuOpen(true)}
                >更多</Button>}
            </div>
        </header>

        <main className="entry-editor-workspace">
            <div className="entry-editor-workspace__body">
                {recoveryBanner}
                <div className={`entry-editor-workspace__document is-${editorMode}`}>
                    {mainContent}
                </div>
                {feedback}
            </div>
        </main>

        {relationsPortalHost && createPortal(
            <div className="entry-editor-relations-dock">{relationsPanel}</div>,
            relationsPortalHost,
        )}

        <FloatingPanel
            open={active && informationOpen}
            onClose={() => setInformationOpen(false)}
            title="词条信息"
            ariaLabel="词条信息"
            className="entry-editor-information-panel"
        >
            <div className="entry-editor-information-panel__body">{informationPanel}</div>
        </FloatingPanel>

        <FloatingPanel
            open={active && editorMode === 'browse' && relationsOpen}
            onClose={() => setRelationsOpen(false)}
            title="词条关系"
            ariaLabel="词条关系"
            className="entry-editor-relations-panel"
        >
            <div className="entry-editor-relations-panel__body">{relationsPanel}</div>
        </FloatingPanel>

        <ActionMenu
            open={active && actionMenuOpen}
            onClose={() => setActionMenuOpen(false)}
            title={title || '词条操作'}
            ariaLabel="更多词条操作"
            items={actionItems}
        />
        {overlays}
    </div>
}
