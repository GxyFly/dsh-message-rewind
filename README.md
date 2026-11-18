# DSH Message Rewind

针对 DeepSeek Harness Desktop **0.2.2-rc.3** 的开源插件。在用户消息下方显示复制和铅笔按钮；点击铅笔原位编辑，取消不改变历史，发送从消息之前的安全历史前缀创建分支。原对话保留，成功后自动切换到新版本。编辑框采用浅灰圆角背景，右下角提供“取消”和“发送”。

## 安装

从 [Releases](https://github.com/GxyFly/dsh-message-rewind/releases) 下载 `dsh-message-rewind-0.1.2.tgz`。使用 Desktop 自带 CLI 安装已构建的包，不要安装到另一个 CLI 的 web profile。以下为 Windows 示例，请将两处路径替换成实际安装目录和下载位置：

```powershell
& 'C:\path\to\dsh\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add 'C:\path\to\downloads\dsh-message-rewind-0.1.2.tgz'
```

重新加载应用或重启后生效。卸载使用同一 CLI：`plugin --profile desktop remove dsh-message-rewind`。

## 使用

在已停止运行的普通会话中，点击历史用户消息下方的铅笔。修改后点击“发送”，或按 Ctrl+Enter。Esc 或“取消”退出编辑。旧会话仍保留在工作区。

这是上下文回退，**不会恢复工作区文件、长期记忆或外部系统状态**。新分支仍能读到当前文件。第一版支持纯文本普通用户消息；附件消息、同轮 steering、不能保留完整前文的排队消息会明确拒绝，不会静默丢内容。原来的附件仍由 DSH 原生内容组件展示。

## 实现

Host 入口只声明插件；Client 通过公开 `conversation.chat.node` keyed Slot 替换 user 渲染器，并复用原生 `conversation.chat.user.content` Factory。操作通过宿主原有、受权限控制的 Session API 执行，不增开 HTTP 服务，不改应用安装包。

提交前加载完整历史。按事件日志计算目标消息之前、轮次已关闭且输入队列为空的历史前缀；验证所有更早的用户消息仍在前缀内。调用内置 fork，再用新 requestId 提交新文本。新分支不会继承切点之后的消息、工具结果和压缩摘要。

分支创建成功后先将进度写入浏览器 sessionStorage，再提交消息。发送重试复用分支和 requestId；同一窗口刷新可恢复此进度。若 fork 请求的响应丢失，宿主 fork API 本身没有幂等键，可能留下未发送消息的空分支；不会将它当作成功。恢复记录包含编辑文字，不会发送给额外第三方。关闭窗口可能清除 sessionStorage。

同一 UI 检查期间若历史改变则拒绝提交；跨客户端同时继续会话没有宿主原子锁，属于本版限制。全局长期记忆、后台任务等外部状态不由本插件恢复。

## 开发与验证

无构建时第三方依赖：`node build.mjs` 生成 Host 和浏览器闭包模块，`node --test tests/*.test.mjs` 检查历史切点与失败重试。发布包包含源码和构建结果。

插件固定适配 0.2.2-rc.3，升级 DSH 前需要重新检查 Slot、Session fork、输入队列与消息协议。

## 已完成的本机验证

9 项自动测试通过。已在 Windows Desktop 0.2.2-rc.3 中验证铅笔入口、原位编辑、Esc 取消、发送、自动切换分支，以及失败重试复用同一分支。真实模型对修改后的测试消息返回 `REWIND_OK`。对新分支持久化日志使用安装版本的 `Session.deriveMessages()` 核对：只有修改后的一个普通用户输入，原用户消息和原助手回答均未进入派生上下文；重新打开日志后派生结果一致。测试原会话保留。其他系统与 DSH 版本尚未验证。

## 许可证

[MIT](LICENSE)。本项目是独立第三方插件，与 DeepSeek 和 OpenAI 无隶属关系。
