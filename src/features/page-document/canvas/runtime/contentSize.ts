// 本模块只测量作者内容根的滚动尺寸；不得把 iframe 视口或根节点边框反馈成下一轮视口高度。

import {CANVAS_DIMENSION_MAX} from '../protocol/index.ts'

export interface CanvasContentRoot {
    scrollWidth: number
    scrollHeight: number
}

export interface CanvasContentSize {
    width: number
    height: number
}

function boundedDimension(value: number): number {
    if (!Number.isFinite(value)) return 0
    return Math.min(CANVAS_DIMENSION_MAX, Math.max(0, Math.ceil(value)))
}

export function measureCanvasContentSize(root: CanvasContentRoot): CanvasContentSize {
    return {
        width: boundedDimension(root.scrollWidth),
        height: boundedDimension(root.scrollHeight),
    }
}
