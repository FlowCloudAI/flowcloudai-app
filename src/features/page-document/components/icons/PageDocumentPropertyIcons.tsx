// 本模块提供属性调节控件专用 SVG 图标；按钮语义由调用方提供，图形只继承宿主颜色。

import type {ReactNode} from 'react'

function IconFrame({children}: {children: ReactNode}) {
    return <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">{children}</svg>
}

export function PageDocumentStepIcon({direction}: {direction: -1 | 1}) {
    return (
        <IconFrame>
            <path d="M4.5 10h11" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7"/>
            {direction === 1 && <path d="M10 4.5v11" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7"/>}
        </IconFrame>
    )
}

export function PageDocumentLinkIcon({linked}: {linked: boolean}) {
    return (
        <IconFrame>
            <path d="M8.2 12.7 6.8 14a3 3 0 0 1-4.2-4.2l2.6-2.6a3 3 0 0 1 4.2 0" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5"/>
            <path d="m11.8 7.3 1.4-1.4a3 3 0 0 1 4.2 4.2l-2.6 2.6a3 3 0 0 1-4.2 0" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5"/>
            {linked ? (
                <path d="m7.2 12.8 5.6-5.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5"/>
            ) : (
                <path d="m4.5 4.5 11 11" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5"/>
            )}
        </IconFrame>
    )
}

export function PageDocumentColorIcon() {
    return (
        <IconFrame>
            <path d="M10 3.2c2.7 3.2 4.5 5.4 4.5 8A4.5 4.5 0 1 1 5.5 11.2c0-2.6 1.8-4.8 4.5-8Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5"/>
        </IconFrame>
    )
}
