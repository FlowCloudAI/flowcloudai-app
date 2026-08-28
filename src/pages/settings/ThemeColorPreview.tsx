import {useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties} from 'react'
import {Button} from 'flowcloudai-ui'
import {saveFileDialog} from '../../api/dialog'
import {setting_export_theme_config, type ThemeColorConfig} from '../../api'
import {logger} from '../../shared/logger'
import {
    applyFcThemeTokenOverride,
    clearFcThemeTokenOverride,
} from './fcThemeTokenOverride'
import {
    createCustomFcThemeRecipe,
    createFcThemePreview,
    createFcThemeTokenColorValues,
    DEFAULT_FC_THEME_RECIPE_ID,
    FC_THEME_RECIPES,
    generateFcThemeCustomValues,
    getFcThemeCustomValues,
    getFcThemeRecipe,
    type FcThemeCustomValues,
    type FcThemePreview,
    type FcThemeRecipe,
    type FcThemeTokenColorPair,
    type FcThemeTokenColorValue,
    type FcThemeTokenColorValues,
} from './fcThemeRecipe'
import {normalizeHexColor} from './materialThemePreview'
import ThemeTokenColorEditor, {type TokenColorMode} from './ThemeTokenColorEditor'
import './ThemeColorPreview.css'

type ColorVariableStyle = CSSProperties & Record<string, string>

interface ParsedThemeConfig {
    recipeId: string
    customValues?: FcThemeCustomValues
    primarySeed?: string
    tokenColors?: FcThemeTokenColorValues
}

interface ThemeConfigFile {
    app: 'flowcloudai'
    type: 'theme'
    version: 3
    recipeId: string
    customValues: FcThemeCustomValues
    tokenColors: FcThemeTokenColorValues
    exportedAt: string
}

interface ThemeColorState {
    recipeId: string
    themeValues: FcThemeCustomValues
    tokenColors: FcThemeTokenColorValues
}

interface ThemeColorPreviewProps {
    value: ThemeColorConfig | null
    onChange: (config: ThemeColorConfig | null) => void
}

const THEME_CONFIG_VERSION = 3
const PRIMARY_TOKEN = '--fc-color-primary'

