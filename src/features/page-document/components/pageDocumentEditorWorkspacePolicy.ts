// 本模块决定常驻页面编辑器能否占用共享宿主，以及各工作区模式是否转交导航意图。

export type PageDocumentWorkspaceMode = 'visual' | 'display' | 'code'

export interface PageDocumentWorkspaceIdentity {
    projectId: string
    entryId: string
}

interface SharedHostOccupationInput<Host> {
    active: boolean
    editor: PageDocumentWorkspaceIdentity
    workspace: PageDocumentWorkspaceIdentity | null
    host: Host | null
}

export function shouldOccupyPageDocumentSharedHost<Host>(
    input: SharedHostOccupationInput<Host>,
): input is SharedHostOccupationInput<Host> & {workspace: PageDocumentWorkspaceIdentity; host: Host} {
    return Boolean(
        input.active &&
        input.host &&
        input.workspace?.entryId === input.editor.entryId &&
        input.workspace.projectId === input.editor.projectId,
    )
}

export function shouldForwardPageDocumentNavigation(mode: PageDocumentWorkspaceMode): boolean {
    return mode !== 'visual'
}
