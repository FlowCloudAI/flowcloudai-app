// 本模块提供页面组件树专用 SVG 图标；图标只表达结构类型，尺寸和颜色均由宿主 CSS 控制。

import type {LayerProjectionKind} from '../../domain/layerProjection.ts'
import type {ReactNode} from 'react'

function IconFrame({children}: {children: ReactNode}) {
    return (
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            {children}
        </svg>
    )
}

export function PageDocumentDisclosureIcon({expanded}: {expanded: boolean}) {
    return (
        <IconFrame>
            <path
                d={expanded ? 'M5.5 7.5 10 12l4.5-4.5' : 'M7.5 5.5 12 10l-4.5 4.5'}
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.7"
            />
        </IconFrame>
    )
}

export function PageDocumentLayerKindIcon({kind}: {kind: LayerProjectionKind}) {
    if (kind === 'container') return <IconFrame><rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M6 8h8M6 11h5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5"/></IconFrame>
    if (kind === 'paragraph') return <IconFrame><path d="M7 4.5h5.5M9.5 4.5v11M12.5 4.5v11" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5"/></IconFrame>
    if (kind === 'heading') return <IconFrame><path d="M5 5v10M15 5v10M5 10h10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7"/></IconFrame>
    if (kind === 'asset') return <IconFrame><rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5"/><circle cx="7" cy="8" r="1.2" fill="currentColor"/><path d="m5 14 3.3-3 2.2 2 1.8-1.6L15 14" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4"/></IconFrame>
    if (kind === 'gallery') return <IconFrame><rect x="3" y="5" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="M7 3.5h8a1.5 1.5 0 0 1 1.5 1.5v8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4"/><path d="m5 13 2.5-2.5 3 3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.3"/></IconFrame>
    if (kind === 'list') return <IconFrame><circle cx="5" cy="6" r="1" fill="currentColor"/><circle cx="5" cy="10" r="1" fill="currentColor"/><circle cx="5" cy="14" r="1" fill="currentColor"/><path d="M8 6h7M8 10h7M8 14h7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5"/></IconFrame>
    if (kind === 'list-item') return <IconFrame><circle cx="5" cy="10" r="1.2" fill="currentColor"/><path d="M8 7h7M8 10h7M8 13h5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5"/></IconFrame>
    if (kind === 'table') return <IconFrame><rect x="3" y="4" width="14" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="M3 8h14M8 4v12M13 4v12" fill="none" stroke="currentColor" strokeWidth="1.3"/></IconFrame>
    if (kind === 'table-cell') return <IconFrame><rect x="4" y="5" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M4 9h12" fill="none" stroke="currentColor" strokeWidth="1.4"/></IconFrame>
    if (kind === 'divider') return <IconFrame><path d="M3 10h14" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7"/></IconFrame>
    if (kind === 'operation') return <IconFrame><path d="M7.5 4.5 3.5 10l4 5.5M12.5 4.5l4 5.5-4 5.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"/></IconFrame>
    return <IconFrame><path d="M5 3.5h7l3 3v10H5z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.4"/><path d="M12 3.5v3h3M7.5 10h5M7.5 13h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3"/></IconFrame>
}
