// 本模块集中页面文档 HTML 能力清单；guard 与隔离画布只共享静态规则，不共享宿主运行时。

export const FORBIDDEN_HTML_TAGS = new Set([
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'form',
    'input',
    'textarea',
    'select',
    'button',
    'base',
    'link',
    'meta',
])

export const FORBIDDEN_HTML_ATTRIBUTES = new Set([
    'ping',
    'action',
    'formaction',
    'background',
])

export const FORBIDDEN_HTML_ATTRIBUTE_PREFIXES = new Set(['on'])

export const MANAGED_RESOURCE_ATTRIBUTES = {
    allElements: new Set(['src', 'srcset', 'poster']),
    nonLinkElements: new Set(['href', 'xlink:href']),
    linkElements: new Set(['a', 'area']),
}

export const URL_ATTRIBUTES = new Set([
    ...FORBIDDEN_HTML_ATTRIBUTES,
    ...MANAGED_RESOURCE_ATTRIBUTES.allElements,
    ...MANAGED_RESOURCE_ATTRIBUTES.nonLinkElements,
])
