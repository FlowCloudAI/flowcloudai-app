/** 子页 props 桥的两端（见 stores/mobileEditorHandoff 末尾的说明）。 */
import {useEffect, useRef} from 'react'
import {
    type MobilePagePropsHolder,
    readMobilePageProps,
    registerMobilePageProps,
} from '../stores/mobileEditorHandoff'

/** 打开方：登记一个始终指向最新 props 的容器。 */
export function useProvideMobilePageProps<T>(token: string, value: T): void {
    const holder = useRef<T>(value) as MobilePagePropsHolder<T>
    useEffect(() => {
        holder.current = value
    })
    useEffect(() => registerMobilePageProps(token, holder), [holder, token])
}

/**
 * 子页：按 token 取一次。
 *
 * 取到的是「调用那一刻」的 props 对象，子页把它展开给表单后就固定下来了——
 * 打开方之后再 render 出的新闭包，子页不会自动跟上。因此**桥上的回调不能依赖
 * 打开方 render 期捕获的值**：写状态一律用函数式更新（`setX(cur => ...)`），
 * 需要读最新值时自己从 store / ref 取。现有几个回调都满足这条。
 */
export function readProvidedMobilePageProps<T>(token: string): T | undefined {
    return readMobilePageProps<T>(token)
}
