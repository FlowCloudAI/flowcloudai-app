/**
 * FlowCloudAI iOS 调试与打包入口。
 *
 * 统一封装环境检查、Tauri 真机命令、版本号校验和 IPA 归档；个人 Team 与设备信息只从环境或参数读取。
 */

import { createHash } from 'node:crypto'
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const tauriDir = join(repoRoot, 'src-tauri')
const generatedAppleDir = join(tauriDir, 'gen', 'apple')
const iosIconSourceDir = join(tauriDir, 'icons', 'ios')
const generatedIosAppIconDir = join(generatedAppleDir, 'Assets.xcassets', 'AppIcon.appiconset')
const tauriBin = join(repoRoot, 'node_modules', '.bin', 'tauri')
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const tauriConfig = JSON.parse(readFileSync(join(tauriDir, 'tauri.conf.json'), 'utf8'))
const productName = tauriConfig.productName
const appVersion = tauriConfig.version ?? packageJson.version
const buildNumberPattern = /^\d+(?:\.\d+){0,2}$/

function printHelp() {
  console.log(`FlowCloudAI iOS 工作流

用法：node ./scripts/ios-workflow.mjs <命令> [...Tauri 参数]

命令：
  doctor              检查 Xcode、Rust、CocoaPods、签名与生成工程
  init                初始化或更新 src-tauri/gen/apple
  assert-generated    检查生成工程是否与仓库内 iOS 配置一致
  sync-icons          将受 Git 跟踪的 iOS AppIcon 同步到生成工程
  dev                 热更新调试，可追加设备名称或 --open
  run                 使用已打包前端运行，适合稳定性回归
  build-debug         生成 debugging IPA
  build-release-test  生成注册设备测试 IPA
  build-appstore      生成 TestFlight / App Store Connect IPA
  archive             仅生成 Release Xcode Archive

Release 示例：
  IOS_BUILD_NUMBER=42 npm run ios:build:appstore
`)
}

function capture(command, args, timeout = 10_000) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
    timeout,
  })
}

function runTauri(args) {
  if (!existsSync(tauriBin)) {
    throw new Error('未找到本地 Tauri CLI，请先在 app_main 执行 npm install。')
  }

  console.log(`\n[iOS] tauri ${args.join(' ')}\n`)
  const result = spawnSync(tauriBin, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  })

  if (result.error) {
    throw result.error
  }
  if (result.signal) {
    throw new Error(`Tauri 进程被信号 ${result.signal} 终止。`)
  }
  if (result.status !== 0) {
    throw new Error(`Tauri 命令失败，退出码 ${result.status ?? 'unknown'}。`)
  }
}

