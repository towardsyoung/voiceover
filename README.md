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

当前已接通：资产库 CRUD、成品板上传、音色录音/上传转 WAV、制板任务队列、口播分镜（可编辑表）、出片 API 与任务详情已接通；默认 FEATURE_VIDEO_GEN=0，开启需 ARK_API_KEY。

- 制板：`.env` 设 `FEATURE_IMAGE_GEN=1`，并填写 `IMAGE_BASE_URL` / `IMAGE_API_KEY` / `IMAGE_MODEL`（任意 OpenAI 兼容图片网关）。
- 分镜：填写 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`（国产 OpenAI 兼容网关）。
- 视频生成仍默认关（`FEATURE_VIDEO_GEN=0`）。

## 文档

- `doc/数字人口播工作台-产品需求.md`
- `doc/数字人口播工作台-技术方案.md`
- `skills/koubo/SKILL.md`
- `prompts/`
