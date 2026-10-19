# dsh-taste

[taste-skill](https://github.com/Leonxlnx/taste-skill) 的 **DeepSeek Harness 原生插件**。

上游是一个纯技能仓库（把 markdown 拷进技能目录才能用）。本插件做了三件上游做不到的事：

1. **把技能做成插件**：进程内注册 `taste-provider`，技能随包走，不再依赖你把仓库 clone 到某个固定路径再做软链。
2. **把脚本变成工具**：上游的四个脚本包成 `taste_status` / `taste_draw` / `taste_lint` / `taste_inspect` / `taste_assets`，模型可以直接调用，不必手写 `node scripts/xxx.mjs`。
3. **随上游自动重新封装**：GitHub Actions 定时比对上游 commit，有更新就重新打包并开 PR。

结构参考 [dsh-oil-ui](https://github.com/oil-oil/dsh-oil-ui)（插件自带技能 + skill provider），执行层参考 [dsh-ffmpeg](https://github.com/STARDUSTLC666/dsh-ffmpeg)（官方 subprocess、argv 数组、无 shell）。**零运行时依赖。**

## 安装

```bash
dsh plugin --profile desktop add github:<你的用户名>/dsh-taste
```

安装后**重启 DSH**（插件在宿主启动时加载，没有热重载）。装好后 `taste_status` 会告诉你打包版本与上游 commit。

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
    # exposeOptInSkills: false                     # true 时把上游标记「按名调用」的技能也放进模型目录
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

所以插件版本会压过你 `~/.dsh/skills` 里用软链装的那一份同名技能，但**项目级副本仍然能覆盖插件**。如果你之前做过软链安装，装完插件后可以把那些软链删掉，避免两份并存。

## 随上游自动更新

`.github/workflows/upstream-sync.yml` 每天跑一次：

1. `node scripts/vendor.mjs --check` —— 比对上游 commit、重算本地打包内容的 `treeHash`、核对目录集合。**无漂移就安静结束。**
2. 检测到漂移 → 重新 vendoring → 递增 patch 版本号 → 提交到一个分支 → 开 PR。

PR 的正文会带上上游的新 commit，你 review 后合并即可。也可以在 Actions 页面手动 `workflow_dispatch` 触发。

本地随时可以自己跑：

```bash
node scripts/vendor.mjs          # 重新打包
node scripts/vendor.mjs --check  # 只比对，有漂移以退出码 1 结束
```

### 上游清单

`upstream.config.json` 里声明上游仓库与要跳过的目录。上游新增技能会被**自动纳入**，不需要改代码。

当前跳过 5 个目录，因为它们是上游留的墓碑（正文写着「已迁至 github.com/Leonxlnx/imagegen-skills」或「已废弃」）：`brandkit`、`image-to-code-skill`、`imagegen-frontend-web`、`imagegen-frontend-mobile`、`redesign-skill`。**真身在另一个仓库**，本插件不含它们，因此也不会和你在 `~/.dsh/skills` 里的那份撞名。

## 打包内容说明

`skills/` 由 `scripts/vendor.mjs` 生成，按 commit 固定版本，**不要手改**——改了 `--check` 会报 `treeHash` 不符。

- `skills/taste.manifest.json` —— 运行期唯一的数据源。vendor 时就把 frontmatter 解析好（含 `>` / `>-` 折叠块），所以**运行期不解析 YAML**，插件没有 YAML 依赖，也不会因为上游换写法而在加载期失败。
- `upstream.lock.json` —— 记录上游 commit 与每个技能目录的 `treeHash`，供 CI 判断漂移。
- `skills/UPSTREAM-LICENSE.txt` —— 上游 MIT 许可全文。

## 许可

MIT。`skills/` 下的内容来自 [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill)（MIT），版权归原作者所有。
