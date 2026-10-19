# dsh-taste

[taste-skill](https://github.com/Leonxlnx/taste-skill) 的 **DeepSeek Harness 原生插件**（作者 [@qizhuxu](https://github.com/qizhuxu)）。

上游是一个纯技能仓库（把 markdown 拷进技能目录才能用）。本插件做了三件上游做不到的事：

1. **把技能做成插件**：进程内注册 `taste-provider`，技能随包走，不再依赖你把仓库 clone 到某个固定路径再做软链。
2. **把脚本变成工具**：上游的四个脚本包成 `taste_status` / `taste_draw` / `taste_lint` / `taste_inspect` / `taste_assets`，模型可以直接调用，不必手写 `node scripts/xxx.mjs`。
3. **随上游自动重新封装**：GitHub Actions 定时比对上游 commit，有更新就重新打包并开 PR。

结构参考 [dsh-oil-ui](https://github.com/oil-oil/dsh-oil-ui)（插件自带技能 + skill provider），执行层参考 [dsh-ffmpeg](https://github.com/STARDUSTLC666/dsh-ffmpeg)（官方 subprocess、argv 数组、无 shell）。**零运行时依赖。**

## 安装

```bash
dsh plugin --profile desktop add github:qizhuxu/dsh-taste
```

安装后**重启 DSH**（插件在宿主启动时加载，没有热重载）。装好后 `taste_status` 会告诉你打包版本与上游 commit。

## skills 面只出现一条命令

上游有 8 个技能。如果全列出来，技能面板与命令列表里就会出现 8 条
（`/design-taste-frontend`、`/gpt-taste`、`/minimalist-ui`…）。本插件**默认只暴露主技能**：

```
/design-taste-frontend      ← 只有这一条
```

其余 7 个风格**不单独出现**，改为在加载主技能时把它们**以指令的形式**追加到正文末尾——一张带名称与文件绝对路径的表格，外加「何时读、不要混用」的规则。需要某个风格时直接说名字即可：

> “用 `gpt-taste` 风格做这个落地页”
> “换成 `minimalist-ui`”

模型会去读对应文件并照它执行。被携带的风格：

| 风格名 | 是什么 |
| --- | --- |
| `gpt-taste` | Awwwards 级前端设计 + GSAP 动效 |
| `high-end-visual-design` | 昂贵柔和的观感：高级字体、留白、层次 |
| `minimalist-ui` | 干净的编辑式界面，严格单色（Notion / Linear 气质） |
| `industrial-brutalist-ui` | 生硬机械的界面、瑞士排版、极端尺度对比 |
| `stitch-design-taste` | 兼容 Google Stitch 的语义化设计规则 |
| `design-taste-frontend-v1` | 最初的 v1，为依赖其确切行为的老项目保留 |
| `design-taste-frontend-v2-experimental` | 更早的 v2（VARIANCE / MOTION / DENSITY 三档拨盘） |

想让 8 个技能各自出现在目录与命令列表里，把 `listAllStyles` 设为 `true`（见下）。

## 工具

| 工具 | 作用 |
| --- | --- |
| `taste_status` | 自检：打包版本、上游 commit、纳入了哪些技能、node 路径。排查问题先跑它 |
| `taste_draw` | 抽签定设计方向（`--sector` 必填），写出方向单 `direction.json` |
| `taste_lint` | 静态源码扫描：渐变、紫色、等宽字、眉标、编号、静置阴影、细线、空泛文案… 带 `文件:行号` |
| `taste_inspect` | 真实浏览器闸门：1440/768/390 三档判定 + 截图 |
| `taste_assets` | 在开放馆藏（Openverse / Wikimedia / 芝加哥艺术博物馆 / 大都会 / NASA / Internet Archive）检索并下载真实素材，记录署名 |

> `taste_lint` 与 `taste_inspect` **退出码 1 表示「有未达标项」**，是检查结论而不是执行故障——工具会把 stdout/stderr 原样回给你。

## 配置

在 profile 的 `cordis.patch.yml` 里覆盖插件行：

```yaml
- id: dsh-taste
  name: dsh-taste
  config:
    # nodePath: C:\Program Files\nodejs\node.exe  # 默认用宿主自己的 node（process.execPath）
    # rank: 380                                    # 技能优先级，越小越优先
    # timeoutMs: 300000                            # 单次脚本执行超时（10000–3600000）
    # graceMs: 10000                               # 终止宽限（1000–120000）
    # listAllStyles: false                         # true 时 8 个技能各自出现在目录与命令列表
```

### rank 为什么是 380

DSH 里 rank 越小越优先，用户级目录是 400，项目级是 100/200/300：

| 来源 | rank |
| --- | --- |
| 项目 `.dsh/skills` | 100 |
| 项目 `.agents/skills` | 200 |
| 自定义目录 | 300 |
| **本插件** | **380** |
| 用户 `~/.dsh/skills` | 400 |
| 用户 `~/.agents/skills` | 500 |
| DSH 内建 | 600 |

所以插件版本会压过你 `~/.dsh/skills` 里用 Junction 装的那一份同名技能，但**项目级副本仍然能覆盖插件**。如果你之前做过软链安装，装完插件后可以把那些软链删掉，避免两份并存。

### 关于技能面板的启用/停用开关

DSH 的技能面板（`dsh-client-ui-skill-explorer`）的开关是**改写 SKILL.md 的 `disable-model-invocation`**。
本插件在 `list()`/`get()` 时会**实时读一次该字段**并覆盖打包快照，所以面板上的开关是真生效的
（打包清单只作为缺省值）。改完在面板里刷新即可，不必重装。

## 随上游自动更新

[`.github/workflows/upstream-sync.yml`](.github/workflows/upstream-sync.yml) 每天跑一次：

1. `node scripts/vendor.mjs --check` —— 比对上游 commit、重算本地打包内容的 `treeHash`、核对目录集合。**无漂移就安静结束。**
2. 检测到漂移 → 重新 vendoring → 递增 patch 版本号 → 提交到一个分支 → 开 PR。

PR 的正文会带上上游的新 commit，你 review 后合并即可。也可以在 Actions 页面手动 `workflow_dispatch` 触发。

本地随时可以自己跑：

```bash
node scripts/vendor.mjs          # 重新打包
node scripts/vendor.mjs --check  # 只比对，有漂移以退出码 1 结束
```

### 打包为什么是可复现的

- **按 commit 固定**：先 `git ls-remote` 解析 ref 到具体 sha，再浅克隆该 sha。
- **关掉换行转换**：Windows 上 `core.autocrlf` 会把签出的 LF 变成 CRLF，导致与上游 git 的字节不一致；克隆显式 `-c core.autocrlf=false -c core.eol=lf`，并在复制后**校验不含 CR，含 CR 直接失败**。
- **哈希与遍历顺序无关**：`readdir` 的返回顺序不保证（NTFS 与 ext4 不同），所以文件清单按名称排序、再按路径排序后才计算 `treeHash`。不这么做的话，同一份内容在 Windows 与 Linux 上会算出两个值，CI 会误报漂移。

`skills/` 由 `scripts/vendor.mjs` 生成，**不要手改**——改了 `--check` 会报 `treeHash` 不符。

### 上游清单

[`upstream.config.json`](upstream.config.json) 里声明上游仓库、主技能（`primary`）与要跳过的目录。上游新增技能会被**自动纳入**，不需要改代码，并自动成为「主技能正文里可点名的其他风格」。

当前跳过 5 个目录，因为它们是上游留的墓碑（正文写着「已迁至 github.com/Leonxlnx/imagegen-skills」或「已废弃」）：`brandkit`、`image-to-code-skill`、`imagegen-frontend-web`、`imagegen-frontend-mobile`、`redesign-skill`。**真身在另一个仓库**，本插件不含它们。

## 打包内容说明

- `skills/taste.manifest.json` —— 运行期唯一的数据源。vendor 时就把 frontmatter 解析好（含 `>` / `>-` 折叠块），所以**运行期不解析 YAML**，插件没有 YAML 依赖，也不会因为上游换写法而在加载期失败。
- `upstream.lock.json` —— 记录上游 commit 与每个技能目录的 `treeHash`，供 CI 判断漂移。
- `skills/UPSTREAM-LICENSE.txt` —— 上游 MIT 许可全文。
- [NOTICE.md](NOTICE.md) —— 第三方内容说明。

## 开发

```bash
node scripts/vendor.mjs        # 重新打包
node --test test/plugin.test.mjs   # 18 项插件级测试（假 ctx + 真实 subprocess 垫片，含真启浏览器）
```

## 许可

MIT。`skills/` 下的内容来自 [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill)（MIT），版权归原作者所有。
