// 本模块定义页面文档领域共享的 RFC 9562 UUID 词法规则；身份与资源校验不得各自收窄版本范围。

export const RFC_9562_UUID_SOURCE =
    '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'

export const RFC_9562_UUID_PATTERN = new RegExp(`^${RFC_9562_UUID_SOURCE}$`, 'iu')
