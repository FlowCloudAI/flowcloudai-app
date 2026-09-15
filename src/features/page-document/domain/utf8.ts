// 本模块提供不依赖宿主 DOM API 的 UTF-8 长度换算，供领域层统一处理源码字节坐标。

/** 返回单个 Unicode 标量对应的 UTF-8 字节数；孤立代理项按替换字符计为三字节。 */
export function utf8ByteLength(character: string): number {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined) return 0
    if (codePoint <= 0x7f) return 1
    if (codePoint <= 0x7ff) return 2
    if (codePoint <= 0xffff) return 3
    return 4
}
