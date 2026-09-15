// 本模块定义文档内核唯一的作者链接白名单；它校验持久化 href，但不替代宿主点击时的导航审核。

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const FC_ENTRY_HREF_PATTERN = new RegExp(`^fc://self/entry/${UUID_SOURCE}$`, 'iu')
const LEGACY_ENTRY_HREF_PATTERN = new RegExp(`^entry://${UUID_SOURCE}(?:/${UUID_SOURCE})?$`, 'iu')
const HREF_SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/iu
const INVALID_PERCENT_ENCODING_PATTERN = /%(?![0-9a-f]{2})/iu
const SAFE_EXTERNAL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel'])

export type AuthorHrefDiagnosticCode = 'invalid_href' | 'forbidden_href_scheme'

export type AuthorHrefValidationResult =
    {allowed: true} | {allowed: false; code: AuthorHrefDiagnosticCode; message: string}

/** 校验作者源码链接；只接受无需页面脚本自行解释的稳定形态。 */
export function validateAuthorHref(href: string): AuthorHrefValidationResult {
    if (href.length === 0 || containsCodePointAtMost(href, 0x20)) {
        return invalidHref('链接不能为空，也不能包含未编码的空白或控制字符。')
    }
    if (INVALID_PERCENT_ENCODING_PATTERN.test(href)) {
        return invalidHref('链接包含无效的百分号编码。')
    }
    if (href.startsWith('#')) {
        return href.length > 1 ? {allowed: true} : invalidHref('本页锚点必须包含目标 ID。')
    }

    const scheme = HREF_SCHEME_PATTERN.exec(href)?.[1].toLowerCase()
    if (!scheme) return forbiddenScheme()
    if (scheme === 'fc') {
        return FC_ENTRY_HREF_PATTERN.test(href)
            ? {allowed: true}
            : invalidHref('fc 链接必须使用 fc://self/entry/<uuid>。')
    }
    if (scheme === 'entry') {
        return LEGACY_ENTRY_HREF_PATTERN.test(href)
            ? {allowed: true}
            : invalidHref(
                  'entry 链接必须使用 entry://<entry-uuid> 或 entry://<project-uuid>/<entry-uuid>。',
              )
    }
    if (scheme === 'entry-title') return validateEntryTitleHref(href)
    if (!SAFE_EXTERNAL_SCHEMES.has(scheme)) return forbiddenScheme()
    if (scheme === 'http' || scheme === 'https') {
        return validAbsoluteUrl(href, scheme)
            ? {allowed: true}
            : invalidHref(`${scheme} 链接必须是包含主机名的绝对 URL。`)
    }
    return href.length > scheme.length + 1
        ? {allowed: true}
        : invalidHref(`${scheme} 链接必须包含目标。`)
}

function invalidHref(message: string): AuthorHrefValidationResult {
    return {allowed: false, code: 'invalid_href', message}
}

function forbiddenScheme(): AuthorHrefValidationResult {
    return {
        allowed: false,
        code: 'forbidden_href_scheme',
        message: '链接只允许本页锚点、受管词条内链或 http/https/mailto/tel。',
    }
}

function containsCodePointAtMost(value: string, maximum: number): boolean {
    return [...value].some(character => {
        const codePoint = character.codePointAt(0)
        return codePoint !== undefined && (codePoint <= maximum || codePoint === 0x7f)
    })
}

function validAbsoluteUrl(href: string, expectedScheme: 'http' | 'https'): boolean {
    const prefix = `${expectedScheme}://`
    if (!href.toLowerCase().startsWith(prefix)) return false

    const remainder = href.slice(prefix.length)
    const separatorIndex = remainder.search(/[/?#]/u)
    const authority = separatorIndex < 0 ? remainder : remainder.slice(0, separatorIndex)
    const hostAndPort = authority.slice(authority.lastIndexOf('@') + 1)
    if (hostAndPort.length === 0) return false

    if (hostAndPort.startsWith('[')) {
        const closingBracket = hostAndPort.indexOf(']')
        if (closingBracket <= 1) return false
        const port = hostAndPort.slice(closingBracket + 1)
        return port.length === 0 || /^:\d+$/u.test(port)
    }

    const colonIndex = hostAndPort.lastIndexOf(':')
    const hostname = colonIndex < 0 ? hostAndPort : hostAndPort.slice(0, colonIndex)
    const port = colonIndex < 0 ? '' : hostAndPort.slice(colonIndex + 1)
    return (
        hostname.length > 0 &&
        !hostname.includes('\\') &&
        !hostname.includes(':') &&
        !hostname.includes('@') &&
        !hostname.includes('[') &&
        !hostname.includes(']') &&
        (colonIndex < 0 || /^\d+$/u.test(port))
    )
}

function validateEntryTitleHref(href: string): AuthorHrefValidationResult {
    const encodedTitle = href.slice(href.indexOf(':') + 3)
    if (encodedTitle.length === 0 || /[/?#]/u.test(encodedTitle)) {
        return invalidHref('entry-title 链接必须携带一个标题；路径分隔符须进行百分号编码。')
    }
    try {
        const title = decodeURIComponent(encodedTitle)
        if (title.trim().length === 0 || containsCodePointAtMost(title, 0x1f)) {
            return invalidHref('entry-title 链接必须携带有效标题。')
        }
    } catch {
        return invalidHref('entry-title 链接包含无效的百分号编码。')
    }
    return {allowed: true}
}
