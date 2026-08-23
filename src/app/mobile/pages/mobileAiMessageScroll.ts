/* AI 消息区底部跟随的纯策略；DOM 监听与滚动执行由相邻 hook 负责。 */

interface KeyboardRiseFollowState {
    active: boolean
    autoScroll: boolean
    keyboardRising: boolean
    messageListEmpty: boolean
}

export function shouldFollowMobileAiKeyboardRise({
    active,
    autoScroll,
    keyboardRising,
    messageListEmpty,
}: KeyboardRiseFollowState): boolean {
    return active && autoScroll && keyboardRising && !messageListEmpty
}