export default function ThemeColorPreview({value, onChange}: ThemeColorPreviewProps) {
    const defaultRecipe = useMemo(() => getFcThemeRecipe(DEFAULT_FC_THEME_RECIPE_ID), [])
    const defaultValues = useMemo(() => getFcThemeCustomValues(defaultRecipe), [defaultRecipe])
    const initialState = useMemo(() => resolveThemeColorState(value, defaultRecipe, defaultValues), [
        defaultRecipe,
        defaultValues,
        value,
    ])
    const [recipeId, setRecipeId] = useState(initialState.recipeId)
    const [themeValues, setThemeValues] = useState<FcThemeCustomValues>(() => initialState.themeValues)
    const [tokenColors, setTokenColors] = useState<FcThemeTokenColorValues>(() => initialState.tokenColors)
    const [customOpen, setCustomOpen] = useState(false)
    const [configMessage, setConfigMessage] = useState<string | null>(null)
    const importInputRef = useRef<HTMLInputElement>(null)
    const selectedRecipe = getFcThemeRecipe(recipeId)
    const customRecipe = useMemo(() => (
        createCustomFcThemeRecipe(selectedRecipe, themeValues)
    ), [selectedRecipe, themeValues])
    const fcPreview = useMemo(() => createFcThemePreview(customRecipe), [customRecipe])
    const currentPrimaryColor = getPrimaryTokenColor(tokenColors, themeValues.primarySeed)
    const isDefaultTheme = recipeId === DEFAULT_FC_THEME_RECIPE_ID
    const stateSnapshotRef = useRef({
        recipeId,
        primarySeed: currentPrimaryColor,
        isDefaultTheme,
    })

    useEffect(() => {
        stateSnapshotRef.current = {
            recipeId,
            primarySeed: currentPrimaryColor,
            isDefaultTheme,
        }
    }, [currentPrimaryColor, isDefaultTheme, recipeId])

    useEffect(() => {
        const nextState = resolveThemeColorState(value, defaultRecipe, defaultValues)
        logger.info('[ThemeColorPreview] 从设置恢复颜色主题', {
            recipeId: nextState.recipeId,
            primarySeed: nextState.themeValues.primarySeed,
            persisted: Boolean(value),
        })
        setRecipeId(nextState.recipeId)
        setThemeValues(nextState.themeValues)
        setTokenColors(nextState.tokenColors)
    }, [defaultRecipe, defaultValues, value])

    useEffect(() => {
        if (value?.recipeId !== DEFAULT_FC_THEME_RECIPE_ID) return

        logger.info('[ThemeColorPreview] 归一化默认颜色主题为空配置', {
            recipeId: value.recipeId,
        })
        onChange(null)
    }, [onChange, value])

    const commitThemeColorConfig = useCallback((
        nextRecipeId: string,
        nextValues: FcThemeCustomValues,
        nextTokenColors: FcThemeTokenColorValues,
    ) => {
        const normalizedValues = normalizeThemeValues(nextValues)
        const nextRecipe = getFcThemeRecipe(nextRecipeId)
        const nextPreview = createPreviewForValues(nextRecipe, normalizedValues ?? nextValues)
        if (!normalizedValues || !nextPreview) {
            logger.warn('[ThemeColorPreview] 颜色主题配置无效，跳过持久化', {nextRecipeId})
            return
        }

        const normalizedTokenColors = normalizeTokenColorsForPreview(nextTokenColors, nextPreview)
        const isDefaultConfig = nextRecipe.id === DEFAULT_FC_THEME_RECIPE_ID
        if (isDefaultConfig) {
            logger.info('[ThemeColorPreview] 持久化默认颜色主题为空配置')
            onChange(null)
            return
        }

        logger.info('[ThemeColorPreview] 持久化颜色主题配置', {
            recipeId: nextRecipe.id,
            primarySeed: normalizedValues.primarySeed,
            tokenCount: Object.keys(normalizedTokenColors).length,
        })
        onChange({
            version: THEME_CONFIG_VERSION,
            recipeId: nextRecipe.id,
            customValues: normalizedValues,
            tokenColors: normalizedTokenColors,
        })
    }, [onChange])

    useEffect(() => {
        logger.info('[ThemeColorPreview] 组件挂载，使用初始颜色主题', {
            recipeId: defaultRecipe.id,
            primarySeed: defaultValues.primarySeed,
            tokenCount: Object.keys(createTokenColors(defaultRecipe, defaultValues)).length,
        })
        return () => {
            const snapshot = stateSnapshotRef.current
            logger.info('[ThemeColorPreview] 组件卸载，当前颜色主题状态已交由设置持久化', {
                recipeId: snapshot.recipeId,
                primarySeed: snapshot.primarySeed,
                isDefaultTheme: snapshot.isDefaultTheme,
            })
        }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (isDefaultTheme || !fcPreview) {
            logger.info('[ThemeColorPreview] 清除颜色主题覆盖', {
                recipeId,
                isDefaultTheme,
                hasPreview: Boolean(fcPreview),
            })
            clearFcThemeTokenOverride()
            return
        }
        logger.info('[ThemeColorPreview] 应用颜色主题覆盖', {
            recipeId,
            primarySeed: currentPrimaryColor,
            tokenCount: Object.keys(tokenColors).length,
        })
        applyFcThemeTokenOverride(fcPreview, tokenColors)
    }, [currentPrimaryColor, fcPreview, isDefaultTheme, recipeId, tokenColors])

    const selectRecipe = (nextRecipeId: string) => {
        const nextRecipe = getFcThemeRecipe(nextRecipeId)
        const nextValues = getFcThemeCustomValues(nextRecipe)
        logger.info('[ThemeColorPreview] 选择颜色主题预设', {
            previousRecipeId: recipeId,
            nextRecipeId: nextRecipe.id,
            primarySeed: nextValues.primarySeed,
        })
        setRecipeId(nextRecipe.id)
        setThemeValues(nextValues)
        const nextTokenColors = createTokenColors(nextRecipe, nextValues)
        setTokenColors(nextTokenColors)
        commitThemeColorConfig(nextRecipe.id, nextValues, nextTokenColors)
        setConfigMessage(null)
    }

    const resetDefault = () => {
        logger.info('[ThemeColorPreview] 恢复默认颜色主题', {
            previousRecipeId: recipeId,
            previousPrimary: currentPrimaryColor,
        })
        setCustomOpen(false)
        selectRecipe(DEFAULT_FC_THEME_RECIPE_ID)
    }

    const updateTokenColor = (token: string, mode: TokenColorMode, color: string) => {
        const normalized = normalizeHexColor(color)
        if (!normalized) {
            logger.warn('[ThemeColorPreview] 忽略无效令牌颜色', {token, mode, color})
            return
        }
        logger.info('[ThemeColorPreview] 更新令牌颜色', {
            recipeId,
            token,
            mode,
            color: normalized,
        })
        setTokenColors((current) => {
            const nextTokenColors = {
                ...current,
                [token]: {
                    ...current[token],
                    ...(mode === 'both'
                        ? {
                            light: {hex: normalized, css: normalized},
                            dark: {hex: normalized, css: normalized},
                        }
                        : {[mode]: {hex: normalized, css: normalized}}),
                },
            }
            commitThemeColorConfig(recipeId, themeValues, nextTokenColors)
            return nextTokenColors
        })
        setConfigMessage(null)
    }

    const generateFromPrimary = () => {
        const generated = generateFcThemeCustomValues(currentPrimaryColor, selectedRecipe)
        if (!generated) {
            logger.warn('[ThemeColorPreview] 根据主色生成失败', {
                recipeId,
                primarySeed: currentPrimaryColor,
            })
            setConfigMessage('请先输入有效的主题色。')
            return
        }
        logger.info('[ThemeColorPreview] 根据主色生成颜色主题', {
            recipeId,
            primarySeed: currentPrimaryColor,
        })
        setThemeValues(generated)
        const nextTokenColors = createTokenColors(selectedRecipe, generated)
        setTokenColors(nextTokenColors)
        commitThemeColorConfig(selectedRecipe.id, generated, nextTokenColors)
        setConfigMessage('已根据主题色生成全部令牌颜色，可继续逐项微调。')
    }

    const exportThemeConfig = async () => {
        const customValues = normalizeThemeValues({
            ...themeValues,
            primarySeed: currentPrimaryColor,
        })
        if (!customValues || !fcPreview) {
            setConfigMessage('请先修正颜色后再导出。')
            return
        }
        const normalizedTokenColors = normalizeTokenColorsForPreview(tokenColors, fcPreview)
        const config: ThemeConfigFile = {
            app: 'flowcloudai',
            type: 'theme',
            version: THEME_CONFIG_VERSION,
            recipeId: selectedRecipe.id,
            customValues,
            tokenColors: normalizedTokenColors,
            exportedAt: new Date().toISOString(),
        }
        try {
            logger.info('[ThemeColorPreview] 准备导出颜色主题配置', {
                recipeId: selectedRecipe.id,
                primarySeed: customValues.primarySeed,
                tokenCount: Object.keys(normalizedTokenColors).length,
            })
            const selectedPath = await saveFileDialog({
                defaultPath: buildThemeConfigFileName(selectedRecipe.id),
                filters: [{
                    name: '流云AI 主题配置',
                    extensions: ['json'],
                }],
            })
            if (!selectedPath) {
                logger.info('[ThemeColorPreview] 取消导出颜色主题配置')
                return
            }
            await setting_export_theme_config(selectedPath, JSON.stringify(config, null, 2))
            logger.info('[ThemeColorPreview] 颜色主题配置已导出', {
                recipeId: selectedRecipe.id,
                path: selectedPath,
            })
            setConfigMessage('主题配置已导出。')
        } catch (error) {
            logger.error('[ThemeColorPreview] 颜色主题配置导出失败', error)
            setConfigMessage(`主题配置导出失败：${formatErrorMessage(error)}`)
        }
    }

    const importThemeConfig = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) {
            logger.info('[ThemeColorPreview] 未选择颜色主题配置文件')
            return
        }
        try {
            logger.info('[ThemeColorPreview] 准备导入颜色主题配置', {
                fileName: file.name,
                fileSize: file.size,
            })
            const config = parseThemeConfig(JSON.parse(await file.text()))
            if (!config) {
                logger.warn('[ThemeColorPreview] 颜色主题配置无法识别', {fileName: file.name})
                setConfigMessage('主题配置无法识别。')
                return
            }
            const importedRecipe = FC_THEME_RECIPES.find((recipe) => recipe.id === config.recipeId)
            if (!importedRecipe) {
                logger.warn('[ThemeColorPreview] 颜色主题配置引用了不存在的预设', {
                    fileName: file.name,
                    recipeId: config.recipeId,
                })
                setConfigMessage('主题配置引用了不存在的预设。')
                return
            }
            const importedValues = config.customValues ?? {
                ...getFcThemeCustomValues(importedRecipe),
                primarySeed: config.primarySeed ?? importedRecipe.primarySeed,
            }
            const importedTokenColors = config.tokenColors ?? createTokenColors(importedRecipe, importedValues)
            const normalizedImportedTokenColors = normalizeTokenColorsForPreview(
                importedTokenColors,
                createPreviewForValues(importedRecipe, importedValues),
            )
            setRecipeId(importedRecipe.id)
            setThemeValues(importedValues)
            setTokenColors(normalizedImportedTokenColors)
            setCustomOpen(true)
            commitThemeColorConfig(importedRecipe.id, importedValues, normalizedImportedTokenColors)
            logger.info('[ThemeColorPreview] 颜色主题配置已导入', {
                recipeId: importedRecipe.id,
                primarySeed: importedValues.primarySeed,
                tokenCount: Object.keys(importedTokenColors).length,
            })
            setConfigMessage('主题配置已导入。')
        } catch (error) {
            logger.error('[ThemeColorPreview] 颜色主题配置无法读取', error)
            setConfigMessage('主题配置无法读取。')
        }
    }

    return (
        <div className="theme-color-preview">
            <div className="theme-color-preview__header">
                <div>
                    <h3 className="theme-color-preview__title">颜色主题</h3>
                </div>
                <div className="theme-color-preview__header-actions">
                    <Button type="button" size="sm" variant="outline" onClick={resetDefault}>
                        恢复流云默认
                    </Button>
                </div>
            </div>

            <div className="theme-color-preview__preset-grid" aria-label="颜色主题预设">
                {FC_THEME_RECIPES.map((preset) => (
                    <ThemePresetCard
                        key={preset.id}
                        preset={preset}
                        active={recipeId === preset.id}
                        onSelect={() => selectRecipe(preset.id)}
                    />
                ))}
            </div>

            <div className="theme-color-preview__drawer">
                <button
                    className="theme-color-preview__drawer-toggle"
                    type="button"
                    aria-expanded={customOpen}
                    onClick={() => setCustomOpen((open) => !open)}
                >
                    <span>
                        <strong>自定义颜色与配置</strong>
                        <small>{selectedRecipe.label} / {currentPrimaryColor}</small>
                    </span>
                    <span aria-hidden="true">{customOpen ? '收起' : '展开'}</span>
                </button>
                {customOpen && (
                    <div className="theme-color-preview__drawer-panel">
                        <input
                            ref={importInputRef}
                            className="theme-color-preview__file-input"
                            type="file"
                            accept="application/json,.json"
                            onChange={importThemeConfig}
                        />
                        <div className="theme-color-preview__drawer-actions">
                            <Button type="button" size="sm" onClick={generateFromPrimary}>
                                一键生成
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => importInputRef.current?.click()}>
                                导入配置
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={!fcPreview}
                                onClick={() => {
                                    void exportThemeConfig()
                                }}
                            >
                                导出配置
                            </Button>
                        </div>
                        {fcPreview && (
                            <ThemeTokenColorEditor
                                tokens={fcPreview.tokens}
                                values={tokenColors}
                                onChange={updateTokenColor}
                            />
                        )}
                        {configMessage && <div className="theme-color-preview__config-message">{configMessage}</div>}
                    </div>
                )}
            </div>
        </div>
    )
}

