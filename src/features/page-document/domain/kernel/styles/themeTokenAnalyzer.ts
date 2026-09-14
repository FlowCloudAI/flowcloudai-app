// 本模块在组合页面根上读取项目与词条主题令牌，分开报告本作用域受管声明和当前页面有效值。

import type {HtmlCompositionElement} from '../composition/index.ts'
import type {
    AuthorDeclarationState,
    EffectiveAuthorValue,
    ThemeTokenInspection,
} from '../contracts/analysis.ts'
import {sourceKey, type SourceScope} from '../contracts/source.ts'
import type {PropertyAnalyzer} from './propertyAnalyzer.ts'
import {matchesThemeTokenSelector} from './themeTokenTarget.ts'

const THEME_TOKEN_PATTERN = /^--fc-[a-z0-9][a-z0-9-]*$/u
const CONTEXT = Object.freeze({
    viewport: 'mobile' as const,
    interactions: Object.freeze({hover: false, focusWithin: false}),
    direction: 'unknown' as const,
    writingMode: 'unknown' as const,
})

export interface ThemeTokenAnalyzer {
    inspect(scope: SourceScope, property: string): ThemeTokenInspection | null
}

export function createThemeTokenAnalyzer({
    effectiveRoot,
    projectRoot,
    properties,
    entryId,
    writableScopes,
}: {
    effectiveRoot: HtmlCompositionElement
    projectRoot: HtmlCompositionElement
    properties: PropertyAnalyzer
    entryId: string
    writableScopes: readonly SourceScope[]
}): ThemeTokenAnalyzer {
    return Object.freeze({
        inspect: (scope: SourceScope, propertyInput: string) => {
            const property = propertyInput.toLowerCase()
            if (!THEME_TOKEN_PATTERN.test(property)) return null
            const inspected = properties.inspectElement(effectiveRoot, property, CONTEXT)
            const scoped = properties.inspectElement(
                scope === 'project' ? projectRoot : effectiveRoot,
                property,
                CONTEXT,
            )
            const related = Object.freeze(
                scoped.directDeclarations.filter(
                    declaration => declaration.origin.source?.scope === scope,
                ),
            )
            const managed = Object.freeze(
                related.filter(
                    declaration =>
                        declaration.sourceKind === 'stylesheet' &&
                        declaration.origin.source?.file === 'style.css' &&
                        declaration.layer === `fc-${scope}` &&
                        declaration.media === null &&
                        declaration.condition === 'active' &&
                        Boolean(
                            declaration.selector &&
                            matchesThemeTokenSelector(declaration.selector, scope, entryId),
                        ),
                ),
            )
            return Object.freeze({
                propertyFamily: property,
                scope,
                managedDeclarations: managed,
                managedValue: managedValue(property, managed),
                effectiveValue: inspected.effectiveValue,
                relatedDeclarations: related,
                confidence: inspected.confidence,
                valueCapability: inspected.valueCapability,
                writeDestination: writableScopes.includes(scope)
                    ? sourceKey(scope, 'style.css')
                    : null,
                dependencies: inspected.dependencies,
                diagnostics: inspected.diagnostics,
            })
        },
    })
}

function managedValue(
    property: string,
    declarations: readonly AuthorDeclarationState[],
): EffectiveAuthorValue | null {
    const active = declarations.filter(declaration => declaration.condition === 'active')
    const important = active.filter(declaration => declaration.important)
    const winner = (important.length > 0 ? important : active).at(-1)
    return winner
        ? Object.freeze({
              property,
              declaredProperty: winner.declaredProperty,
              rawValue: winner.rawValue,
              resolvedValue: winner.resolvedValue,
              origin: winner.origin,
              inherited: false,
          })
        : null
}
