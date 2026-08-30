/**
 * 移动端分页条。桌面 ProjectList / CategoryView 的分页是同一套结构
 * （上一页 · 当前/总页 · 下一页），此处收成一个组件，供首页世界列表、项目列表、
 * 词条列表与插件管理共用，避免每处再抄一遍按钮与 aria-live。
 *
 * 只负责翻页交互，页大小与切片由调用方决定——各列表的数据来源不同：
 * 有的在客户端切片，有的直接按 offset 向后端取。
 */
import {Button} from 'flowcloudai-ui'
import './MobilePagination.css'

interface Props {
    page: number
    pageCount: number
    ariaLabel: string
    onPageChange: (page: number) => void
    /** 页数不足时保留占位高度；固定视口布局需要，普通滚动页不需要。 */
    keepPlaceholder?: boolean
    /** 圆角按钮，供设置页等已统一 full 圆角的区域使用。 */
    round?: boolean
    className?: string
}

export default function MobilePagination({
    page,
    pageCount,
    ariaLabel,
    onPageChange,
    keepPlaceholder = false,
    round = false,
    className,
}: Props) {
    const inactive = pageCount <= 1
    if (inactive && !keepPlaceholder) return null

    const radius = round ? 'full' : undefined
    return (
        <nav
            className={`mobile-pagination${inactive ? ' is-placeholder' : ''}${className ? ` ${className}` : ''}`}
            aria-label={ariaLabel}
            aria-hidden={inactive}
        >
            <Button
                type="button"
                size="sm"
                variant="outline"
                radius={radius}
                disabled={page <= 1}
                onClick={() => onPageChange(Math.max(1, page - 1))}
            >
                上一页
            </Button>
            <span className="mobile-pagination__indicator" aria-live="polite">{page} / {pageCount}</span>
            <Button
                type="button"
                size="sm"
                variant="outline"
                radius={radius}
                disabled={page >= pageCount}
                onClick={() => onPageChange(Math.min(pageCount, page + 1))}
            >
                下一页
            </Button>
        </nav>
    )
}
