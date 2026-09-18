// 本组件保留行内样式功能区的稳定入口；文字选区消息尚未进入主仓协议，因此安全降级为禁用态。
import {Bold, Italic, Underline} from 'lucide-react'
import {DocumentRibbonCommand, DocumentRibbonGroup} from './DocumentOfficeRibbon.tsx'
import {INLINE_RIBBON_DISABLED_REASON} from './inlineRibbonStyleModel.ts'

export interface InlineRibbonStyleControlsProps {
    readonly disabledReason?: string
}

export function InlineRibbonStyleControls({
    disabledReason = INLINE_RIBBON_DISABLED_REASON,
}: InlineRibbonStyleControlsProps) {
    return (
        <DocumentRibbonGroup disabledReason={disabledReason} label="行内样式" priority="low">
            <DocumentRibbonCommand disabled icon={Bold} label="加粗" onClick={() => undefined} title={disabledReason} />
            <DocumentRibbonCommand disabled icon={Italic} label="斜体" onClick={() => undefined} title={disabledReason} />
            <DocumentRibbonCommand disabled icon={Underline} label="下划线" onClick={() => undefined} title={disabledReason} />
        </DocumentRibbonGroup>
    )
}