function resolveIosAppIconFiles() {
  const manifestPath = join(generatedIosAppIconDir, 'Contents.json')
  if (!existsSync(iosIconSourceDir)) {
    throw new Error(`未找到 iOS 图标源目录：${iosIconSourceDir}`)
  }
  if (!existsSync(manifestPath)) {
    throw new Error(`未找到生成的 AppIcon 清单：${manifestPath}；请先执行 npm run ios:init。`)
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const fileNames = [...new Set(
    (manifest.images ?? [])
      .map((image) => image.filename)
      .filter((fileName) => typeof fileName === 'string' && fileName.endsWith('.png')),
  )]
  if (fileNames.length === 0) {
    throw new Error(`AppIcon 清单没有可同步的 PNG：${manifestPath}`)
  }

  for (const fileName of fileNames) {
    const source = join(iosIconSourceDir, fileName)
    if (!existsSync(source)) {
      throw new Error(`iOS 图标源文件缺失：${source}`)
    }
  }
  return fileNames
}

function inspectIosAppIcons() {
  try {
    const fileNames = resolveIosAppIconFiles()
    const staleFiles = fileNames.filter((fileName) => {
      const source = readFileSync(join(iosIconSourceDir, fileName))
      const generated = readFileSync(join(generatedIosAppIconDir, fileName))
      return !source.equals(generated)
    })
    return staleFiles.length === 0
      ? { ok: true, detail: `已同步 ${fileNames.length} 个图标` }
      : { ok: false, detail: `${staleFiles.length} 个生成图标与 src-tauri/icons/ios 不一致` }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

function syncIosAppIcons() {
  const fileNames = resolveIosAppIconFiles()
  for (const fileName of fileNames) {
    copyFileSync(join(iosIconSourceDir, fileName), join(generatedIosAppIconDir, fileName))
  }
  console.log(`[iOS] 已从 src-tauri/icons/ios 同步 ${fileNames.length} 个 AppIcon 文件。`)
}

function inspectGeneratedIosDeploymentTarget() {
  const expected = tauriConfig.bundle?.iOS?.minimumSystemVersion
  const generatedProjectPath = join(generatedAppleDir, 'project.yml')
  if (!expected) {
    return { ok: false, detail: 'src-tauri/tauri.conf.json 未声明 iOS minimumSystemVersion' }
  }
  if (!existsSync(generatedProjectPath)) {
    return { ok: false, detail: '生成工程不存在；请执行 npm run ios:init' }
  }

  const generatedProject = readFileSync(generatedProjectPath, 'utf8')
  const generatedMatch = generatedProject.match(/^\s+iOS:\s*["']?([^\s"'#]+)["']?\s*$/m)
  const actual = generatedMatch?.[1]
  if (!actual) {
    return { ok: false, detail: '生成工程没有可识别的 iOS deploymentTarget' }
  }
  return actual === expected
    ? { ok: true, detail: `iOS ${actual}` }
    : { ok: false, detail: `仓库要求 iOS ${expected}，生成工程仍为 iOS ${actual}；请重新执行 npm run ios:init` }
}

function assertGeneratedIosDeploymentTarget() {
  const status = inspectGeneratedIosDeploymentTarget()
  if (!status.ok) throw new Error(status.detail)
  console.log(`[iOS] 生成工程最低版本已同步：${status.detail}`)
}

function assertFlagAbsent(args, flag) {
  if (args.some((arg) => arg === flag || arg.startsWith(`${flag}=`))) {
    throw new Error(`${flag} 由当前 npm 命令固定，请不要重复传入。`)
  }
}

function resolveBuildNumber(required) {
  const value = process.env.IOS_BUILD_NUMBER?.trim()

  if (!value && required) {
    throw new Error(
      'Release 打包必须设置 IOS_BUILD_NUMBER，例如 IOS_BUILD_NUMBER=42 npm run ios:build:appstore。',
    )
  }
  if (value && !buildNumberPattern.test(value)) {
    throw new Error('iOS Build Number 只能是 1 至 3 段非负整数，例如 42、2026.8.16 或 1.2.3。')
  }

  const parts = value?.split('.') ?? []
  if (parts[0]?.length > 4 || parts.slice(1).some((part) => part.length > 2)) {
    throw new Error('iOS Build Number 第一段最多 4 位，第二、三段最多 2 位；建议直接使用递增整数，例如 42。')
  }

  return value
}

function buildNumberConfigArgs(buildNumber) {
  if (!buildNumber) return []
  return [
    '--config',
    JSON.stringify({
      bundle: {
        iOS: {
          bundleVersion: buildNumber,
        },
      },
    }),
  ]
}

function requireSigningTeam() {
  const team = process.env.APPLE_DEVELOPMENT_TEAM?.trim()
  if (!team) {
    throw new Error(
      '未设置 APPLE_DEVELOPMENT_TEAM。请在当前终端 export APPLE_DEVELOPMENT_TEAM="你的 Team ID"；该值不要提交到仓库。',
    )
  }
  if (!/^[A-Z0-9]{10}$/.test(team)) {
    throw new Error('APPLE_DEVELOPMENT_TEAM 应为 10 位 Team ID；请检查 Xcode 的 Signing & Capabilities。')
  }
}

function assertNoIosBuildLock(profile) {
  const lockPath = join(tauriDir, 'target', 'aarch64-apple-ios', profile, 'lock.ios')
  if (!existsSync(lockPath)) return

  const holders = capture('lsof', ['-t', lockPath], 5_000)
  const pids = holders.status === 0 ? holders.stdout.trim().split(/\s+/).filter(Boolean) : []
  if (pids.length > 0) {
    throw new Error(
      `另一个 iOS 进程正在占用 ${profile} 构建锁（PID: ${pids.join(', ')}）。请先在旧调试终端按 Ctrl+C，或关闭由 ios:dev --open 启动的调试会话。`,
    )
  }
}

function findFreshIpa(buildStartedAt) {
  const buildDir = join(generatedAppleDir, 'build', 'arm64')
  if (!existsSync(buildDir)) {
    throw new Error(`Tauri 命令成功，但未找到 IPA 输出目录：${buildDir}`)
  }

  const expected = join(buildDir, `${productName}.ipa`)
  const candidates = existsSync(expected)
    ? [expected]
    : readdirSync(buildDir)
        .filter((name) => name.endsWith('.ipa'))
        .map((name) => join(buildDir, name))
        .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)

  const ipa = candidates[0]
  if (!ipa) {
    throw new Error(`Tauri 命令成功，但 ${buildDir} 中没有 IPA。`)
  }
  if (statSync(ipa).mtimeMs < buildStartedAt - 5_000) {
    throw new Error(`检测到的 IPA 早于本次构建，拒绝把旧文件当作新产物：${ipa}`)
  }
  return ipa
}

function sha256File(file) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const input = createReadStream(file)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('error', reject)
    input.on('end', () => resolveHash(hash.digest('hex')))
  })
}

