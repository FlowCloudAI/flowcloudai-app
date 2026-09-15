// 本模块只从 URL fragment 读取会话 token，避免 token 进入画布页面请求或持久化日志。

const SESSION_TOKEN_PATTERN = /^[0-9a-f]{64}$/u

export function readCanvasSessionToken(hash: string): string | null {
    if (!hash.startsWith('#')) return null

    const params = new URLSearchParams(hash.slice(1))
    const token = params.get('token')
    return token && SESSION_TOKEN_PATTERN.test(token) ? token : null
}
