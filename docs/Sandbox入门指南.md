# Sandbox（沙箱）入门指南

## 什么是 Sandbox？

**Sandbox（沙箱）** 是一种安全机制，用于在隔离的环境中运行程序或代码，限制其对系统资源的访问，防止潜在的有害操作影响主系统。

### 核心概念

```
┌─────────────────────────────────────┐
│           主系统 (Host)              │
│  ┌───────────────────────────────┐  │
│  │      沙箱环境 (Sandbox)       │  │
│  │  ┌─────────┐  ┌─────────┐     │  │
│  │  │ 程序 A  │  │ 程序 B  │     │  │
│  │  └─────────┘  └─────────┘     │  │
│  └───────────────────────────────┘  │
│         ↕️ 受限的通信                 │
└─────────────────────────────────────┘
```

**关键特性：**
- **隔离性**: 沙箱内的操作不会直接影响主系统
- **限制性**: 对文件系统、网络、系统资源的访问受限
- **可监控**: 可以监控和记录沙箱内的所有操作
- **可丢弃**: 沙箱可以随时清空或重置

---

## 为什么需要 Sandbox？

### 1. **安全性**
- 运行不可信的代码而不担心感染病毒
- 测试恶意软件样本
- 防止零日漏洞攻击

### 2. **开发测试**
- 隔离开发环境，不影响主系统
- 测试不稳定的代码
- 快速重置测试环境

### 3. **生产部署**
- 容器化应用（Docker）
- 微服务隔离
- 云计算环境

---

## Sandbox 的类型

### 1. **操作系统级沙箱**

| 类型 | 特点 | 示例 |
|------|------|------|
| 虚拟机 | 完整的操作系统隔离 | VirtualBox, VMware |
| 容器 | 轻量级进程隔离 | Docker, Podman |
| 用户命名空间 | Linux 内核级隔离 | LXC, systemd-nspawn |
| Windows Sandbox | Windows 10/11 内置 | Windows Sandbox |

**示例 - Docker 容器：**
```bash
# 创建并运行一个隔离的容器
docker run -it --rm ubuntu:22.04 bash

# 在容器内操作（与主机隔离）
root@container:/# rm -rf /bin  # 只影响容器，不影响主机
root@container:/# exit         # 退出后容器自动删除

# 主机不受影响
```

---

### 2. **应用程序级沙箱**

| 类型 | 特点 | 示例 |
|------|------|------|
| 浏览器沙箱 | 隔离网页进程 | Chrome Sandbox, Firefox |
| PDF 阅读器 | 防止恶意 PDF | Adobe Reader Protected Mode |
| 移动应用沙箱 | 应用权限隔离 | iOS App Sandbox, Android Sandbox |
| 代码编辑器 | 插件隔离 | VS Code Extension Host |

**示例 - Chrome 浏览器沙箱：**
```
┌─────────────────────────────────┐
│      Chrome 主进程               │
│  ┌──────────┐  ┌──────────┐    │
│  │ 渲染进程  │  │ 插件进程  │    │
│  │ (沙箱)   │  │ (沙箱)   │    │
│  └──────────┘  └──────────┘    │
│         ↕️ IPC 通信              │
│    (受限的系统调用)              │
└─────────────────────────────────┘
```

---

### 3. **编程语言级沙箱**

| 语言/环境 | 沙箱机制 | 用途 |
|-----------|----------|------|
| Python | `RestrictedPython`, `pypy` sandbox | 安全执行用户代码 |
| JavaScript | Web Workers, iframe | 隔离前端代码 |
| Java | SecurityManager | 类加载隔离 |
| Node.js | `vm` 模块 | 运行不可信代码 |

**示例 - Node.js VM 模块：**
```javascript
const vm = require('vm');

const sandbox = {
  x: 1,
  log: console.log
};

// 在隔离上下文中执行代码
vm.runInNewContext('x += 10; log(x);', sandbox);
// 输出: 11

// 原始环境不受影响
console.log(typeof x); // undefined
```

---

### 4. **Web/服务沙箱**

| 类型 | 特点 | 示例 |
|------|------|------|
| Serverless | 函数级隔离 | AWS Lambda, Cloudflare Workers |
| API 代理 | 请求转发隔离 | CORS 代理 |
| 在线代码执行 | 临时容器运行 | Repl.it, CodeSandbox |

---

## 实际应用场景

### 场景 1: 开发环境隔离

```bash
# 使用 Docker 创建隔离的开发环境
docker run -v $(pwd):/app -w /app node:18 bash

# 在容器内安装依赖、运行测试，不影响主机
npm install
npm test
```

**好处：**
- 保持主机环境干净
- 轻松切换不同版本的工具
- 团队开发环境一致

---

### 场景 2: 测试不可信代码

```python
import subprocess
import tempfile
import os

def run_untrusted_code(code: str):
    """在临时目录（沙箱）中运行不可信代码"""
    with tempfile.TemporaryDirectory() as tmpdir:
        # 写入代码文件
        code_file = os.path.join(tmpdir, 'script.py')
        with open(code_file, 'w') as f:
            f.write(code)

        # 在受限环境中运行（仅示例，实际需要更多安全措施）
        result = subprocess.run(
            ['python', code_file],
            capture_output=True,
            timeout=5,
            cwd=tmpdir  # 限制在临时目录
        )
        return result.stdout
```

---

### 场景 3: 浏览器隔离恶意网站

使用 **Chrome Sandbox**：
- 每个标签页在独立进程中运行
- 限制对文件系统的访问
- 恶意网站无法窃取系统文件

