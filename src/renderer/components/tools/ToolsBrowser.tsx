/**
 * Tools Browser Component
 *
 * Displays detected CLI tools and custom commands management.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { List } from 'react-window'
import type { ToolInfo, CustomCommand, ToolsConfig } from '@shared/types/tools.types'
import './ToolsBrowser.css'

interface ToolsBrowserProps {
  onClose: () => void
  onRunCommand?: (command: string, cwd?: string) => void
}

export function ToolsBrowser({ onClose, onRunCommand }: ToolsBrowserProps) {
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [customCommands, setCustomCommands] = useState<CustomCommand[]>([])
  const [detecting, setDetecting] = useState(false)
  const [activeTab, setActiveTab] = useState<'tools' | 'custom'>('tools')
  const [editingCommand, setEditingCommand] = useState<CustomCommand | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)

  // 新命令表单
  const [newCommand, setNewCommand] = useState<Partial<CustomCommand>>({
    name: '',
    command: '',
    cwd: '',
    description: '',
    icon: '🔧'
  })

  // 加载工具和自定义命令
  useEffect(() => {
    loadTools()
    loadCustomCommands()
  }, [])

  const loadTools = async () => {
    setDetecting(true)
    try {
      const result = await window.electron.tools.detectAll()
      setTools(result.tools)
    } catch (error) {
      console.error('Failed to detect tools:', error)
    } finally {
      setDetecting(false)
    }
  }

  const loadCustomCommands = async () => {
    try {
      const result = await window.electron.tools.getCustomCommands()
      setCustomCommands(result.commands)
    } catch (error) {
      console.error('Failed to load custom commands:', error)
    }
  }

  const handleAddCommand = async () => {
    if (!newCommand.name || !newCommand.command) return

    const command: CustomCommand = {
      id: `cmd-${Date.now()}`,
      name: newCommand.name,
      command: newCommand.command,
      cwd: newCommand.cwd,
      description: newCommand.description,
      icon: newCommand.icon || '🔧'
    }

    try {
      const result = await window.electron.tools.addCustomCommand(command)
      if (result.success) {
        setCustomCommands(result.commands)
        setNewCommand({ name: '', command: '', cwd: '', description: '', icon: '🔧' })
        setShowAddForm(false)
      }
    } catch (error) {
      console.error('Failed to add command:', error)
    }
  }

  const handleRemoveCommand = async (id: string) => {
    try {
      const result = await window.electron.tools.removeCustomCommand(id)
      if (result.success) {
        setCustomCommands(result.commands)
      }
    } catch (error) {
      console.error('Failed to remove command:', error)
    }
  }

  const handleRunCommand = (cmd: CustomCommand) => {
    if (onRunCommand) {
      onRunCommand(cmd.command, cmd.cwd)
    }
  }

  const handleOpenHomepage = (url?: string) => {
    if (url) {
      window.open(url, '_blank')
    }
  }

  const getStatusIcon = (status: string): string => {
    switch (status) {
      case 'installed': return '✅'
      case 'not_installed': return '❌'
      case 'error': return '⚠️'
      default: return '❓'
    }
  }

  const getStatusText = (status: string): string => {
    switch (status) {
      case 'installed': return '已安装'
      case 'not_installed': return '未安装'
      case 'error': return '检测错误'
      default: return '未知'
    }
  }

  // Virtual list row renderer for tools (react-window v2 API)
  const ToolRow = ({ index, style, tools: toolsList }: { index: number; style: React.CSSProperties; tools: ToolInfo[] }) => {
    const tool = toolsList[index]
    if (!tool) return null
    return (
      <div style={style} className={`tool-card tool-card--${tool.status}`}>
        <div className="tool-card__header">
          <span className="tool-card__status">{getStatusIcon(tool.status)}</span>
          <span className="tool-card__name">{tool.name}</span>
          {tool.version && (
            <span className="tool-card__version">{tool.version}</span>
          )}
        </div>

        <div className="tool-card__body">
          <p className="tool-card__description">{tool.description}</p>

          {tool.path && (
            <p className="tool-card__path">
              <span>路径:</span> {tool.path}
            </p>
          )}

          {tool.error && (
            <p className="tool-card__error">
              <span>错误:</span> {tool.error}
            </p>
          )}

          {tool.status === 'not_installed' && tool.installHint && (
            <div className="tool-card__install">
              <span>安装命令:</span>
              <code>{tool.installHint}</code>
            </div>
          )}
        </div>

        <div className="tool-card__actions">
          {tool.homepage && (
            <button
              className="tool-card__action"
              onClick={() => handleOpenHomepage(tool.homepage)}
            >
              🌐 主页
            </button>
          )}
          <span className={`tool-card__badge tool-card__badge--${tool.status}`}>
            {getStatusText(tool.status)}
          </span>
        </div>
      </div>
    )
  }

  // Virtual list row renderer for custom commands (react-window v2 API)
  const CommandRow = ({ index, style, commands, onRun, onRemove }: { index: number; style: React.CSSProperties; commands: CustomCommand[]; onRun: (cmd: CustomCommand) => void; onRemove: (id: string) => void }) => {
    const cmd = commands[index]
    if (!cmd) return null
    return (
      <div style={style} className="command-card">
        <div className="command-card__icon">{cmd.icon || '🔧'}</div>
        <div className="command-card__info">
          <span className="command-card__name">{cmd.name}</span>
          <code className="command-card__cmd">{cmd.command}</code>
          {cmd.description && (
            <p className="command-card__desc">{cmd.description}</p>
          )}
          {cmd.cwd && (
            <p className="command-card__cwd">📁 {cmd.cwd}</p>
          )}
        </div>
        <div className="command-card__actions">
          <button
            className="command-card__run"
            onClick={() => onRun(cmd)}
            title="运行命令"
          >
            ▶️
          </button>
          <button
            className="command-card__delete"
            onClick={() => onRemove(cmd.id)}
            title="删除命令"
          >
            🗑️
          </button>
        </div>
      </div>
    )
  }

  const [listHeight, setListHeight] = useState(400)

  // Update list height on container resize
  useEffect(() => {
    const updateHeight = () => {
      // Subtract header, tabs, footer heights (approx 160px)
      const height = window.innerHeight - 160 - 100
      setListHeight(Math.max(300, height))
    }
    updateHeight()
    window.addEventListener('resize', updateHeight)
    return () => window.removeEventListener('resize', updateHeight)
  }, [])

  return (
    <div className="tools-browser-overlay" onClick={onClose}>
      <div className="tools-browser" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="tools-browser__header">
          <h2>CLI 工具管理</h2>
          <button className="tools-browser__close" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div className="tools-browser__tabs">
          <button
            className={`tools-browser__tab ${activeTab === 'tools' ? 'active' : ''}`}
            onClick={() => setActiveTab('tools')}
          >
            已安装工具
          </button>
          <button
            className={`tools-browser__tab ${activeTab === 'custom' ? 'active' : ''}`}
            onClick={() => setActiveTab('custom')}
          >
            自定义命令
          </button>
        </div>

        {/* Content */}
        <div className="tools-browser__content">
          {activeTab === 'tools' && (
            <div className="tools-list">
              <div className="tools-list__header">
                <h3>检测到的 CLI 工具</h3>
                <button
                  className="tools-list__refresh"
                  onClick={loadTools}
                  disabled={detecting}
                >
                  {detecting ? '🔄 检测中...' : '🔄 重新检测'}
                </button>
              </div>

              {tools.length === 0 && !detecting && (
                <div className="tools-list__empty">
                  <p>未检测到任何 CLI 工具</p>
                </div>
              )}

              {tools.length > 0 && (
                <List
                  rowComponent={ToolRow}
                  rowCount={tools.length}
                  rowHeight={140}
                  rowProps={{ tools }}
                  style={{ height: listHeight, width: '100%' }}
                  overscanCount={3}
                />
              )}
            </div>
          )}

          {activeTab === 'custom' && (
            <div className="custom-commands">
              <div className="custom-commands__header">
                <h3>自定义命令</h3>
                <button
                  className="custom-commands__add"
                  onClick={() => setShowAddForm(!showAddForm)}
                >
                  {showAddForm ? '取消' : '+ 添加命令'}
                </button>
              </div>

              {/* Add Command Form */}
              {showAddForm && (
                <div className="command-form">
                  <div className="command-form__field">
                    <label>名称 *</label>
                    <input
                      type="text"
                      value={newCommand.name}
                      onChange={(e) => setNewCommand({ ...newCommand, name: e.target.value })}
                      placeholder="例如: 启动服务"
                    />
                  </div>

                  <div className="command-form__field">
                    <label>命令 *</label>
                    <input
                      type="text"
                      value={newCommand.command}
                      onChange={(e) => setNewCommand({ ...newCommand, command: e.target.value })}
                      placeholder="例如: npm run dev"
                    />
                  </div>

                  <div className="command-form__field">
                    <label>工作目录 (可选)</label>
                    <input
                      type="text"
                      value={newCommand.cwd || ''}
                      onChange={(e) => setNewCommand({ ...newCommand, cwd: e.target.value })}
                      placeholder="例如: C:\projects\myapp"
                    />
                  </div>

                  <div className="command-form__field">
                    <label>描述 (可选)</label>
                    <input
                      type="text"
                      value={newCommand.description || ''}
                      onChange={(e) => setNewCommand({ ...newCommand, description: e.target.value })}
                      placeholder="命令的简短描述"
                    />
                  </div>

                  <div className="command-form__field">
                    <label>图标</label>
                    <input
                      type="text"
                      value={newCommand.icon || '🔧'}
                      onChange={(e) => setNewCommand({ ...newCommand, icon: e.target.value })}
                      placeholder="emoji 图标"
                      className="command-form__icon-input"
                    />
                  </div>

                  <div className="command-form__actions">
                    <button
                      className="command-form__save"
                      onClick={handleAddCommand}
                      disabled={!newCommand.name || !newCommand.command}
                    >
                      保存
                    </button>
                    <button
                      className="command-form__cancel"
                      onClick={() => setShowAddForm(false)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              {/* Commands List */}
              {customCommands.length === 0 && !showAddForm && (
                <div className="custom-commands__empty">
                  <p>还没有自定义命令</p>
                  <p className="custom-commands__hint">点击"添加命令"创建你的第一个自定义命令</p>
                </div>
              )}

              {customCommands.length > 0 && (
                <List
                  rowComponent={CommandRow}
                  rowCount={customCommands.length}
                  rowHeight={80}
                  rowProps={{
                    commands: customCommands,
                    onRun: handleRunCommand,
                    onRemove: handleRemoveCommand,
                  }}
                  style={{ height: listHeight, width: '100%' }}
                  overscanCount={5}
                />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="tools-browser__footer">
          <p className="tools-browser__hint">
            💡 提示: 自定义命令可以在新终端中运行
          </p>
        </div>
      </div>
    </div>
  )
}
