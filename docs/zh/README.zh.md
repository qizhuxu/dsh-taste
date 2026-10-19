> 本文是 `README.md` 的简体中文翻译。
> 上游项目：Leonxlnx/taste-skill（commit b9ca2fd8）。
> 译文与英文原文如有出入，以英文原文为准。

# tasteskill v2（`design-taste-frontend`）

一个面向编码代理的设计技能，基于对 247 个精选站点（One Page Love 与 Awwwards
Sites of the Day，2026 年 10 月）的研究构建。它给代理一个艺术方向，而不是任由它退回
到那种平庸的落地页；它把代理约束在一套严格的无装饰自定风格之下，并让代理在宣布
工作完成之前先看自己的渲染结果。

## 工作方式

1. **盘点。** 代理列出只有这个客户才有的东西：名称及其含义、街道、数字、唯一的约束、
   材料、营业时间。
2. **抽取。** `scripts/draw.mjs` 从 20 个方向中发三张（每个方向都是一台创意引擎，出自
   研究中表现最强的站点）；代理选出能够承载盘点中某项内容的那一个，脚本再发其余的：
   首屏构图、各分区构图、由真实免费字体构成的字体系统、配色、照片、动效、参考案例，
   以及每个蓝图之下与其自定规则相冲突之处的一份清单。近期的抽取会被记住，以免
   项目重复。
3. **创意与活的东西。** 用一句话把客户自己的材料与那个方向的手法系在一起，并与
   最接近的竞品做对照；再加一件访客可以在页面上做的事情。
4. **照单构建**，先写文字，内容完整。当项目没有自己的照片时，`scripts/assets.mjs` 会在
   开放馆藏中寻找该主题世界的真实图片（它所在街道的旧明信片、旧地图、它的材料、
   关于它这门手艺的版画、同类博物馆藏品），把它们下载到项目中并记录署名；只有在
   不存在诚实图片的地方，主题才用代码绘制。
5. **闸门。** `scripts/lint.mjs`（源码）与 `scripts/inspect.mjs`（真实浏览器，1440 / 768 / 390）
   度量自定规则：标题不超过两行、没有眉标、没有等宽字体、没有 01/02/03、没有细线、
   没有渐变、没有静置阴影、没有奶油色配赤陶色、没有紫罗兰色，以及盲评评审所惩罚的
   缺陷：没有焦点、空白屏、文字被遮挡或被裁切、过长的钉住段、横向滚动的行、褪色的
   文字。
6. **看。** 检查器保存截图；代理按 Awwwards 加权的评分表评审它们，修掉最严重的三个
   问题并重复，最多三轮。

针对无技能基线与另一个设计技能所做的五轮盲测记录在 `references/research.md` §11。

## 内容

```
SKILL.md                 运行流程、自定规则、法则
references/              文案、字体、色彩、布局、图像、动效、评审、破绽、研究
scripts/draw.mjs         抽取选项 / 一个方向 / 重印 / 重抽；--alternatives、--photos、--site
scripts/assets.mjs       检索开放图片馆藏（Openverse、Wikimedia Commons、Art Institute of
                         Chicago、the Met），配合 --video 检索真实影像（Wikimedia Commons、
                         Internet Archive、NASA）；--get 下载并附带署名，--credits 打印署名
scripts/lint.mjs         对禁用模式与套话做静态扫描
scripts/inspect.mjs      渲染、度量、拍照
scripts/lib/             零依赖的 Chrome DevTools 客户端、页内探针、规则
library/                 方向（20）、首屏、分区、字体系统、配色、照片、
                         研究站点、动效
assets/base.css, base.js 可选的中性基础样式
evals/evals.json         六份简报，用于对照无技能基线测试该技能
```

## 要求

Node 22 或更高版本，以及为 `inspect.mjs` 准备已安装的 Chrome、Edge 或 Chromium（它通过
Node 内置的 WebSocket、以 DevTools 协议驱动浏览器；无需安装任何东西）。`draw.mjs`、
`lint.mjs` 与 `assets.mjs` 可在 Node 18+ 上运行；`assets.mjs` 需要网络访问，且不需要 API
密钥。如果浏览器装在非常规位置，请设置 `CHROME_PATH`。

## 安装

把这个文件夹复制到你的技能目录，例如 `~/.claude/skills/design-taste-frontend/`，或者把它放在
仓库的 `.claude/skills/` 下。

## 说明

- 库中的照片由 Lorem Picsum 提供、来自 Unsplash，遵循 Unsplash 许可。它们是用来营造氛围的
  占位图；请用项目自己的图片替换它们。
- 用 `assets.mjs` 找到的图片保留各自的许可。默认它只提供 CC0、公有领域、CC BY 与
  CC BY-SA，并且 `--get` 会把每次下载的标题、作者、许可与来源记录到 `assets/credits.json`。
  页面必须携带这些署名（`--credits` 会打印它们）。
- `assets.mjs --video` 会寻找主题世界的短片，取 720p 或更小的版本，除非传入 `--max-mb`，
  否则拒绝超过 25 MB 的文件，并为每段短片保存一帧海报图；如何在页面上使用一段短片
  （静音循环、海报图、在减弱动效下停止）见 `references/imagery.md` §11。
- 字体从 Google Fonts 与 Fontshare 加载。请就你的用途核对每个字面的许可。
- `references/research.md` 中的分数是来自截图的模型判断，不是 Awwwards 的分数。
- 抽取历史存放在 `~/.taste-skill/history.json`（设置 `TASTE_SKILL_HISTORY` 可移动它）。
  删除它即可重置。
- 一次构建需要代理大约 30–45 分钟和几十万 token，包含完整的看与修循环；当项目没有
  照片时，其中大部分时间花在寻找或绘制图片上。
