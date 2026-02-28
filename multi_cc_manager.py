#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Claude Code 多窗口管理器 - Windows版
功能参考 Muxvo: https://muxvo.com/
- 永久存档：保存对话历史
- 一屏排开：多终端平铺管理
- 聚焦模式：一键放大当前终端
- 自动扫描：显示本地 Skill 和 MCP
- 统一入口：支持多种 AI CLI 工具
"""

import os
import sys
import json
import shutil
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict
from dataclasses import dataclass, field

from PyQt5.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QGridLayout, QPushButton, QLabel, QMessageBox, QFrame,
    QSplitter, QListWidget, QListWidgetItem, QDialog, QLineEdit,
    QTextEdit, QComboBox, QFileDialog, QTabWidget, QScrollArea
)
from PyQt5.QtCore import Qt, QTimer, pyqtSignal
from PyQt5.QtGui import QColor, QPalette, QFont, QIcon

try:
    from termqt import Terminal, TerminalWinptyIO
except ImportError:
    print("请安装 termqt: pip install termqt")
    sys.exit(1)

# 设置日志
LOG_DIR = Path(__file__).parent / "logs"
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / f"multicc_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE, encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)
logger.info(f"日志文件: {LOG_FILE}")

# 数据目录
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
CONVERSATIONS_DIR = DATA_DIR / "conversations"
CONVERSATIONS_DIR.mkdir(exist_ok=True)


@dataclass
class Conversation:
    """对话记录"""
    id: str
    name: str
    tool: str  # claude, codex, gemini
    created_at: datetime
    last_active: datetime
    working_dir: str
    messages: List[Dict] = field(default_factory=list)


@dataclass
class CLIConfig:
    """CLI工具配置"""
    name: str
    display_name: str
    executable: str
    args: List[str]
    icon: str = "🤖"


# 预设的 CLI 工具配置
CLI_TOOLS = {
    "claude": CLIConfig(
        name="claude",
        display_name="Claude Code",
        executable="node",
        args=["{cli_path}", "--team-name=multicc-{instance_id}"],
        icon="🤖"
    ),
    "cmd": CLIConfig(
        name="cmd",
        display_name="命令提示符",
        executable="cmd",
        args=[],
        icon="💻"
    ),
}


class TerminalWidget(QFrame):
    """终端组件 - 使用 termqt 实现"""

    closed = pyqtSignal(object)  # 发送 self

    def __init__(self, name: str, tool_config: CLIConfig = None, parent=None):
        super().__init__(parent)
        self.name = name
        self.tool_config = tool_config or CLI_TOOLS["cmd"]
        self.terminal = None
        self.terminal_io = None
        self.conversation_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        self._is_focused = False
        self._setup_ui()

    def _setup_ui(self):
        """设置UI"""
        self.setFrameStyle(QFrame.StyledPanel | QFrame.Raised)
        self.setStyleSheet("""
            TerminalWidget {
                background-color: #1e1e1e;
                border: 2px solid #3d3d3d;
                border-radius: 5px;
            }
            TerminalWidget:focused {
                border-color: #0e639c;
            }
        """)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # 标题栏
        title_bar = QWidget()
        title_bar.setFixedHeight(32)
        title_bar.setStyleSheet("background-color: #2d2d2d;")
        title_layout = QHBoxLayout(title_bar)
        title_layout.setContentsMargins(10, 0, 10, 0)

        # 工具图标
        icon_label = QLabel(self.tool_config.icon)
        icon_label.setStyleSheet("font-size: 16px;")
        title_layout.addWidget(icon_label)

        self.title_label = QLabel(self.name)
        self.title_label.setStyleSheet("color: #ffffff; font-weight: bold; margin-left: 5px;")
        title_layout.addWidget(self.title_label)

        title_layout.addStretch()

        # 聚焦按钮
        btn_focus = QPushButton("◎")
        btn_focus.setFixedSize(24, 24)
        btn_focus.setToolTip("聚焦模式")
        btn_focus.setStyleSheet("""
            QPushButton {
                background-color: transparent;
                color: #cccccc;
                border: none;
                font-size: 14px;
            }
            QPushButton:hover {
                background-color: #0e639c;
                color: white;
            }
        """)
        btn_focus.clicked.connect(self._on_focus)
        title_layout.addWidget(btn_focus)

        # 关闭按钮
        btn_close = QPushButton("×")
        btn_close.setFixedSize(24, 24)
        btn_close.setStyleSheet("""
            QPushButton {
                background-color: transparent;
                color: #cccccc;
                border: none;
                font-size: 16px;
            }
            QPushButton:hover {
                background-color: #e81123;
                color: white;
            }
        """)
        btn_close.clicked.connect(self._on_close)
        title_layout.addWidget(btn_close)

        layout.addWidget(title_bar)

        # termqt 终端
        self.terminal = Terminal(800, 600)
        self.terminal.setStyleSheet("""
            Terminal {
                background-color: #0c0c0c;
                border: none;
            }
        """)
        layout.addWidget(self.terminal)

    def _on_focus(self):
        """聚焦按钮点击"""
        parent = self.parent()
        while parent:
            if hasattr(parent, 'focus_terminal'):
                parent.focus_terminal(self)
                break
            parent = parent.parent()

    def _on_close(self):
        """关闭按钮点击"""
        self.closed.emit(self)

    def start_process(self, cmd, env: dict = None, cwd: str = None):
        """启动进程"""
        try:
            process_env = os.environ.copy()
            if env:
                process_env.update(env)

            logger.info(f"=== 启动进程 ===")
            logger.info(f"命令: {cmd}")
            logger.info(f"工作目录: {cwd}")

            # 清理干扰环境变量
            vars_to_remove = [
                "CLAUDECODE", "claudecode",
                "CLAUDE_CODE_SESSION", "CLAUDE_SESSION_ID",
                "CLAUDE_CODE_PID", "CLAUDE_PID",
                "CLAUDE_CODE_ENTRYPOINT",
                "SETTINGS_FILE",
            ]
            for var in vars_to_remove:
                if var in process_env:
                    logger.info(f"从环境中移除: {var}")
                    del process_env[var]

            # 构建 Windows 命令字符串
            if isinstance(cmd, list):
                cmd_parts = []
                for part in cmd:
                    if ' ' in part and not part.startswith('"'):
                        cmd_parts.append(f'"{part}"')
                    else:
                        cmd_parts.append(part)
                cmd_str = ' '.join(cmd_parts)
            else:
                cmd_str = cmd

            logger.info(f"命令字符串: {cmd_str}")

            # termqt 不支持 cwd，用 cmd 包装
            if cwd:
                full_cmd = f'cmd /c "cd /d {cwd} && {cmd_str}"'
            else:
                full_cmd = cmd_str

            logger.info(f"完整命令: {full_cmd}")

            self.terminal_io = TerminalWinptyIO(
                self.terminal.row_len,
                self.terminal.col_len,
                full_cmd,
                env=process_env
            )

            self.terminal_io.stdout_callback = self.terminal.stdout
            self.terminal.stdin_callback = self.terminal_io.write
            self.terminal.resize_callback = self.terminal_io.resize

            self.terminal_io.spawn()
            logger.info(f"termqt 终端已启动")

        except Exception as e:
            import traceback
            error_msg = f"启动失败: {e}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())

    def resizeEvent(self, event):
        """窗口大小变化"""
        super().resizeEvent(event)
        if self.terminal:
            terminal_height = self.height() - 32
            self.terminal.resize(self.width(), terminal_height)

    def stop(self):
        """停止进程"""
        if self.terminal_io:
            try:
                self.terminal_io.terminate()
            except:
                pass

    def set_name(self, name: str):
        """设置名称"""
        self.name = name
        self.title_label.setText(name)

    def set_focused(self, focused: bool):
        """设置聚焦状态"""
        self._is_focused = focused
        if focused:
            self.setStyleSheet("""
                TerminalWidget {
                    background-color: #1e1e1e;
                    border: 2px solid #0e639c;
                    border-radius: 5px;
                }
            """)
        else:
            self.setStyleSheet("""
                TerminalWidget {
                    background-color: #1e1e1e;
                    border: 2px solid #3d3d3d;
                    border-radius: 5px;
                }
            """)


class ClaudeLauncher:
    """Claude Code启动配置"""

    def __init__(self):
        self.base_dir = Path(r"C:\D\CAIE_tool\ClaudeCode_WIN")
        self.config_env = self.base_dir / "config.env"
        self.cli_path = self.base_dir / "node_modules" / "@anthropic-ai" / "claude-code" / "cli.js"
        self.instance_counter = 0

    def get_api_key(self) -> Optional[str]:
        if not self.config_env.exists():
            return None
        with open(self.config_env, 'r', encoding='utf-8') as f:
            for line in f:
                if '=' in line:
                    key, value = line.strip().split('=', 1)
                    if key == "ZHIPU_API_KEY":
                        return value
        return None

    def setup_config(self, api_key: str, instance_id: int):
        """为每个实例创建独立的配置目录"""
        temp_config_dir = self.base_dir / f".temp_config_{instance_id}"
        temp_config_dir.mkdir(exist_ok=True)

        settings = {
            "env": {
                "ANTHROPIC_AUTH_TOKEN": api_key,
                "ANTHROPIC_BASE_URL": "https://open.bigmodel.cn/api/anthropic",
                "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": 1,
                "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-5",
                "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-5",
                "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-4.5-air"
            }
        }
        with open(temp_config_dir / "settings.json", 'w', encoding='utf-8') as f:
            json.dump(settings, f, indent=2)

        return temp_config_dir

    def get_launch_config(self) -> tuple:
        """获取启动配置: (cmd_list, env, cwd)"""
        if not self.cli_path.exists():
            logger.error(f"cli.js不存在: {self.cli_path}")
            return None, None, None

        api_key = self.get_api_key()
        if not api_key:
            logger.error("未找到API Key")
            return None, None, None

        logger.info(f"API Key 已获取: {api_key[:10]}...")

        self.instance_counter += 1
        temp_config_dir = self.setup_config(api_key, self.instance_counter)
        logger.info(f"配置文件已写入: {temp_config_dir / 'settings.json'}")

        env = os.environ.copy()
        env["CLAUDE_CONFIG_DIR"] = str(temp_config_dir)
        env["DO_NOT_TRACK"] = "1"

        nested_check_vars = [
            "CLAUDECODE", "claudecode",
            "CLAUDE_CODE_SESSION", "CLAUDE_SESSION_ID",
            "CLAUDE_CODE_PID", "CLAUDE_PID",
            "CLAUDE_CODE_ENTRYPOINT",
            "TERM_PROGRAM", "TERM_PROGRAM_VERSION",
        ]
        for var in nested_check_vars:
            if var in env:
                logger.info(f"移除环境变量: {var}={env[var]}")
                env.pop(var)

        if "CLAUDECODE" in env:
            logger.warning("CLAUDECODE 仍然存在！")
        else:
            logger.info("CLAUDECODE 已成功移除")

        portable_git = self.base_dir / "PortableGit" / "bin"
        if portable_git.exists():
            env["CLAUDE_CODE_GIT_BASH_PATH"] = str(portable_git / "bash.exe")
            env["PATH"] = str(portable_git) + os.pathsep + env.get("PATH", "")
            logger.info(f"PortableGit 已配置: {portable_git}")

        node_path = shutil.which("node")
        if not node_path:
            node_path = r"C:\Program Files\nodejs\node.exe"
            if not os.path.exists(node_path):
                logger.error("未找到 node.exe")
                return None, None, None

        cmd_list = [node_path, str(self.cli_path), f"--team-name=multicc-{self.instance_counter}"]
        logger.info(f"启动命令: {cmd_list}")
        return cmd_list, env, str(self.base_dir)


class TerminalContainer(QWidget):
    """终端容器 - 平铺布局 + 聚焦模式"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.terminals: List[TerminalWidget] = []
        self.focused_terminal: Optional[TerminalWidget] = None
        self._focus_mode = False
        self._setup_ui()

    def _setup_ui(self):
        """设置UI"""
        self.main_layout = QHBoxLayout(self)
        self.main_layout.setContentsMargins(5, 5, 5, 5)
        self.main_layout.setSpacing(5)

        # 主区域 (平铺终端)
        self.grid_widget = QWidget()
        self.grid_layout = QGridLayout(self.grid_widget)
        self.grid_layout.setContentsMargins(0, 0, 0, 0)
        self.grid_layout.setSpacing(5)

        # 侧边栏 (聚焦模式下显示缩小的终端)
        self.sidebar = QListWidget()
        self.sidebar.setFixedWidth(150)
        self.sidebar.setStyleSheet("""
            QListWidget {
                background-color: #2d2d2d;
                border: none;
                color: #cccccc;
            }
            QListWidget::item {
                padding: 10px;
                border-bottom: 1px solid #3d3d3d;
            }
            QListWidget::item:selected {
                background-color: #0e639c;
            }
        """)
        self.sidebar.itemClicked.connect(self._on_sidebar_click)
        self.sidebar.hide()

        self.main_layout.addWidget(self.grid_widget, 1)
        self.main_layout.addWidget(self.sidebar)

    def add_terminal(self, terminal: TerminalWidget):
        """添加终端"""
        self.terminals.append(terminal)
        terminal.closed.connect(self._on_terminal_closed)
        self._relayout()

    def remove_terminal(self, terminal: TerminalWidget):
        """移除终端"""
        if terminal in self.terminals:
            terminal.stop()
            self.terminals.remove(terminal)
            if self.focused_terminal == terminal:
                self.focused_terminal = None
                self._focus_mode = False
                self.sidebar.hide()
            terminal.deleteLater()
            self._relayout()

    def _on_terminal_closed(self, terminal: TerminalWidget):
        """终端关闭事件"""
        self.remove_terminal(terminal)

    def _on_sidebar_click(self, item: QListWidgetItem):
        """侧边栏点击事件"""
        idx = self.sidebar.row(item)
        if 0 <= idx < len(self.terminals):
            self.focus_terminal(self.terminals[idx])

    def focus_terminal(self, terminal: TerminalWidget):
        """聚焦到指定终端"""
        if self._focus_mode and self.focused_terminal == terminal:
            # 退出聚焦模式
            self._focus_mode = False
            self.focused_terminal = None
            self.sidebar.hide()
            self._relayout()
        else:
            # 进入聚焦模式
            self._focus_mode = True
            self.focused_terminal = terminal
            self._show_focus_mode()

    def _show_focus_mode(self):
        """显示聚焦模式"""
        # 清除网格布局
        for i in reversed(range(self.grid_layout.count())):
            self.grid_layout.itemAt(i).widget().setParent(None)

        # 更新侧边栏
        self.sidebar.clear()
        for t in self.terminals:
            item = QListWidgetItem(f"{t.tool_config.icon} {t.name}")
            self.sidebar.addItem(item)
            if t == self.focused_terminal:
                self.sidebar.setCurrentItem(item)

        self.sidebar.show()

        # 只显示聚焦的终端
        if self.focused_terminal:
            self.focused_terminal.setParent(self.grid_widget)
            self.grid_layout.addWidget(self.focused_terminal, 0, 0)

    def _relayout(self):
        """重新布局"""
        if self._focus_mode:
            self._show_focus_mode()
            return

        self.sidebar.hide()

        # 清除现有布局
        for i in reversed(range(self.grid_layout.count())):
            self.grid_layout.itemAt(i).widget().setParent(None)

        n = len(self.terminals)
        if n == 0:
            return

        # 计算布局
        if n == 1:
            cols, rows = 1, 1
        elif n == 2:
            cols, rows = 2, 1
        elif n <= 4:
            cols, rows = 2, 2
        elif n <= 6:
            cols, rows = 3, 2
        else:
            cols, rows = 3, 3

        # 添加终端到布局
        for i, terminal in enumerate(self.terminals):
            row = i // cols
            col = i % cols
            terminal.setParent(self.grid_widget)
            self.grid_layout.addWidget(terminal, row, col)

        # 设置拉伸因子
        for i in range(cols):
            self.grid_layout.setColumnStretch(i, 1)
        for i in range(rows):
            self.grid_layout.setRowStretch(i, 1)

    def clear_all(self):
        """清除所有终端"""
        for terminal in self.terminals[:]:
            terminal.stop()
            terminal.deleteLater()
        self.terminals.clear()
        self.focused_terminal = None
        self._focus_mode = False
        self._relayout()


