// 这些测试验证现行只读、校验与 SaveBundle DTO 在网络边界拒绝未知字段和错误版本。
import assert from 'node:assert/strict'
import {readdirSync, readFileSync} from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import * as ts from 'typescript'
import {
    parseDocumentDiagnostics,
    parseEntryAssetSnapshot,
    parseDocumentSaveBundleRequest,
    parseDocumentSaveBundleResult,
    parseEntrySourceSnapshot,
    parseProjectSourceSnapshot,
    parseSourceMutationResult,
    parseSourceValidationResult,
} from './validators.ts'

const HASH = 'a'.repeat(64)
const PROJECT = {
    projectRevision: 3,
    templateVersion: 1,
    hashes: {article: HASH, style: HASH},
    defaultArticleHtml: '<!doctype html>',
    defaultStyleCss: '',
    diagnostics: [],
    sourceStatus: 'ready',
}

test('诊断分类是必填且仅接受冻结枚举', () => {
    const diagnostic = {
        severity: 'error',
        category: 'security',
        code: 'forbidden_html_element',
        message: '作者 HTML 不允许使用 script。',
        file: 'article.html',
    }
    assert.deepEqual(parseDocumentDiagnostics([diagnostic]), {
        ok: true,
        value: [diagnostic],
        issues: [],
    })

    const missing = parseDocumentDiagnostics([{...diagnostic, category: undefined}])
    assert.equal(missing.ok, false)
    assert.ok(missing.issues.some(issue => issue.code === 'invalid_diagnostic_category'))

    const unknown = parseDocumentDiagnostics([{...diagnostic, category: 'policy'}])
    assert.equal(unknown.ok, false)
    assert.ok(unknown.issues.some(issue => issue.code === 'invalid_diagnostic_category'))
})

test('合法项目与词条源码快照通过严格运行时契约', () => {
    assert.deepEqual(parseProjectSourceSnapshot(PROJECT), {ok: true, value: PROJECT, issues: []})

    const entry = {
        project: PROJECT,
        entry: {
            id: '11111111-1111-4111-8111-111111111111',
            title: '雾港',
            summary: '',
            tags: ['地点'],
        },
        documentVersion: 1,
        baseTemplateVersion: 1,
        revision: 7,
        hashes: {article: HASH, style: HASH},
        articleHtml: '<template data-fc-entry-patch></template>',
        styleCss: '',
        assets: [
            {
                id: '22222222-2222-4222-8222-222222222222',
                mediaType: 'image/png',
                sizeBytes: 68,
                sha256: HASH,
            },
        ],
        editorLimits: {
            paragraph: 100,
            asset: 100,
            managedNodes: 512,
            containerDepth: 3,
            containerChildren: 32,
        },
        diagnostics: [],
        sourceStatus: 'ready',
    }
    assert.deepEqual(parseEntrySourceSnapshot(entry), {ok: true, value: entry, issues: []})
})

test('资产响应经过共享运行时契约', () => {
    const asset = {
        id: '22222222-2222-4222-8222-222222222222',
        mediaType: 'image/webp',
        sizeBytes: 128,
        sha256: HASH,
    }
    assert.deepEqual(parseEntryAssetSnapshot(asset), {ok: true, value: asset, issues: []})
    assert.equal(parseEntryAssetSnapshot({...asset, mediaType: 'image/svg+xml'}).ok, false)
})

test('快照拒绝未知字段、错误 hash 与不支持的文档版本', () => {
    const parsed = parseEntrySourceSnapshot({
        project: {...PROJECT, unexpected: true},
        entry: {
            id: '11111111-1111-4111-8111-111111111111',
            title: '',
            summary: '',
            tags: [],
        },
        documentVersion: 2,
        baseTemplateVersion: 1,
        revision: 1,
        hashes: {article: 'short', style: HASH},
        articleHtml: '',
        styleCss: '',
        assets: [],
        editorLimits: {
            paragraph: 100,
            asset: 100,
            managedNodes: 512,
            containerDepth: 3,
            containerChildren: 32,
        },
        diagnostics: [],
        sourceStatus: 'ready',
    })

    assert.equal(parsed.ok, false)
    assert.ok(
        parsed.issues.some(
            issue =>
                issue.path === 'entrySource.project.unexpected' && issue.code === 'unknown_field',
        ),
    )
    assert.ok(
        parsed.issues.some(
            issue =>
                issue.path === 'entrySource.documentVersion' &&
                issue.code === 'unsupported_document_version',
        ),
    )
    assert.ok(
        parsed.issues.some(
            issue => issue.path === 'entrySource.hashes.article' && issue.code === 'invalid_sha256',
        ),
    )
})

