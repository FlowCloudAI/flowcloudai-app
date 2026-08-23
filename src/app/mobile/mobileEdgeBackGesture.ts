/**
 * 移动端边缘返回手势的纯计算规则。
 * React 手势 hook 负责采样和动画，本模块只决定进度与结算，便于 iOS、Android 共用并独立测试。
 */

export const MOBILE_EDGE_BACK_GESTURE_TUNING = {
    /** 只有从屏幕左侧这段区域开始的右划才候选为返回。 */
    startWidth: 24,
    /** 慢速拖动需要越过屏宽的这一比例才提交，避免窄屏上固定 px 阈值过于敏感。 */
    commitDistanceRatio: 0.35,
    /** 即使 viewport 异常偏小，慢拖也至少需要这段距离。 */
    minCommitDistance: 120,
    /** iPad / 横屏上不让阈值无限增长，保留可达性。 */
    maxCommitDistance: 240,
    /** 快速右甩仍需先越过最小距离，避免贴边轻触被速度噪声误判。 */
    flingMinDistance: 24,
    /** 快速右甩的速度阈值，单位约为 px/ms。 */
    flingVelocity: 0.45,
    /** 取消后的回弹时长，与移动壳层 transform 过渡保持一致。 */
    settleDurationMs: 260,
} as const

export interface MobileEdgeBackSettleSample {
    distance: number
    directionX: number
    velocityX: number
    viewportWidth: number
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

/** 根据当前屏宽计算慢速拖动提交距离。 */
export function getMobileEdgeBackCommitDistance(viewportWidth: number): number {
    const ratioDistance = viewportWidth * MOBILE_EDGE_BACK_GESTURE_TUNING.commitDistanceRatio
    return clamp(
        ratioDistance,
        MOBILE_EDGE_BACK_GESTURE_TUNING.minCommitDistance,
        MOBILE_EDGE_BACK_GESTURE_TUNING.maxCommitDistance,
    )
}

/** 提交后旧页的终点是整个 viewport 宽度，不能误用更窄的侧边抽屉宽度。 */
export function getMobileEdgeBackCompletionDistance(viewportWidth: number): number {
    return Math.max(0, viewportWidth)
}

/** 返回 0～1 的可视进度；越过当前屏宽的提交阈值后保持为 1。 */
export function getMobileEdgeBackProgress(distance: number, viewportWidth: number): number {
    return clamp(distance / getMobileEdgeBackCommitDistance(viewportWidth), 0, 1)
}

/**
 * 抬手时统一结算：足够远直接提交；距离较短时，只有明确向右的快速甩动才提交。
 */
export function shouldCommitMobileEdgeBack({
    distance,
    directionX,
    velocityX,
    viewportWidth,
}: MobileEdgeBackSettleSample): boolean {
    if (distance >= getMobileEdgeBackCommitDistance(viewportWidth)) return true
    return directionX > 0
        && distance >= MOBILE_EDGE_BACK_GESTURE_TUNING.flingMinDistance
        && velocityX >= MOBILE_EDGE_BACK_GESTURE_TUNING.flingVelocity
}