class MultiCCManager(QMainWindow):
    """多窗口管理器主窗口"""

    def __init__(self):
        super().__init__()

        self.launcher = ClaudeLauncher()
        self.window_counter = 0
        self.conversations: List[Conversation] = []

        self._setup_ui()
        self._load_conversations()

    def _setup_ui(self):
        """设置UI"""
        self.setWindowTitle("Claude Code 多窗口管理器 - Windows版")
        self.setGeometry(100, 100, 1400, 900)

        # 深色主题
        self.setStyleSheet("""
            QMainWindow {
                background-color: #1e1e1e;
            }
            QPushButton {
                background-color: #0e639c;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                font-size: 13px;
            }
            QPushButton:hover {
                background-color: #1177bb;
            }
            QPushButton:pressed {
                background-color: #0d5a8a;
            }
            QLabel {
                color: #cccccc;
            }
            QTabWidget::pane {
                border: 1px solid #3d3d3d;
                background-color: #1e1e1e;
            }
            QTabBar::tab {
                background-color: #2d2d2d;
                color: #cccccc;
                padding: 8px 16px;
                border: 1px solid #3d3d3d;
            }
            QTabBar::tab:selected {
                background-color: #0e639c;
            }
        """)

        # 工具栏
        toolbar = QWidget()
        toolbar.setFixedHeight(50)
        toolbar.setStyleSheet("background-color: #2d2d2d;")
        toolbar_layout = QHBoxLayout(toolbar)
        toolbar_layout.setContentsMargins(15, 10, 15, 10)

        # 启动按钮
        btn_launch = QPushButton("🤖 启动 Claude Code")
        btn_launch.clicked.connect(self.launch_claude)
        toolbar_layout.addWidget(btn_launch)

        btn_cmd = QPushButton("💻 启动 CMD")
        btn_cmd.clicked.connect(self.launch_cmd)
        toolbar_layout.addWidget(btn_cmd)

        btn_close_all = QPushButton("关闭所有")
        btn_close_all.clicked.connect(self.close_all)
        toolbar_layout.addWidget(btn_close_all)

        toolbar_layout.addStretch()

        # 状态标签
        self.status_label = QLabel("点击按钮启动终端")
        toolbar_layout.addWidget(self.status_label)

        # 终端容器
        self.container = TerminalContainer()

        # 主布局
        main_widget = QWidget()
        main_layout = QVBoxLayout(main_widget)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)
        main_layout.addWidget(toolbar)
        main_layout.addWidget(self.container)

        self.setCentralWidget(main_widget)

    def _load_conversations(self):
        """加载历史对话"""
        for conv_file in CONVERSATIONS_DIR.glob("*.json"):
            try:
                with open(conv_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    conv = Conversation(
                        id=data['id'],
                        name=data['name'],
                        tool=data['tool'],
                        created_at=datetime.fromisoformat(data['created_at']),
                        last_active=datetime.fromisoformat(data['last_active']),
                        working_dir=data.get('working_dir', ''),
                        messages=data.get('messages', [])
                    )
                    self.conversations.append(conv)
            except Exception as e:
                logger.error(f"加载对话失败: {e}")

    def launch_claude(self):
        """启动新的 Claude Code 实例"""
        logger.info(">>> 用户点击启动 Claude Code")
        cmd, env, cwd = self.launcher.get_launch_config()

        if not cmd:
            logger.error("获取启动配置失败")
            QMessageBox.critical(
                self, "错误",
                "无法获取Claude Code配置！\n请检查config.env和cli.js是否存在。"
            )
            return

        self.window_counter += 1
        name = f"Claude {self.window_counter}"
        logger.info(f"准备启动: {name}")

        terminal = TerminalWidget(name, CLI_TOOLS["claude"])
        self.container.add_terminal(terminal)
        terminal.start_process(cmd, env, cwd)

        self.status_label.setText(f"已启动 {name}，共 {len(self.container.terminals)} 个窗口")
        logger.info(f"<<< {name} 启动完成")

    def launch_cmd(self):
        """启动 CMD 终端"""
        logger.info(">>> 用户点击启动 CMD")
        self.window_counter += 1
        name = f"CMD {self.window_counter}"

        terminal = TerminalWidget(name, CLI_TOOLS["cmd"])
        self.container.add_terminal(terminal)
        terminal.start_process(["cmd"], cwd=os.getcwd())

        self.status_label.setText(f"已启动 {name}，共 {len(self.container.terminals)} 个窗口")
        logger.info(f"<<< {name} 启动完成")

    def focus_terminal(self, terminal: TerminalWidget):
        """聚焦到指定终端"""
        self.container.focus_terminal(terminal)

    def close_terminal(self, terminal: TerminalWidget):
        """关闭指定终端"""
        reply = QMessageBox.question(
            self, "确认",
            f"确定要关闭 {terminal.name} 吗？",
            QMessageBox.Yes | QMessageBox.No
        )

        if reply == QMessageBox.Yes:
            self.container.remove_terminal(terminal)
            self.status_label.setText(f"已关闭，剩余 {len(self.container.terminals)} 个窗口")

    def close_all(self):
        """关闭所有终端"""
        if not self.container.terminals:
            return

        reply = QMessageBox.question(
            self, "确认",
            "确定要关闭所有窗口吗？",
            QMessageBox.Yes | QMessageBox.No
        )

        if reply == QMessageBox.Yes:
            self.container.clear_all()
            self.status_label.setText("已关闭所有窗口")

    def closeEvent(self, event):
        """关闭窗口"""
        self.container.clear_all()
        event.accept()


def main():
    app = QApplication(sys.argv)
    app.setStyle('Fusion')

    # 深色调色板
    palette = QPalette()
    palette.setColor(QPalette.Window, QColor(30, 30, 30))
    palette.setColor(QPalette.WindowText, QColor(204, 204, 204))
    palette.setColor(QPalette.Base, QColor(12, 12, 12))
    palette.setColor(QPalette.AlternateBase, QColor(45, 45, 45))
    palette.setColor(QPalette.Text, QColor(204, 204, 204))
    palette.setColor(QPalette.Button, QColor(45, 45, 45))
    palette.setColor(QPalette.ButtonText, QColor(204, 204, 204))
    palette.setColor(QPalette.Highlight, QColor(14, 99, 156))
    palette.setColor(QPalette.HighlightedText, QColor(255, 255, 255))
    app.setPalette(palette)

    window = MultiCCManager()
    window.show()

    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
