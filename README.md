# 数字人口播工作台

本地 / 内网工作台：人物、场景、音色入库，再按口播稿分镜出片。

## 一期启动

需要 Node 20+、pnpm、本机 ffmpeg。

```bash
cp .env.example .env
pnpm install
bash scripts/rebuild-native.sh   # better-sqlite3 原生模块
chmod +x scripts/dev.sh
./scripts/dev.sh
```

- 工作台：http://127.0.0.1:5173
- API：http://127.0.0.1:18787/api/health（避开本机已被占用的 8787）

只监听本机。数据在 `data/`（可用 `DATA_DIR` 改）。

当前已接通：资产库 CRUD、成品板上传、音色录音/上传转 WAV、制板任务队列、口播分镜（可编辑表）、出片 API 与任务详情。

- 模型：启动后进入「设置 → 模型设置」，填写 LLM、图片或视频模型参数；未配置完整的模型不会启用，也不会出现在制作页。
- 真人 Seedance 的火山素材库和 OSS 辅助配置仍通过本机 `.env` 设置。

## Electron 桌面版

桌面版名称为“小阳哥数字人口播工作台”，支持 macOS Apple Silicon 和 Windows x64。应用内置 Node 运行时、ffmpeg/ffprobe，用户数据保存在系统用户目录，不包含开发机的 `.env` 或 `data/`。

```bash
pnpm install
pnpm build
pnpm desktop
```

本机打包：

```bash
pnpm package:mac
pnpm package:win
```

GitHub Actions 可手动生成测试安装包；推送与 `apps/desktop/package.json` 版本一致的 `v*` Tag 会创建包含 DMG、EXE 和校验值的 GitHub Pre-release。详见 `apps/desktop/README.md`。

## 文档

- `doc/数字人口播工作台-产品需求.md`
- `doc/数字人口播工作台-技术方案.md`
- `skills/koubo/SKILL.md`
- `prompts/`
  
## 下载地址
Mac：https://github.com/towardsyoung/voiceover/actions/runs/33229322045/artifacts/9707986048
Windows：https://github.com/towardsyoung/voiceover/actions/runs/33229322045/artifacts/9708030146