function ThemePresetCard({
    preset,
    active,
    onSelect,
}: {
    preset: FcThemeRecipe
    active: boolean
    onSelect: () => void
}) {
    return (
        <button
            className={`theme-color-preview__preset-card ${active ? 'theme-color-preview__preset-card--active' : ''}`}
            type="button"
            style={themePresetStyle(preset)}
            aria-pressed={active}
            title={preset.description}
            onClick={onSelect}
        >
            <span className="theme-color-preview__preset-card-header">
                <span className="theme-color-preview__preset-dot" aria-hidden="true"/>
                <strong>{preset.label}</strong>
                {preset.id === DEFAULT_FC_THEME_RECIPE_ID && (
                    <span className="theme-color-preview__preset-badge">默认</span>
                )}
            </span>
            <span className="theme-color-preview__preset-card-swatches" aria-hidden="true">
                <span className="theme-color-preview__preset-swatch theme-color-preview__preset-swatch--surface"/>
                <span className="theme-color-preview__preset-swatch theme-color-preview__preset-swatch--primary"/>
            </span>
        </button>
    )
}

function resolveThemeColorState(
    config: ThemeColorConfig | null,
    defaultRecipe: FcThemeRecipe,
    defaultValues: FcThemeCustomValues,
): ThemeColorState {
    const fallbackTokenColors = createTokenColors(defaultRecipe, defaultValues)
    if (!config) {
        return {
            recipeId: defaultRecipe.id,
            themeValues: defaultValues,
            tokenColors: fallbackTokenColors,
        }
    }

    const parsed = parseThemeConfig(config)
    const recipe = parsed
        ? FC_THEME_RECIPES.find((item) => item.id === parsed.recipeId)
        : null
    if (!parsed || !recipe) {
        logger.warn('[ThemeColorPreview] 设置中的颜色主题配置无效，回退默认主题', {
            recipeId: config.recipeId,
        })
        return {
            recipeId: defaultRecipe.id,
            themeValues: defaultValues,
            tokenColors: fallbackTokenColors,
        }
    }

    const themeValues = parsed.customValues ?? {
        ...getFcThemeCustomValues(recipe),
        primarySeed: parsed.primarySeed ?? recipe.primarySeed,
    }
    const tokenColors = normalizeTokenColorsForPreview(
        parsed.tokenColors ?? createTokenColors(recipe, themeValues),
        createPreviewForValues(recipe, themeValues),
    )
    return {
        recipeId: recipe.id,
        themeValues,
        tokenColors,
    }
}

