# 场景多视图表提示词

产品交付物固定为一张 2×2 空场景板：**正面主机位、斜侧 45°、远景建立、讲台/桌面特写**。

短剧真人都市场景手册要求「单张全景、禁止四宫格」。口播资产需要多机位，因此 **布局不跟短剧**，只借空场、光源、使用痕迹、禁人、禁字。

部分参考：

- `/Users/naodoo/data/duanju/Toonflow-app/data/skills/art_skills/realpeople_modern_city/art_prompt/art_scene.md`
- `/Users/naodoo/data/duanju/Toonflow-app/src/routes/ecommerceCopy/generateAssetRef.ts` 的 `SCENE_HARD_RULES`

## 系统模板

先拼 `prompts/style-prefix.md`，再拼下面正文。

```text
制作一张空场景多视图表。单张图片，2×2 四格，四格必须是同一房间、同一陈设、同一灯光色温。
真人实拍摄影质感，非 3D 渲染、非效果图、非样板间。

# 布局
左上 图1 正面主机位：适合口播胸像的机位空间，讲台/演播桌在画面中下，背景干净可辨。
右上 图2 斜侧 45°：同一空间，交代桌/台与墙、窗、灯的相对位置。
左下 图3 远景建立：交代门窗、桌椅、灯光和房间纵深。
右下 图4 讲台或桌面特写：无人，看材质、话筒位、台面磨损，不要手。

# 空场（不可违反）
画面绝对不能出现人物、人影、人体轮廓、剪影、肢体、手。
空，但有叙事：椅子未完全归位、水杯、台灯光、线材——刚要开场或刚散场。
道具只静置，不被持有、不被使用中。

# 光与空间
光源可追溯（窗光方向 + 哪盏灯），不要无方向的均匀假光。
室内口播默认：面光/柔光箱为主，可有一盏实灯光或窗光辅，色温稳定。
材质有使用痕迹，不要全新售楼处。

# 负面
people, person, human figure, silhouette, hand, finger,
text, watermark, signature, logo, subtitle, border,
3D render, CGI, Unreal, showroom, brand new, pristine,
古风仙侠、赛博朋克、与简介无关的奇幻空间。

场景名称：{name}
场景简介：{bio}
补充：{user_prompt}
```

画幅：`1536×1024`。文生走 generations；图生把用户图当参考；上传成品板只校验后入库。

## 从短剧刻意不抄的部分

| 短剧 | 口播 |
|---|---|
| 单张全景，严禁 2×2 | 必须 2×2 四机位 |
| 强制中国都市巷弄/店招辨识 | 按用户场景（演播室/讲台/教室/会议室） |
| 24–28mm 广角装下整场 | 主机位格按口播胸像机位构图，远景格才交代全场 |
