#!/usr/bin/env node
/**
 * macOS 桌面端调试与发布入口。
 *
 * 日常构建只处理当前架构；正式发布默认构建 Universal App，并在执行前校验
 * Developer ID、公证凭据、递增构建号与 Tauri 更新签名密钥。敏感信息只从
 * 本机环境读取，不写入仓库。
 */

import {existsSync, readFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import path from 'node:path'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tauriBinary = path.join(repositoryRoot, 'node_modules', '.bin', 'tauri')
const command = process.argv[2] ?? 'doctor'
const forwardedArgs = process.argv.slice(3)

function capture(program, args = []) {
  const result = spawnSync(program, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: process.env,
  })
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  }
}

function run(program, args, env = process.env) {
  const result = spawnSync(program, args, {
    cwd: repositoryRoot,
    env,
    stdio: 'inherit',
  })
  if (result.error) {
    console.error(`[macOS] 无法执行 ${program}: ${result.error.message}`)
    process.exit(1)
  }
  process.exit(result.status ?? 1)
}

function requireMacOS() {
  if (process.platform !== 'darwin') {
    console.error(`[macOS] 当前系统为 ${process.platform}，macOS 工作流只能在 Mac 上运行。`)
    process.exit(1)
  }
}

function requireTauriBinary() {
  if (!existsSync(tauriBinary)) {
    console.error('[macOS] 未找到本地 Tauri CLI，请先在 app_main 执行 npm install。')
    process.exit(1)
  }
}

function runTauri(args, env = process.env) {
  requireMacOS()
  requireTauriBinary()
  run(tauriBinary, args, env)
}

function doctor() {
  let failed = false
  const report = (ok, label, detail, required = true) => {
    const marker = ok ? '通过' : required ? '失败' : '提示'
    console.log(`[${marker}] ${label}${detail ? `: ${detail}` : ''}`)
    if (!ok && required) failed = true
  }

  report(process.platform === 'darwin', 'macOS', process.platform)

  const xcode = capture('xcodebuild', ['-version'])
  report(xcode.ok, 'Xcode', xcode.output.replaceAll('\n', ' / '))

  const sdk = capture('xcrun', ['--sdk', 'macosx', '--show-sdk-version'])
  report(sdk.ok, 'macOS SDK', sdk.output)

  const rustTargets = capture('rustup', ['target', 'list', '--installed'])
  report(rustTargets.ok && rustTargets.output.includes('aarch64-apple-darwin'), 'Rust Apple Silicon target', 'aarch64-apple-darwin')
  report(rustTargets.ok && rustTargets.output.includes('x86_64-apple-darwin'), 'Rust Intel target', 'x86_64-apple-darwin')

  report(existsSync(tauriBinary), '本地 Tauri CLI', tauriBinary)
  const sharedConfigPath = path.join(repositoryRoot, 'src-tauri', 'tauri.conf.json')
  const macosConfigPath = path.join(repositoryRoot, 'src-tauri', 'tauri.macos.conf.json')
  report(existsSync(macosConfigPath), 'macOS 平台配置', 'src-tauri/tauri.macos.conf.json')
  try {
    const sharedConfig = JSON.parse(readFileSync(sharedConfigPath, 'utf8'))
    const macosConfig = JSON.parse(readFileSync(macosConfigPath, 'utf8'))
    const mainWindow = macosConfig.app?.windows?.find(window => window.label === 'main')
    report(
      sharedConfig.app?.macOSPrivateApi === true,
      'macOS 透明背景 API',
      '当前站外 DMG 可用；Mac App Store 不接受该私有 API',
    )
    report(mainWindow?.create === false, 'macOS 主窗口单一创建者', 'create=false，由 setup 按合并配置创建')
    report(mainWindow?.transparent === true, 'macOS 主窗口透明', 'transparent=true')
    report(
      mainWindow?.decorations === true && mainWindow?.titleBarStyle === 'Overlay',
      'macOS 原生标题栏',
      'decorations=true, titleBarStyle=Overlay',
    )
    report(
      mainWindow?.windowEffects?.effects?.[0] === 'underWindowBackground',
      'macOS 系统背景材质',
      'underWindowBackground',
    )
  } catch (error) {
    report(false, 'macOS 窗口配置解析', String(error))
  }
  report(existsSync(path.join(repositoryRoot, 'src-tauri', 'icons', 'icon.icns')), 'macOS 图标', 'src-tauri/icons/icon.icns')
  report(existsSync(path.join(repositoryRoot, 'src-tauri', 'Info.macos.plist')), 'macOS 文件类型声明', 'src-tauri/Info.macos.plist')
  report(existsSync(path.join(repositoryRoot, 'src-tauri', 'icons', 'fcplug.icns')), '.fcplug 文件图标', 'src-tauri/icons/fcplug.icns')
  report(existsSync(path.join(repositoryRoot, 'src-tauri', 'icons', 'fcworld.icns')), '.fcworld 文件图标', 'src-tauri/icons/fcworld.icns')

  const identities = capture('security', ['find-identity', '-v', '-p', 'codesigning'])
  const hasDeveloperId = identities.ok && identities.output.includes('Developer ID Application')
  report(hasDeveloperId, 'Developer ID Application 证书', hasDeveloperId ? '可用于站外分发' : '本地调试不受影响，正式签名/公证前需要安装', false)

  const hasApiNotarization = Boolean(process.env.APPLE_API_ISSUER && process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_PATH)
  const hasAppleIdNotarization = Boolean(process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID)
  report(hasApiNotarization || hasAppleIdNotarization, 'Apple 公证凭据', '正式发布时从环境变量或钥匙串提供', false)
  report(Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY), 'Tauri 更新签名密钥', '正式发布更新包时提供', false)

  if (failed) process.exit(1)
}

