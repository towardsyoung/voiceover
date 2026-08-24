# desktop（二期）

一期不实现 Electron 打包。源码启动用仓库根目录 `scripts/dev.sh`。

二期对照 `/Users/naodoo/data/duanju/Toonflow-app`：

- 主进程拉起同一套 Express，只绑 `127.0.0.1`
- `DATA_DIR` 落 `app.getPath("userData")/data`
- `better-sqlite3` 进 `asarUnpack`

API 与 UI 协议不变。
