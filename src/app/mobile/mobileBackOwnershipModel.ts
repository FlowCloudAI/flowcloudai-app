/**
 * 移动端返回入口的关闭所有权规则。
 * Alert 模态存在时，返回不应穿透到输入、浮层、抽屉或页面导航。
 */

export type MobileBackEntry = 'fallback' | 'predictive' | 'edge-gesture'

export function canHandleMobileBack(
    _entry: MobileBackEntry,
    isAlertModalOpen: boolean,
): boolean {
    return !isAlertModalOpen
}
