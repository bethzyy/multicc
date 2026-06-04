import { useState, useEffect, useCallback } from 'react'

export type Theme = 'dark' | 'light'

const THEME_KEY = 'multicc-theme'

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    // 从 localStorage 读取主题
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') {
      return saved
    }
    return 'dark' // 默认深色主题
  })

  // 应用主题到 DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState(prev => prev === 'dark' ? 'light' : 'dark')
  }, [])

  return { theme, setTheme, toggleTheme }
}

// 只返回容器级配色（背景/前景/光标/选区），不覆盖 ANSI 16 色调色板，
// 让 xterm.js 用自带默认调色板，保留 Claude Code 等子进程输出的原始颜色。
export function getXTermTheme(theme: Theme) {
  if (theme === 'light') {
    return {
      background: '#ffffff',
      foreground: '#333333',
      cursor: '#333333',
      cursorAccent: '#ffffff',
      selection: 'rgba(0, 0, 0, 0.2)'
    }
  }

  // Dark theme (default)
  return {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#ffffff',
    cursorAccent: '#1e1e1e',
    selection: 'rgba(255, 255, 255, 0.3)'
  }
}
