/**
 * 高级工具的图标。桌面 ProjectQuickActions 与移动端项目主页的工具网格共用同一套线条，
 * 两端只是尺寸不同，尺寸由各自 CSS 决定，这里不写死宽高。
 *
 * 只导出图标本身，不导出「工具键 → 图标」的映射：两端的键名并不一致
 * （设定检测桌面叫 contradiction、移动端叫 check），各自映射比合并一张表更直白。
 */

export function RelationGraphIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="M8.1 8.4L12 12.3M15.9 8.4L12 12.3M12 12.3V16.4M8.2 17.4L12 16.4M15.8 17.4L12 16.4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <circle cx="7" cy="7.3" r="2.25" fill="currentColor"/>
            <circle cx="17" cy="7.3" r="2.25" fill="currentColor"/>
            <circle cx="12" cy="12.4" r="2.4" fill="currentColor"/>
            <circle cx="7.5" cy="17.6" r="2.05" fill="currentColor"/>
            <circle cx="16.5" cy="17.6" r="2.05" fill="currentColor"/>
        </svg>
    )
}

export function TimelineIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="M4.5 12H19.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
            />
            <path
                d="M7 8V12M12 12V16M17 8V12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
            />
            <circle cx="7" cy="12" r="2.2" fill="currentColor"/>
            <circle cx="12" cy="12" r="2.2" fill="currentColor"/>
            <circle cx="17" cy="12" r="2.2" fill="currentColor"/>
            <path
                d="M5.8 7.2H8.2M10.8 16.8H13.2M15.8 7.2H18.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
            />
        </svg>
    )
}

export function WorldMapIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="M4.5 6.4L9.2 4.9L14.8 6.4L19.5 4.9V17.6L14.8 19.1L9.2 17.6L4.5 19.1V6.4Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M9.2 4.9V17.6M14.8 6.4V19.1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
            />
            <path
                d="M7.1 10.4C8.8 9.5 10.2 9.9 11.6 11.2C13.2 12.7 15 12.9 17.1 11.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.65"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <circle cx="16.8" cy="8.6" r="1.35" fill="currentColor"/>
        </svg>
    )
}

export function ConflictIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="M12 4.7L20.2 18.9H3.8L12 4.7Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M12 9.4V13.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
            />
            <circle cx="12" cy="16.4" r="1.15" fill="currentColor"/>
            <path
                d="M7.3 15.1L9.6 12.8M16.7 15.1L14.4 12.8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}
