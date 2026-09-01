import type {ThemeColorConfig} from '../../api'
import {
    createCustomFcThemeRecipe,
    createFcThemePreview,
    DEFAULT_FC_THEME_RECIPE_ID,
    FC_THEME_RECIPES,
    type FcThemeCustomValues,
    type FcThemeTokenColorValues,
} from './fcThemeRecipe'
import {
    applyFcThemeTokenOverride,
    clearFcThemeTokenOverride,
} from './fcThemeTokenOverride'

export function applyPersistedThemeColorConfig(config: ThemeColorConfig | null | undefined): boolean {
    if (!config) {
        clearFcThemeTokenOverride()
        return false
    }

    if (isDefaultThemeColorConfig(config)) {
        clearFcThemeTokenOverride()
        return false
    }

    const recipe = FC_THEME_RECIPES.find((item) => item.id === config.recipeId)
    if (!recipe) {
        clearFcThemeTokenOverride()
        return false
    }

    const preview = createFcThemePreview(createCustomFcThemeRecipe(
        recipe,
        config.customValues as FcThemeCustomValues,
    ))
    if (!preview) {
        clearFcThemeTokenOverride()
        return false
    }

    applyFcThemeTokenOverride(preview, config.tokenColors as FcThemeTokenColorValues)
    return true
}

function isDefaultThemeColorConfig(config: ThemeColorConfig): boolean {
    return config.recipeId === DEFAULT_FC_THEME_RECIPE_ID
}
