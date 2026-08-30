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

/** 子页：按 token 取用（在事件里调用，不要在 render 期读）。 */
export function readProvidedMobilePageProps<T>(token: string): T | undefined {
    return readMobilePageProps<T>(token)
}
