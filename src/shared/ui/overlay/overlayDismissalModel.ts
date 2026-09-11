/**
 * 本模块定义 Overlay 的关闭所有权判定，供键盘与背板入口共用。
 * Alert 模态打开时，底层 Overlay 必须保留状态并把交互让给最上层提示。
 */
export function shouldDismissOverlay(dismissible: boolean, isAlertModalOpen: boolean): boolean {
    return dismissible && !isAlertModalOpen
}
