import {
    createFcThemeOverrideCss,
    type FcThemeTokenColorValues,
    type FcThemePreview,
} from './fcThemeRecipe'

const FC_THEME_TOKEN_OVERRIDE_STYLE_ID = 'fc-theme-token-overrides'

export function applyFcThemeTokenOverride(preview: FcThemePreview, tokenColors?: FcThemeTokenColorValues): boolean {
    let style = document.getElementById(FC_THEME_TOKEN_OVERRIDE_STYLE_ID) as HTMLStyleElement | null
    if (!style) {
        style = document.createElement('style')
        style.id = FC_THEME_TOKEN_OVERRIDE_STYLE_ID
        document.head.appendChild(style)
    }
    style.textContent = createFcThemeOverrideCss(preview, tokenColors)
    return true
}

export function clearFcThemeTokenOverride() {
    document.getElementById(FC_THEME_TOKEN_OVERRIDE_STYLE_ID)?.remove()
}
