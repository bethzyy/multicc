' launch.vbs - 隐藏窗口启动 MultiCC
' 使用 Windows Script Host 隐藏 cmd 窗口

Set WShell = CreateObject("WScript.Shell")
' 第一个参数: 命令行
' 第二个参数: 0 = 隐藏窗口
' 第三个参数: False = 不等待程序结束
WShell.Run "cmd /c npm run dev", 0, False
