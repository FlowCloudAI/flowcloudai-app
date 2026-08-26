/*
 * 移动端沉浸正文编辑器：通过全屏 Portal 隔离下层页面，并承载常用 Markdown 工具。
 *
 * 键盘布局只消费原生发布的 `--fc-kb`（见 AGENTS.md §5.1「键盘只能有一个 owner」）。
 * 2026-08-24 之前这里另用 visualViewport 写高度并平移整层，与编辑页/属性页的
 * `--fc-kb` 路径并存，造成同一次键盘弹出两套动画；该实现已移除，不要重新引入。
 */
import {MarkdownEditor, type MarkdownEditorRef} from '../../../features/entries/components/MarkdownEditor/MarkdownEditor'
import Overlay from '../../../shared/ui/overlay/Overlay'
import {type ComponentProps, type ReactNode, type RefObject} from 'react'
import {
    MobileBackIcon,
    MobilePageTopBar,
    MobileTopActionPill,
} from '../components/MobileTopControls'
import {MOBILE_MARKDOWN_TOOLS, type MobileMarkdownTool} from './MobileEntryMarkdownToolModel'
import {MobileMarkdownToolIcon} from './MobileEntryMarkdownTools'

type MobileMarkdownEditorTextareaProps = NonNullable<ComponentProps<typeof MarkdownEditor>['textareaProps']>

interface MobileEntryImmersiveEditorProps {
    editorRef: RefObject<MarkdownEditorRef | null>
    content: string
    textareaProps: MobileMarkdownEditorTextareaProps
    wikiPanel: ReactNode
    isDirty: boolean
    saving: boolean
    onContentChange: (value: string) => void
    onClose: () => void
    onSave: () => void
    onMarkdownTool: (tool: MobileMarkdownTool) => void
}

export function MobileEntryImmersiveEditor({
    editorRef,
    content,
    textareaProps,
    wikiPanel,
    isDirty,
    saving,
    onContentChange,
    onClose,
    onSave,
    onMarkdownTool,
}: MobileEntryImmersiveEditorProps) {
    return (
        <Overlay
            open
            onClose={onClose}
            variant="fullscreen"
            layerClassName="mobile-entry-detail__immersive-layer"
            className="mobile-entry-detail__immersive-host"
            ariaLabel="沉浸正文编辑"
        >
            <div className="mobile-entry-detail__immersive">
                <MobilePageTopBar
                    className="mobile-entry-detail__immersive-topbar"
                    ariaLabel="沉浸正文编辑操作"
                    left={<MobileTopActionPill
                        actions={[{
                            key: 'close',
                            label: '退出沉浸编辑',
                            icon: <MobileBackIcon/>,
                            onClick: onClose,
                        }]}
                    />}
                    center={<div className="mobile-entry-detail__edit-heading">
                        <span>正文编辑</span>
                        <small>{isDirty ? '有未保存修改' : '已同步'}</small>
                    </div>}
                    right={<MobileTopActionPill
                        actions={[{
                            key: 'save',
                            label: saving ? '保存中' : '保存词条',
                            icon: <span className="mobile-top-action-pill__text">{saving ? '保存中…' : '保存'}</span>,
                            kind: 'text',
                            disabled: saving,
                            onClick: onSave,
                        }]}
                    />}
                />
                <div className="mobile-entry-detail__immersive-body">
                    <MarkdownEditor
                        ref={editorRef}
                        value={content}
                        onValueChange={onContentChange}
                        placeholder="正文内容…输入 [[ 插入词条双链"
                        autoHeight={false}
                        height="100%"
                        minHeight={420}
                        showSplitToggle={false}
                        hideFullscreen
                        toolbarCommands={[]}
                        extraCommands={[]}
                        textareaProps={{
                            ...textareaProps,
                            'aria-label': textareaProps['aria-label'] ?? '词条正文',
                        }}
                        tokens={{
                            background: 'transparent',
                            toolbarBackground: 'transparent',
                            borderColor: 'transparent',
                            editorTextBackground: 'transparent',
                            previewBackground: 'transparent',
                            textColor: 'var(--fc-color-text)',
                            mutedTextColor: 'var(--fc-color-text-secondary)',
                        }}
                        className="mobile-entry-detail__immersive-editor"
                    />
                    {wikiPanel}
                </div>
                <div
                    className="mobile-entry-detail__markdown-toolbar"
                    role="toolbar"
                    aria-label="Markdown 常用工具"
                    data-mobile-horizontal-scroll="true"
                >
                    {MOBILE_MARKDOWN_TOOLS.map(item => (
                        <button
                            key={item.tool}
                            type="button"
                            className="mobile-entry-detail__markdown-tool"
                            aria-label={item.label}
                            title={item.label}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => onMarkdownTool(item.tool)}
                        >
                            <MobileMarkdownToolIcon tool={item.tool}/>
                        </button>
                    ))}
                </div>
            </div>
        </Overlay>
    )
}