function parseThemeConfig(value: unknown): ParsedThemeConfig | null {
    if (!isRecord(value) || typeof value.recipeId !== 'string') return null

    if (value.version === 1 && typeof value.seedColor === 'string') {
        const primarySeed = normalizeHexColor(value.seedColor)
        return primarySeed ? {recipeId: value.recipeId, primarySeed} : null
    }

    if (value.version === 2) {
        const customValues = parseThemeValues(value.customValues)
        return customValues ? {recipeId: value.recipeId, customValues} : null
    }

    if (value.version !== THEME_CONFIG_VERSION) return null
    const customValues = parseThemeValues(value.customValues)
    const tokenColors = parseTokenColors(value.tokenColors)
    return customValues && tokenColors ? {recipeId: value.recipeId, customValues, tokenColors} : null
}

function parseThemeValues(value: unknown): FcThemeCustomValues | null {
    if (!isRecord(value)) return null
    const primarySeed = typeof value.primarySeed === 'string' ? normalizeHexColor(value.primarySeed) : null
    const neutralSeed = typeof value.neutralSeed === 'string' ? normalizeHexColor(value.neutralSeed) : null
    if (!primarySeed || !neutralSeed) return null
    return {
        primarySeed,
        primarySurfaceChroma: normalizeChroma(value.primarySurfaceChroma, 10, 0, 24),
        neutralSeed,
        neutralChroma: normalizeChroma(value.neutralChroma, 5, 0, 16),
        neutralVariantChroma: normalizeChroma(value.neutralVariantChroma, 10, 0, 24),
    }
}

