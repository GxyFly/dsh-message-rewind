# DSH 消息撤回

DeepSeek Harness 桌面插件。点历史消息下方的铅笔，修改并发送后，**仍在原对话里继续**。例如原对话是 A → B → C，编辑 B 后会变成 A → B′：A 及其回复保留，旧 B、C 及回复退出聊天视图和后续模型请求。

## 安装

**v0.1.5 适配 DSH Desktop 0.2.2-rc.5。** 从 [GitHub Releases](https://github.com/GxyFly/dsh-message-rewind/releases) 下载 `.tgz`，用 Desktop 自带 CLI 安装，再重启 DSH。Windows 示例，请按实际位置替换路径：

```powershell
& 'C:\path\to\dsh\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add 'C:\path\to\dsh-message-rewind-0.1.5.tgz'
```

卸载：用同一 CLI 执行 `plugin --profile desktop remove dsh-message-rewind`。已回退的模型上下文不会因此改回去；卸载后原生界面可能再次显示本地日志里的旧轮次。

## 使用

1. 等当前对话结束运行，点击要修改的用户消息下方的铅笔。
2. 按 **Enter** 或点击「发送」。**Shift+Enter** 换行；输入法确认候选词时，Enter 不会发送。
3. 按 Esc 或点击「取消」可退出编辑。

支持每轮一条的纯文本用户消息。暂不支持带附件或同轮追加的消息；如果无法安全核对历史，插件会拒绝提交。旧分支仍保存在 DSH 本地日志中；工作区文件、长期记忆和外部操作不会回滚。

## 构建与验证

使用 Node.js 24.9 或更高版本。运行 `npm run build` 构建，`npm test` 测试，`npm pack` 打包。将 `DSH_SESSION_MODULE` 指向已安装的 `@deepseek-ai/dsh-session` ESM 入口，可额外运行 Session 引擎回放测试。

v0.1.5 已在独立的 rc.5 环境验证同一会话重发、聊天显示和重启后结果；模型上下文由实际 Session 引擎核对。该环境未配置模型凭据。

[MIT 许可证](LICENSE)。本项目是独立第三方插件。
