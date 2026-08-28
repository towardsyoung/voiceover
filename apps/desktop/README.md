# 小阳哥数字人口播工作台桌面版

Electron 主进程在本机动态端口启动同一套 Express API，并通过 Express 提供 `apps/web/dist`。应用仅绑定 `127.0.0.1`。

## 数据与资源

- 用户数据目录固定为 `xiaoyang-voiceover`，不随中文显示名称变化。
- macOS：`~/Library/Application Support/xiaoyang-voiceover/data`
- Windows：`%APPDATA%/xiaoyang-voiceover/data`
- `@ffmpeg-installer/ffmpeg` 和 `@ffprobe-installer/ffprobe` 按目标平台随安装包分发。
- `prompts/`、`skills/` 和前端构建产物通过 `extraResources` 分发。
- 安装包不包含仓库根目录的 `.env`、`data/` 或 `tmp/`。

## 本机开发

需要 Node 20+、pnpm 11.11.0：

```bash
pnpm install
pnpm build
pnpm desktop
```

打包当前平台：

```bash
pnpm package:mac
pnpm package:win
```

macOS 只生成 Apple Silicon DMG；Windows 只生成 x64 NSIS EXE。含 `better-sqlite3`，应在目标平台原生构建。

## GitHub 发布

- PR 和 `main` 推送运行 `.github/workflows/ci.yml`。
- 手动运行 `Desktop Package` 只生成 Actions Artifacts，保留 14 天。
- 推送 `v*` Tag 会创建 GitHub Pre-release。
- Tag 必须与 `apps/desktop/package.json` 版本一致，例如 `0.1.0` 对应 `v0.1.0`。

```bash
git tag v0.1.0
git push origin v0.1.0
```

产物：

```text
xiaoyang-voiceover-0.1.0-mac-arm64.dmg
xiaoyang-voiceover-0.1.0-win-x64.exe
SHA256SUMS.txt
```

首版不签名。macOS 用户首次运行需要右键应用选择“打开”；Windows 可能显示 SmartScreen 提示。

## 退出与恢复

Worker 正忙时关闭应用会先确认。确认后停止领取新任务，并释放本机 Worker 租约：

- 已保存 `provider_request_id` 的云端视频任务在下次启动时继续轮询，不重复提交。
- 本地拼接任务在下次启动时重新执行当前步骤。
- 制板任务重新排队。

## 首版边界

- 单机、单用户。
- 全新空数据。
- 用户自行配置模型 Key。
- Key 明文保存在本机 SQLite，仅用于内部测试。
- 不做自动更新、代码签名、数据导入导出、后台常驻或多用户访问。