function parseTokenColors(value: unknown): FcThemeTokenColorValues | null {
    if (!isRecord(value)) return null
    const entries = Object.entries(value).flatMap(([token, pair]) => {
        const parsedPair = parseTokenColorPair(pair)
        return parsedPair ? [[token, parsedPair] as const] : []
    })
    return entries.length > 0 ? Object.fromEntries(entries) : null
}

function parseTokenColorPair(value: unknown): FcThemeTokenColorPair | null {
    if (!isRecord(value)) return null
    const light = parseTokenColorValue(value.light)
    const dark = parseTokenColorValue(value.dark)
    return light && dark ? {light, dark} : null
}

function parseTokenColorValue(value: unknown): FcThemeTokenColorValue | null {
    if (typeof value === 'string') {
        const hex = normalizeHexColor(value)
        return hex ? {hex, css: hex} : null
    }
    if (!isRecord(value) || typeof value.hex !== 'string') return null
    const hex = normalizeHexColor(value.hex)
    if (!hex) return null
    const css = typeof value.css === 'string' && isSafeTokenCss(value.css, hex)
        ? value.css
        : hex
    return {hex, css}
}

function normalizeThemeValues(values: FcThemeCustomValues): FcThemeCustomValues | null {
    const primarySeed = normalizeHexColor(values.primarySeed)
    const neutralSeed = normalizeHexColor(values.neutralSeed)
    if (!primarySeed || !neutralSeed) return null
    return {
        primarySeed,
        primarySurfaceChroma: normalizeChroma(values.primarySurfaceChroma, 10, 0, 24),
        neutralSeed,
        neutralChroma: normalizeChroma(values.neutralChroma, 5, 0, 16),
        neutralVariantChroma: normalizeChroma(values.neutralVariantChroma, 10, 0, 24),
    }
}

