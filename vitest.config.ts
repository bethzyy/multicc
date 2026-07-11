import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// 独立于 electron-vite 的测试配置。
// tests/unit/        纯逻辑单元测试（不依赖 electron / node-pty / DOM）
// tests/integration/ 服务层集成测试（如 WorktreeManager 跑真实 git 仓库）
// environment 均为 node；集成测试涉及真实 git 进程，超时放宽到 20s（Windows CI 较慢）。
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    reporters: 'default',
    testTimeout: 20_000,
  },
})
