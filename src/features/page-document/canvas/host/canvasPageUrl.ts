// 本模块生成独立画布页 URL；会话 token 只进入 fragment，不发送给资源服务器。

export function createCanvasPageUrl(baseUrl: string, sessionToken: string): string {
    const url = new URL('/canvas.html', baseUrl)
    url.search = ''
    url.hash = new URLSearchParams({token: sessionToken}).toString()
    return url.toString()
}

export function resolveCanvasHeight(reportedHeight: number, minimumHeight: number): number {
    if (!Number.isFinite(reportedHeight)) return minimumHeight
    return Math.max(minimumHeight, Math.min(100_000, Math.ceil(reportedHeight)))
}
