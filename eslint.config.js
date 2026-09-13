import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default [
  {
      ignores: ['dist', 'src-tauri/target/**', 'src-tauri/nsis/*.cjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  reactRefresh.configs.vite,
  {
      files: ['scripts/**/*.cjs'],
      languageOptions: {
          ecmaVersion: 2022,
          sourceType: 'commonjs',
          globals: globals.node,
      },
      rules: {
          '@typescript-eslint/no-require-imports': 'off',
      },
  },
  {
      files: ['scripts/**/*.mjs'],
      languageOptions: {
          ecmaVersion: 2022,
          sourceType: 'module',
          globals: globals.node,
      },
  },
    {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
      rules: {
          'react-hooks/set-state-in-effect': 'off',
      },
  },
  {
      // 移动端界面不直连 Tauri：经 src/api/ 或共享适配层，浏览器预览才能 mock、双端才能同测。
      files: ['src/app/mobile/**/*.{ts,tsx}'],
      rules: {
          'no-restricted-imports': ['error', {
              patterns: [{
                  group: ['@tauri-apps/*'],
                  message: '移动端界面不直接依赖 @tauri-apps/*，请经 src/api/ 或共享适配层。',
              }],
          }],
      },
  },
  {
      // 移动端页面 800 行红线，防止重复桌面端的巨石化；超过前先拆 hook 或子组件。
      files: ['src/app/mobile/pages/**/*.{ts,tsx}'],
      rules: {
          'max-lines': ['error', {max: 800}],
      },
  },
]
