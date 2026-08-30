// 根据插件网格的实际可用高度计算分页容量，供桌面端与移动端插件管理复用。
import {useCallback, useEffect, useState} from 'react'

export function usePluginPageCapacity(active: boolean, contentSize: number, columns = 2) {
    const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
    const [list, setList] = useState<HTMLDivElement | null>(null)
    const [pageSize, setPageSize] = useState(columns)
    const viewportRef = useCallback((node: HTMLDivElement | null) => setViewport(node), [])
    const listRef = useCallback((node: HTMLDivElement | null) => setList(node), [])

    useEffect(() => {
        if (!active || !viewport || !list) return

        let measureFrame = 0
        const measure = () => {
            cancelAnimationFrame(measureFrame)
            measureFrame = requestAnimationFrame(() => {
                const items = Array.from(list.children).filter(
                    (item): item is HTMLElement => item instanceof HTMLElement,
                )
                if (items.length === 0) return

                const rowGap = Number.parseFloat(getComputedStyle(list).rowGap) || 0
                const rowHeight = Math.max(...items.map(item => item.getBoundingClientRect().height))
                const rows = Math.max(1, Math.round((viewport.clientHeight + rowGap) / (rowHeight + rowGap)))
                const nextPageSize = rows * columns
                setPageSize(current => current === nextPageSize ? current : nextPageSize)
            })
        }

        /*
         * 视口和列表都要观察。只观察视口时，首帧卡片还没排开（行高被量成很小的值），
         * 算出的每页条数偏大；之后卡片长高，视口尺寸没变，就再也不会重算——
         * 真机实测出现过 384px 的视口里塞 12 张、列表高 1231px 的情况。
         * 行高稳定后两边算出同一个值，setPageSize 的相等判断会让它收敛。
         */
        const observer = new ResizeObserver(measure)
        observer.observe(viewport)
        observer.observe(list)
        measure()

        return () => {
            observer.disconnect()
            cancelAnimationFrame(measureFrame)
        }
    }, [active, columns, contentSize, list, viewport])

    return {viewportRef, listRef, pageSize}
}