async function archiveIpa(source, mode, buildNumber) {
  const artifactDir = join(repoRoot, 'artifacts', 'ios')
  mkdirSync(artifactDir, { recursive: true })

  const safeVersion = String(appVersion).replace(/[^0-9A-Za-z.-]/g, '-')
  const safeBuildNumber = String(buildNumber ?? 'dev').replace(/[^0-9A-Za-z.-]/g, '-')
  const fileName = `flowcloudai-ios-v${safeVersion}-b${safeBuildNumber}-${mode}.ipa`
  const destination = join(artifactDir, fileName)
  copyFileSync(source, destination)

  const digest = await sha256File(destination)
  const checksumPath = `${destination}.sha256`
  writeFileSync(checksumPath, `${digest}  ${fileName}\n`, 'utf8')

  console.log('\n[iOS] 打包产物已整理：')
  console.log(`  IPA:    ${destination}`)
  console.log(`  SHA256: ${checksumPath}`)
}

function doctor() {
  const rows = []
  let hardFailures = 0

  function add(ok, label, detail, required = true) {
    rows.push({ ok, label, detail, required })
    if (!ok && required) hardFailures += 1
  }

  add(process.platform === 'darwin', 'macOS', process.platform)

  const xcode = capture('xcrun', ['xcodebuild', '-version'])
  add(xcode.status === 0, 'Xcode', xcode.status === 0 ? xcode.stdout.trim().replace(/\n/g, ' / ') : '不可用')

  const rustup = capture('rustup', ['target', 'list', '--installed'])
  const installedTargets = rustup.status === 0 ? rustup.stdout.split(/\s+/) : []
  add(
    installedTargets.includes('aarch64-apple-ios'),
    'Rust 真机目标',
    'aarch64-apple-ios',
  )
  add(
    installedTargets.includes('aarch64-apple-ios-sim'),
    'Rust 模拟器目标',
    'aarch64-apple-ios-sim',
  )

  const pods = capture('pod', ['--version'])
  add(pods.status === 0, 'CocoaPods', pods.status === 0 ? pods.stdout.trim() : '不可用')
  add(existsSync(tauriBin), 'Tauri CLI', existsSync(tauriBin) ? '本地依赖可用' : '请执行 npm install')
  add(
    existsSync(join(tauriDir, 'ios', 'project.yml')),
    'XcodeGen 模板',
    'src-tauri/ios/project.yml',
  )
  add(
    existsSync(join(generatedAppleDir, 'project.yml')),
    '生成工程',
    existsSync(join(generatedAppleDir, 'project.yml')) ? '已初始化' : '请执行 npm run ios:init',
    false,
  )
  const iconStatus = inspectIosAppIcons()
  add(
    iconStatus.ok,
    'iOS AppIcon',
    iconStatus.detail,
    existsSync(join(generatedAppleDir, 'project.yml')),
  )
  const deploymentTargetStatus = inspectGeneratedIosDeploymentTarget()
  add(
    deploymentTargetStatus.ok,
    'iOS 最低版本',
    deploymentTargetStatus.detail,
    existsSync(join(generatedAppleDir, 'project.yml')),
  )

  const signingIdentities = capture('security', ['find-identity', '-v', '-p', 'codesigning'])
  const signingOutput = `${signingIdentities.stdout ?? ''}\n${signingIdentities.stderr ?? ''}`
  const hasSigningIdentity = signingIdentities.status === 0 && /Apple (Development|Distribution)/.test(signingOutput)
  add(
    hasSigningIdentity,
    '签名证书',
    hasSigningIdentity ? '已发现 Apple 签名身份' : '当前进程未读取到；最终以 xcodebuild 的签名结果为准',
    false,
  )
  add(
    Boolean(process.env.APPLE_DEVELOPMENT_TEAM?.trim()),
    'Team 环境变量',
    process.env.APPLE_DEVELOPMENT_TEAM?.trim() ? '已设置（值不显示）' : '未设置 APPLE_DEVELOPMENT_TEAM',
    false,
  )

  const devices = capture('xcrun', ['devicectl', 'list', 'devices'], 15_000)
  const deviceOutput = `${devices.stdout ?? ''}\n${devices.stderr ?? ''}`
  const hasConnectedDevice = devices.status === 0 && /iPhone/i.test(deviceOutput)
  add(
    hasConnectedDevice,
    '连接的 iPhone',
    hasConnectedDevice ? 'devicectl 检测到已连接设备' : '当前未检测到；仅打包时可忽略',
    false,
  )

  console.log('FlowCloudAI iOS 环境检查\n')
  for (const row of rows) {
    const marker = row.ok ? '通过' : row.required ? '失败' : '提示'
    console.log(`[${marker}] ${row.label}: ${row.detail}`)
  }

  if (hardFailures > 0) {
    throw new Error(`环境检查发现 ${hardFailures} 个必须修复的问题。`)
  }
  console.log('\n必须项已通过。真机调试/签名打包前还需处理上面的相关提示。')
}

