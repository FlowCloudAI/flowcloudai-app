import {useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties} from 'react'
import {Button} from 'flowcloudai-ui'
import {saveFileDialog} from '../../api/dialog'
import {setting_export_theme_config, type ThemeColorConfig} from '../../api'
import {logger} from '../../shared/logger'
import {
    applyFcThemeTokenOverride,
    clearFcThemeTokenOverride,
} from '../../features/settings/fcThemeTokenOverride'
import {
    createCustomFcThemeRecipe,
    createFcThemePreview,
    DEFAULT_FC_THEME_RECIPE_ID,
    FC_THEME_RECIPES,
    generateFcThemeCustomValues,
    getFcThemeCustomValues,
    getFcThemeRecipe,
    type FcThemeCustomValues,
    type FcThemeRecipe,
    type FcThemeTokenColorValues,
} from '../../features/settings/fcThemeRecipe'
import {
    buildThemeColorConfig,
    createPreviewForValues,
    createTokenColors,
    getPrimaryTokenColor,
    normalizeThemeValues,
    normalizeTokenColorsForPreview,
    parseThemeConfig,
    resolveThemeColorState,
    THEME_CONFIG_VERSION,
} from '../../features/settings/themeColorState'
import {normalizeHexColor} from '../../features/settings/materialThemePreview'
import ThemeTokenColorEditor, {type TokenColorMode} from './ThemeTokenColorEditor'
import './ThemeColorPreview.css'

type ColorVariableStyle = CSSProperties & Record<string, string>

interface ThemeConfigFile {
    app: 'flowcloudai'
    type: 'theme'
    version: 3
    recipeId: string
    customValues: FcThemeCustomValues
    tokenColors: FcThemeTokenColorValues
    exportedAt: string
}

interface ThemeColorPreviewProps {
    value: ThemeColorConfig | null
    onChange: (config: ThemeColorConfig | null) => void
}


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
        const nextConfig = buildThemeColorConfig(nextRecipeId, nextValues, nextTokenColors)
        if (nextConfig === 'invalid') {
            logger.warn('[ThemeColorPreview] 颜色主题配置无效，跳过持久化', {nextRecipeId})
            return
        }

        logger.info('[ThemeColorPreview] 持久化颜色主题配置', {
            recipeId: nextConfig?.recipeId ?? null,
            primarySeed: nextConfig?.customValues.primarySeed ?? null,
            tokenCount: nextConfig ? Object.keys(nextConfig.tokenColors).length : 0,
        })
        onChange(nextConfig)
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

function buildThemeConfigFileName(recipeId: string): string {
    return `flowcloudai-theme-${recipeId}.json`
}

function formatErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}





function themePresetStyle(preset: FcThemeRecipe): ColorVariableStyle {
    return {
        '--theme-color-preview-primary': preset.primarySeed,
        '--theme-color-preview-surface': preset.neutralSeed,
    }
}
