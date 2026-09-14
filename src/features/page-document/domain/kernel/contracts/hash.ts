// 本模块提供内核版本与候选内容使用的确定性非密码学指纹；安全完整性仍由宿主持久化层负责。

/** FNV-1a 64 位只用于不可变输入的缓存键和候选标识。 */
export function documentFingerprint(value: string): string {
    let hash = 0xcbf29ce484222325n
    for (let index = 0; index < value.length; index += 1) {
        hash ^= BigInt(value.charCodeAt(index))
        hash = BigInt.asUintN(64, hash * 0x100000001b3n)
    }
    return hash.toString(16).padStart(16, '0')
}