async function buildIpa(mode, exportMethod, debug, forwardedArgs) {
  requireSigningTeam()
  assertGeneratedIosDeploymentTarget()
  syncIosAppIcons()
  assertFlagAbsent(forwardedArgs, '--export-method')
  assertFlagAbsent(forwardedArgs, '--build-number')
  assertFlagAbsent(forwardedArgs, '--config')
  assertFlagAbsent(forwardedArgs, '-c')
  assertFlagAbsent(forwardedArgs, '--target')
  assertFlagAbsent(forwardedArgs, '-t')
  assertFlagAbsent(forwardedArgs, '--debug')
  assertFlagAbsent(forwardedArgs, '-d')
  assertFlagAbsent(forwardedArgs, '--open')
  assertFlagAbsent(forwardedArgs, '-o')
  assertFlagAbsent(forwardedArgs, '--archive-only')
  assertFlagAbsent(forwardedArgs, '--no-sign')

  const releaseBuild = !debug
  const buildNumber = resolveBuildNumber(releaseBuild)
  assertNoIosBuildLock(debug ? 'debug' : 'release')
  const args = ['ios', 'build']
  if (debug) args.push('--debug')
  args.push('--export-method', exportMethod)
  args.push(...buildNumberConfigArgs(buildNumber))
  args.push(...forwardedArgs)

  const buildStartedAt = Date.now()
  runTauri(args)
  await archiveIpa(findFreshIpa(buildStartedAt), mode, buildNumber)
}

async function main() {
  const [command, ...forwardedArgs] = process.argv.slice(2)

  switch (command) {
    case 'doctor':
      doctor()
      break
    case 'init':
      requireSigningTeam()
      runTauri(['ios', 'init', ...forwardedArgs])
      syncIosAppIcons()
      break
    case 'assert-generated':
      assertGeneratedIosDeploymentTarget()
      break
    case 'sync-icons':
      syncIosAppIcons()
      break
    case 'dev':
      assertGeneratedIosDeploymentTarget()
      syncIosAppIcons()
      runTauri(['ios', 'dev', ...forwardedArgs])
      break
    case 'run':
      assertGeneratedIosDeploymentTarget()
      syncIosAppIcons()
      runTauri(['ios', 'run', ...forwardedArgs])
      break
    case 'build-debug':
      await buildIpa('debugging', 'debugging', true, forwardedArgs)
      break
    case 'build-release-test':
      await buildIpa('release-testing', 'release-testing', false, forwardedArgs)
      break
    case 'build-appstore':
      await buildIpa('app-store-connect', 'app-store-connect', false, forwardedArgs)
      break
    case 'archive': {
      requireSigningTeam()
      assertGeneratedIosDeploymentTarget()
      syncIosAppIcons()
      assertFlagAbsent(forwardedArgs, '--build-number')
      assertFlagAbsent(forwardedArgs, '--config')
      assertFlagAbsent(forwardedArgs, '-c')
      assertFlagAbsent(forwardedArgs, '--target')
      assertFlagAbsent(forwardedArgs, '-t')
      assertFlagAbsent(forwardedArgs, '--debug')
      assertFlagAbsent(forwardedArgs, '-d')
      assertFlagAbsent(forwardedArgs, '--open')
      assertFlagAbsent(forwardedArgs, '-o')
      assertFlagAbsent(forwardedArgs, '--archive-only')
      assertFlagAbsent(forwardedArgs, '--export-method')
      assertFlagAbsent(forwardedArgs, '--no-sign')
      const buildNumber = resolveBuildNumber(true)
      assertNoIosBuildLock('release')
      const args = ['ios', 'build', '--archive-only']
      args.push(...buildNumberConfigArgs(buildNumber))
      args.push(...forwardedArgs)
      runTauri(args)
      console.log(`\n[iOS] Xcode Archive 位于：${join(generatedAppleDir, 'build', 'arm64')}`)
      break
    }
    case '--help':
    case '-h':
    case undefined:
      printHelp()
      break
    default:
      printHelp()
      throw new Error(`未知命令：${command}`)
  }
}

main().catch((error) => {
  console.error(`\n[iOS] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
