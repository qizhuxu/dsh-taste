# 第三方内容说明

本插件（`dsh-taste`）的 MIT 许可见 [LICENSE](LICENSE)。

## skills/ 下的内容

`skills/` 目录是 [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) 的**逐字节副本**，
由 `scripts/vendor.mjs` 按上游 commit 固定版本重新打包。该上游以 **MIT** 许可发布，
版权归原作者所有；其许可全文随包保存在 [skills/UPSTREAM-LICENSE.txt](skills/UPSTREAM-LICENSE.txt)。

`skills/taste.manifest.json` 记录了本次打包对应的上游 commit：

- 仓库：`Leonxlnx/taste-skill`
- 许可：MIT

上游若有单独的署名要求，以 `skills/` 内各技能目录自带的说明为准（例如 `agents/openai.yaml`）。

## 为什么有些上游目录没有被打包

上游 `skills/` 下有 5 个目录是**墓碑**——正文写着内容已迁至
[github.com/Leonxlnx/imagegen-skills](https://github.com/Leonxlnx/imagegen-skills)，
或标记为已废弃。本插件不打包它们，避免分发空壳；真身请从那个仓库获取。
具体名单与原因见 [upstream.config.json](upstream.config.json) 的 `skip` 字段。
