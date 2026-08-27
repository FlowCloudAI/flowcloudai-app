/** 移动端词条 Markdown 工具栏：统一内联与沉浸编辑的结构、交互和图标。 */
import {MOBILE_MARKDOWN_TOOLS, type MobileMarkdownTool} from './MobileEntryMarkdownToolModel'

interface MobileEntryMarkdownToolbarProps {
    inline?: boolean
    onTool: (tool: MobileMarkdownTool) => void
}

export function MobileEntryMarkdownToolbar({inline = false, onTool}: MobileEntryMarkdownToolbarProps) {
    return (
        <div
            className="mobile-entry-detail__markdown-toolbar"
            role="toolbar"
            aria-label="Markdown 常用工具"
            data-inline={inline || undefined}
            data-mobile-horizontal-scroll="true"
        >
            {MOBILE_MARKDOWN_TOOLS.map(item => (
                <button
                    key={item.tool}
                    type="button"
                    className="mobile-entry-detail__markdown-tool"
                    aria-label={item.label}
                    title={item.label}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => onTool(item.tool)}
                >
                    <MobileMarkdownToolIcon tool={item.tool}/>
                </button>
            ))}
        </div>
    )
}

export function MobileMarkdownToolIcon({tool}: { tool: MobileMarkdownTool }) {
    if (tool === 'heading') return <span className="mobile-entry-detail__markdown-tool-text">H</span>
    if (tool === 'bold') return <span className="mobile-entry-detail__markdown-tool-text">B</span>
    if (tool === 'italic') return <span className="mobile-entry-detail__markdown-tool-text">I</span>
    if (tool === 'quote') {
        return (
            <svg className="mobile-entry-detail__markdown-tool-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M8 7H5.8C4.8 8.4 4.3 9.8 4.3 11.8v4.4H10v-5.7H7.1c.1-1 .4-2 1-3.5Z"/>
                <path d="M18 7h-2.2c-1 1.4-1.5 2.8-1.5 4.8v4.4H20v-5.7h-2.9c.1-1 .4-2 1-3.5Z"/>
            </svg>
        )
    }
    if (tool === 'list') {
        return (
            <svg className="mobile-entry-detail__markdown-tool-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M8 7h11"/>
                <path d="M8 12h11"/>
                <path d="M8 17h11"/>
                <path d="M4.5 7h.01"/>
                <path d="M4.5 12h.01"/>
                <path d="M4.5 17h.01"/>
            </svg>
        )
    }
    if (tool === 'link') {
        return (
            <svg className="mobile-entry-detail__markdown-tool-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M9.5 14.5 14.5 9.5"/>
                <path d="M10.5 7.5 12 6a4 4 0 0 1 5.7 5.7l-1.5 1.5"/>
                <path d="M13.5 16.5 12 18a4 4 0 0 1-5.7-5.7l1.5-1.5"/>
            </svg>
        )
    }
    if (tool === 'image') {
        return (
            <svg className="mobile-entry-detail__markdown-tool-svg" viewBox="0 0 24 24" focusable="false">
                <rect x="4" y="5" width="16" height="14" rx="2"/>
                <path d="m7 16 3.2-3.2 2.3 2.3 2.7-3.1L19 16"/>
                <path d="M8.5 8.8h.01"/>
            </svg>
        )
    }
    return <span className="mobile-entry-detail__markdown-tool-text">[[</span>
}
