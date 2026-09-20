// 本组件只把一步式内置结构命令交给已绑定的插入函数；精确属性留在右侧任务窗格。

import {Heading2, List, Minus, Pilcrow, Rows3, Square} from 'lucide-react'
import type {BuiltInStructureKind} from '../../page-document/application/builtInStructureInsertion.ts'
import {DocumentRibbonCommand, DocumentRibbonGroup} from './DocumentOfficeRibbon.tsx'

const COMMANDS = Object.freeze([
    {kind: 'paragraph', label: '段落', icon: Pilcrow},
    {kind: 'heading', label: '标题', icon: Heading2},
    {kind: 'list', label: '列表', icon: List},
    {kind: 'table', label: '表格', icon: Rows3},
    {kind: 'divider', label: '分隔线', icon: Minus},
    {kind: 'container', label: '容器', icon: Square},
] satisfies readonly {kind: BuiltInStructureKind; label: string; icon: typeof Pilcrow}[])

export function BuiltInStructureRibbonControls({
    disabledReason,
    onInsert,
}: {
    readonly disabledReason: string | null
    readonly onInsert: (kind: BuiltInStructureKind) => void
}) {
    return <DocumentRibbonGroup
        disabledReason={disabledReason}
        label="内置结构"
        priority="essential"
        wide
    >
        {COMMANDS.map(command => <DocumentRibbonCommand
            key={command.kind}
            disabled={Boolean(disabledReason)}
            icon={command.icon}
            label={command.label}
            onClick={() => onInsert(command.kind)}
            title={disabledReason ?? `插入${command.label}`}
        />)}
    </DocumentRibbonGroup>
}