---

### 场景 4: CI/CD 管道

```yaml
# GitHub Actions 示例
jobs:
  test:
    runs-on: ubuntu-latest
    container:
      image: node:18
    steps:
      - uses: actions/checkout@v3
      - run: npm install
      - run: npm test
```

**沙箱特性：**
- 每个 job 在新容器中运行
- 测试失败不影响其他 job
- 自动清理环境

---

## Claude Code 中的 Sandbox

### `dangerouslyDisableSandbox` 参数

在 Claude Code 的 Bash 工具中有一个 `dangerouslyDisableSandbox` 选项：

```typescript
// 默认模式（启用沙箱）
executeCommand(command, { timeout: 120000 })  // ✅ 安全

// 危险模式（禁用沙箱）
executeCommand(command, { dangerouslyDisableSandbox: true })  // ⚠️ 风险
```

**沙箱保护的内容：**
- 限制对系统关键文件的访问
- 防止执行破坏性命令（如 `rm -rf /`）
- 限制网络访问
- 限制对进程管理的操作

**何时禁用沙箱：**
- 需要访问系统级工具（如 Docker、systemd）
- 开发环境中需要完全权限
- **必须清楚风险且信任执行的代码**

---

## 常用 Sandbox 工具

### 开发/测试工具

| 工具 | 类型 | 难度 | 适用场景 |
|------|------|------|----------|
| **Docker** | 容器 | ⭐⭐ | 应用隔离、开发环境 |
| **Vagrant** | 虚拟机 | ⭐⭐⭐ | 完整系统模拟 |
| **Python venv** | 虚拟环境 | ⭐ | Python 依赖隔离 |
| **Node.js vm** | 语言级 | ⭐⭐ | JavaScript 代码隔离 |

### 安全分析工具

| 工具 | 用途 |
|------|------|
| **Cuckoo Sandbox** | 恶意软件分析 |
| **Joe Sandbox** | 高级威胁分析 |
| **Firejail** | Linux 应用沙箱 |
| **Sandboxie** | Windows 应用沙箱 |

### 在线平台

| 平台 | 链接 |
|------|------|
| CodeSandbox | https://codesandbox.io |
| Replit | https://replit.com |
| StackBlitz | https://stackblitz.com |

---

## 最佳实践

### ✅ 应该做

1. **默认使用沙箱** - 除非有明确理由，否则始终在沙箱中运行不可信代码
2. **最小权限原则** - 只授予必要的权限
3. **定期更新** - 保持沙箱工具和系统更新
4. **监控日志** - 记录沙箱内的所有操作
5. **测试后再信任** - 在沙箱中充分测试后再在生产环境运行

### ❌ 不应该做

1. **在沙箱外运行未知代码** - 即使代码看起来无害
2. **在沙箱中输入敏感信息** - 沙箱可能不是完全隔离的
3. **假设沙箱无敌** - 沙箱可能被绕过（沙箱逃逸漏洞）
4. **禁用沙箱"因为方便"** - 安全永远是优先的
5. **在沙箱中存储重要数据** - 沙箱可以被随时清除

---

## 沙箱逃逸（Sandbox Escape）

**定义**: 攻击者利用漏洞突破沙箱限制，访问主系统。

**历史案例：**
- 2019: Chrome 沙箱逃逸漏洞（CVE-2019-13720）
- 2021: macOS Gatekeeper 绕过
- 2023: Docker 容器逃逸（runC 漏洞）

**防护措施：**
- 使用多层防御（沙箱 + 网络隔离 + 权限管理）
- 定期更新沙箱软件
- 监控异常行为

---

## 学习资源

### 入门教程
- [Docker 官方教程](https://docs.docker.com/get-started/)
- [Chrome 沙箱架构](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/design/sandbox.md)
- [Linux Namespace 机制](https://man7.org/linux/man-pages/man7/namespaces.7.html)

### 进阶阅读
- [Chrome Security](https://www.chromium.org/Home/chromium-security)
- [Docker 安全最佳实践](https://docs.docker.com/engine/security/)
- [容器安全指南](https://github.com/silverhammermba/nuke)

---

## 快速上手示例

### 1. Docker 隔离环境（5 分钟）

```bash
# 安装 Docker 后运行
docker run -it ubuntu:22.04 bash

# 在容器内（完全隔离）
apt update && apt install -y python3
echo "Hello from sandbox!" > /tmp/test.txt
cat /tmp/test.txt
exit  # 容器自动删除
```

### 2. Python 虚拟环境（2 分钟）

```bash
# 创建虚拟环境
python3 -m venv my_sandbox

# 激活
source my_sandbox/bin/activate  # Linux/Mac
# 或
my_sandbox\Scripts\activate     # Windows

# 安装包（仅在这个环境中）
pip install requests

# 退出
deactivate
```

### 3. 浏览器沙箱测试

访问 [https://www.browsersandbox.io](https://www.browsersandbox.io) 在线测试不同浏览器的沙箱隔离效果。

---

## 总结

**Sandbox = 安全隔离环境**

| 场景 | 推荐方案 |
|------|----------|
| 开发环境隔离 | Docker / venv |
| 测试未知代码 | VM / Firejail |
| 生产部署 | Kubernetes / Container |
| 浏览网页 | Chrome Sandbox（内置） |
| CI/CD | GitHub Actions（容器） |

**记住：** 沙箱不是万能的，但是安全策略的重要组成部分。始终采用纵深防御（Defense in Depth）策略。

---

**文档版本**: 1.0
**最后更新**: 2026-03-04
**作者**: Claude Code