function buildConfig(extra = {}) {
  return JSON.stringify({
    bundle: {
      ...extra,
    },
  })
}

function requireReleaseEnvironment() {
  const buildNumber = process.env.MACOS_BUILD_NUMBER
  if (!buildNumber || !/^\d+(?:\.\d+){0,2}$/u.test(buildNumber)) {
    console.error('[macOS] 正式发布必须设置 MACOS_BUILD_NUMBER（例如 42 或 42.1）。')
    process.exit(1)
  }
  if (!process.env.APPLE_SIGNING_IDENTITY) {
    console.error('[macOS] 正式发布必须设置 APPLE_SIGNING_IDENTITY（Developer ID Application 证书名称）。')
    process.exit(1)
  }
  const hasApiNotarization = Boolean(process.env.APPLE_API_ISSUER && process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_PATH)
  const hasAppleIdNotarization = Boolean(process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID)
  if (!hasApiNotarization && !hasAppleIdNotarization) {
    console.error('[macOS] 正式发布缺少 Apple 公证凭据；请配置 App Store Connect API Key 或 Apple ID 三件套。')
    process.exit(1)
  }
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
    console.error('[macOS] 正式发布必须设置 TAURI_SIGNING_PRIVATE_KEY，以签名自动更新产物。')
    process.exit(1)
  }
  return buildNumber
}

switch (command) {
  case 'doctor':
    doctor()
    break
  case 'dev':
    runTauri(['dev', ...forwardedArgs])
    break
  case 'build-debug':
    runTauri([
      'build',
      '--debug',
      '--bundles',
      'app',
      '--no-sign',
      '--config',
      buildConfig({createUpdaterArtifacts: false}),
      ...forwardedArgs,
    ])
    break
  case 'build-local':
    runTauri([
      'build',
      '--bundles',
      'app,dmg',
      '--config',
      buildConfig({createUpdaterArtifacts: false}),
      ...forwardedArgs,
    ], {
      ...process.env,
      APPLE_SIGNING_IDENTITY: '-',
    })
    break
  case 'build-release': {
    requireMacOS()
    const buildNumber = requireReleaseEnvironment()
    const target = process.env.MACOS_TARGET || 'universal-apple-darwin'
    runTauri([
      'build',
      '--bundles',
      'app,dmg',
      '--target',
      target,
      '--config',
      buildConfig({
        macOS: {bundleVersion: buildNumber},
      }),
      ...forwardedArgs,
    ])
    break
  }
  default:
    console.error(`[macOS] 未知命令: ${command}`)
    console.error('可用命令: doctor, dev, build-debug, build-local, build-release')
    process.exit(1)
}
