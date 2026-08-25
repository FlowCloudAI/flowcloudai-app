/** 词条详情专用线性图标；方向箭头与关系语义保持一一对应。 */
export function MobileEntryDetailActionIcon({type}: { type: 'ai' | 'edit' | 'more' | 'check' | 'delete' | 'save' | 'expand' | 'relation-outgoing' | 'relation-incoming' | 'relation-two-way' | 'link-outgoing' | 'link-incoming' | 'chevron' }) {
    if (type === 'ai') {
        return (
            <svg className="mobile-entry-detail__action-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M12 3.5c1.8 4.4 3.4 6 8 8-4.6 2-6.2 3.6-8 8-1.8-4.4-3.4-6-8-8 4.6-2 6.2-3.6 8-8Z"/>
            </svg>
        )
    }
    if (type === 'edit') {
        return (
            <svg className="mobile-entry-detail__action-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M5 19h4.1L18.7 9.4a2.2 2.2 0 0 0-3.1-3.1L6 15.9 5 19Z"/>
                <path d="m14.5 7.5 2 2"/>
            </svg>
        )
    }
    if (type === 'check') {
        return (
            <svg className="mobile-entry-detail__action-svg" viewBox="0 0 24 24" focusable="false">
                <path d="m5.5 12.5 4.1 4.1 8.9-9.2"/>
            </svg>
        )
    }
    if (type === 'save') {
        return (
            <svg className="mobile-entry-detail__action-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M6 4.5h10.2L18 6.3V18a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 18V4.5Z"/>
                <path d="M8.5 4.5v5h7"/>
                <path d="M8.5 19.5v-6h7v6"/>
            </svg>
        )
    }
    if (type === 'expand') {
        return (
            <svg className="mobile-entry-detail__action-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M9 5H5v4"/>
                <path d="m5 5 5 5"/>
                <path d="M15 19h4v-4"/>
                <path d="m19 19-5-5"/>
            </svg>
        )
    }
    if (type === 'delete') {
        return (
            <svg className="mobile-entry-detail__action-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M5.5 7h13"/>
                <path d="M9 7V5.5h6V7"/>
                <path d="M8 10v8"/>
                <path d="M12 10v8"/>
                <path d="M16 10v8"/>
                <path d="M7 7.5 8 20h8l1-12.5"/>
            </svg>
        )
    }
    if (type === 'relation-outgoing' || type === 'link-outgoing') {
        return (
            <svg className="mobile-entry-detail__action-svg" viewBox="0 0 24 24" focusable="false">
                <path d={type === 'link-outgoing' ? 'M6 18 18 6M10 6h8v8' : 'M5 12h14M14 7l5 5-5 5'}/>
            </svg>
        )
    }
    if (type === 'relation-incoming' || type === 'link-incoming') {
        return (
            <svg className="mobile-entry-detail__action-svg" viewBox="0 0 24 24" focusable="false">
                <path d={type === 'link-incoming' ? 'M18 6 6 18M14 18H6v-8' : 'M19 12H5m5-5-5 5 5 5'}/>
            </svg>
        )
    }
    if (type === 'relation-two-way') {
        return (
            <svg className="mobile-entry-detail__action-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M5 9h14m-4-4 4 4-4 4M19 15H5m4 4-4-4 4-4"/>
            </svg>
        )
    }
    if (type === 'chevron') {
        return (
            <svg className="mobile-entry-detail__action-svg" viewBox="0 0 24 24" focusable="false">
                <path d="m8 10 4 4 4-4"/>
            </svg>
        )
    }
    return (
        <svg className="mobile-entry-detail__action-svg" viewBox="0 0 24 24" focusable="false">
            <path d="M6.5 12h.01"/>
            <path d="M12 12h.01"/>
            <path d="M17.5 12h.01"/>
        </svg>
    )
}