function normalizeTokenColorsForPreview(
    tokenColors: FcThemeTokenColorValues,
    preview: FcThemePreview | null,
): FcThemeTokenColorValues {
    if (!preview) return tokenColors
    return Object.fromEntries(Object.entries(tokenColors).map(([token, pair]) => {
        const tokenPreview = preview.tokens.find((item) => item.token === token)
        return [token, tokenPreview?.modeInvariant ? {...pair, dark: pair.light} : pair]
    }))
}

function createTokenColors(recipe: FcThemeRecipe, values: FcThemeCustomValues): FcThemeTokenColorValues {
    const preview = createPreviewForValues(recipe, values)
    return preview ? createFcThemeTokenColorValues(preview) : {}
}

function createPreviewForValues(recipe: FcThemeRecipe, values: FcThemeCustomValues): FcThemePreview | null {
    return createFcThemePreview(createCustomFcThemeRecipe(recipe, values))
}

function getPrimaryTokenColor(tokenColors: FcThemeTokenColorValues, fallback: string): string {
    return normalizeHexColor(tokenColors[PRIMARY_TOKEN]?.light.hex)
        ?? normalizeHexColor(fallback)
        ?? '#4B78FF'
}

function buildThemeConfigFileName(recipeId: string): string {
    return `flowcloudai-theme-${recipeId}.json`
}

function formatErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function normalizeChroma(value: unknown, fallback: number, min: number, max: number): number {
    const numeric = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(numeric) ? clampNumber(Math.round(numeric), min, max) : fallback
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeTokenCss(value: string, hex: string): boolean {
    return value === hex || /^color-mix\(in srgb, #[0-9A-F]{6} \d{1,3}%, transparent\)$/u.test(value)
}

function themePresetStyle(preset: FcThemeRecipe): ColorVariableStyle {
    return {
        '--theme-color-preview-primary': preset.primarySeed,
        '--theme-color-preview-surface': preset.neutralSeed,
    }
}
