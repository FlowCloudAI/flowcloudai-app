/** 子页 props 桥的两端（见 stores/mobileEditorHandoff 末尾的说明）。 */
import {useEffect, useRef} from 'react'
import {
    type MobilePagePropsHolder,
    readMobilePageProps,
    registerMobilePageProps,
} from '../stores/mobileEditorHandoff'

/**
 * 把「可以不写」变成「必须写，但可以写 undefined」。
 *
 * 桥接类型都是从共享表单 props 上 `Omit` 出来的，而 `Omit` 只挡显式列出的字段——
 * 剩下的可选字段打开方不传，TypeScript 一声不吭。同一座加图/封面桥已经因此漏了三次
 * （`00c216e`、`f1ff7b8` 漏 `onOpenPluginManagement`，`e38663c` 漏 `mode`），三次都只能靠真机点出来。
 * 包上这层之后，表单新增可选字段会让所有打开方立刻编译失败，不传只能是写下 `undefined` 的明示决定。
 *
 * 用 `Record & T` 而不是 `{[K in keyof T]-?: …}`：`-?` 会连带把 `undefined` 从值类型里去掉，
 * 逼着打开方为用不上的字段编一个假值；这里只要求键出现，值仍由 `T` 说了算，必填字段也不会被放宽成可空。
 */
export type RequireExplicitProps<T> = Record<keyof T, unknown> & T

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
 * 需要读最新值时自己从 store / ref 取。
 *
 * 新增回调时逐个核对这条：`onInsertImage` 曾是死代码，按 render 期捕获的 images
 * 回查下标，一旦变成可达路径就必然落空（见根仓 `docs/devlog/2026-08-31-移动端-props-桥漏传-mode.md`）。
 */
export function readProvidedMobilePageProps<T>(token: string): T | undefined {
    return readMobilePageProps<T>(token)
}