test('源码校验与提交响应也经过严格运行时契约', () => {
    const sources = {'article.html': '<p>雾港</p>', 'style.css': ''}
    const validation = {
        valid: true,
        sources,
        diagnostics: [],
        textProjection: '雾港',
        templateVersion: 1,
    }
    assert.deepEqual(parseSourceValidationResult(validation), {
        ok: true,
        value: validation,
        issues: [],
    })

    const mutation = {
        dryRun: false,
        revision: 8,
        sources,
        diagnostics: [],
        changedFiles: ['article.html'],
    }
    assert.deepEqual(parseSourceMutationResult(mutation), {ok: true, value: mutation, issues: []})

    const invalid = parseSourceMutationResult({
        ...mutation,
        projectRevision: 9,
        changedFiles: ['layout.xml'],
    })
    assert.equal(invalid.ok, false)
    assert.ok(invalid.issues.some(issue => issue.code === 'unknown_field'))
    assert.ok(invalid.issues.some(issue => issue.code === 'invalid_source_file'))
})

test('SaveBundle 同时约束双作用域源码、修订与嵌套结果', () => {
    const sources = {'article.html': '<p>雾港</p>', 'style.css': ''}
    const request = {
        baseProjectRevision: 2,
        baseEntryRevision: 7,
        baseTemplateVersion: 1,
        projectSources: sources,
        entrySources: sources,
        idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }
    assert.equal(parseDocumentSaveBundleRequest(request).ok, true)

    const scopeResult = {
        dryRun: false,
        revision: 3,
        sources,
        diagnostics: [],
        changedFiles: ['article.html'],
    }
    const result = {
        projectRevision: 3,
        entryRevision: 8,
        templateVersion: 1,
        project: scopeResult,
        entry: {...scopeResult, revision: 8},
    }
    assert.equal(parseDocumentSaveBundleResult(result).ok, true)
    const invalid = parseDocumentSaveBundleResult({...result, entryRevision: 9})
    assert.equal(invalid.ok, false)
    assert.ok(invalid.issues.some(issue => issue.code === 'revision_mismatch'))
})

test('页面文档领域层的导入闭包不依赖界面、平台或反向业务模块', () => {
    const domainRoot = path.dirname(fileURLToPath(import.meta.url))
    const sourceFiles = collectProductionSources(domainRoot)
    const forbiddenImports: string[] = []

    for (const file of sourceFiles) {
        const source = ts.createSourceFile(
            file,
            readFileSync(file, 'utf8'),
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS,
        )
        for (const specifier of moduleSpecifiers(source)) {
            if (
                specifier === 'react'
                || specifier.startsWith('react/')
                || specifier === '@tauri-apps'
                || specifier.startsWith('@tauri-apps/')
            ) {
                forbiddenImports.push(`${path.relative(domainRoot, file)} -> ${specifier}`)
                continue
            }
            if (!specifier.startsWith('.')) continue
            const target = path.resolve(path.dirname(file), specifier)
            const relativeTarget = path.relative(domainRoot, target)
            if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
                forbiddenImports.push(`${path.relative(domainRoot, file)} -> ${specifier}`)
            }
            const normalizedTarget = target.split(path.sep).join('/')
            if (
                normalizedTarget.includes('/features/entries/')
                || normalizedTarget.includes('/features/project-editor/')
            ) {
                forbiddenImports.push(`${path.relative(domainRoot, file)} -> ${specifier}`)
            }
        }
    }
    assert.deepEqual(forbiddenImports, [])

    const program = ts.createProgram({
        rootNames: sourceFiles,
        options: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            allowImportingTsExtensions: true,
            noEmit: true,
            skipLibCheck: true,
        },
    })
    const checker = program.getTypeChecker()
    const domGlobals = new Set<string>()
    for (const source of program.getSourceFiles()) {
        if (!sourceFiles.includes(source.fileName)) continue
        const visit = (node: ts.Node): void => {
            if (ts.isIdentifier(node)) {
                const symbol = checker.getSymbolAtLocation(node)
                if (
                    symbol?.declarations?.some(declaration =>
                        /^lib\.dom(?:\.iterable)?\.d\.ts$/.test(path.basename(declaration.getSourceFile().fileName)),
                    )
                ) {
                    domGlobals.add(`${path.relative(domainRoot, source.fileName)}:${node.text}`)
                }
            }
            ts.forEachChild(node, visit)
        }
        visit(source)
    }
    assert.deepEqual([...domGlobals].sort(), [])
})

function collectProductionSources(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true})
        .flatMap(entry => {
            const target = path.join(directory, entry.name)
            if (entry.isDirectory()) return collectProductionSources(target)
            return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
                ? [target]
                : []
        })
        .sort()
}

function moduleSpecifiers(source: ts.SourceFile): string[] {
    const specifiers: string[] = []
    const visit = (node: ts.Node): void => {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
            && node.moduleSpecifier
            && ts.isStringLiteral(node.moduleSpecifier)
        ) {
            specifiers.push(node.moduleSpecifier.text)
        }
        if (
            ts.isCallExpression(node)
            && node.expression.kind === ts.SyntaxKind.ImportKeyword
            && node.arguments.length === 1
            && ts.isStringLiteral(node.arguments[0])
        ) {
            specifiers.push(node.arguments[0].text)
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
    return specifiers
}
