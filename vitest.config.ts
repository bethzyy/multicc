import { defineConfig } from 'vitest/config'

// 独立于 electron-vite 的测试配置。
// 只跑 tests/ 下的纯逻辑单元测试（不依赖 electron / node-pty / DOM），
// 因此 environment 用 node，无需额外 setup。
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    reporters: 'default',
  },
})
