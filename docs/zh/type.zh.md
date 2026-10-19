> 本文是 `references/type.md` 的简体中文翻译。
> 上游项目：Leonxlnx/taste-skill（commit b9ca2fd8）。
> 译文与英文原文如有出入，以英文原文为准。

# 字体

字体排印构成访客所见的大部分内容，也决定了页面看起来是经过设计还是被拼装起来的。
方向单会发给你一套字体系统（字面、字重、设置）。本文件说明如何使用它。

## 目录

1. 研究测到了什么
2. 尺度：字号少，彼此拉开
3. 排展示字体
4. 排正文
5. 正确地加载字体
6. 一个家族还是两个
7. 区分“排过的字体”与“打出来的文字”的细节
8. 检查器看不见的错误

## 1. 研究测到了什么

在 247 个研究站点中可测量的 202 个上（Chrome，1440×900 与 390×844）：

| | 中位数 | 中间一半 | 备注 |
| --- | --- | --- | --- |
| 首屏标题字号 | 72px（5.0vw） | 43–109px | 高分站点：中位数 6.0vw |
| 页面上最大的字 | 6.4vw | 最高 10.4vw | 高分站点 8.4vw，弱站点 5.0vw |
| 手机上的首屏标题 | 40px | 32–59px | |
| 首屏字距 | -0.01em | -0.03 到 0 | 字号越大越紧 |
| 首屏行距 | 1.0 | 0.95–1.1 | |
| 正文字号 | 16px | 14–18px | |
| 标题 ÷ 正文字号 | 4.3 | | 高分站点 4.7 |
| 实际使用的字体数 | 2 | 31% 用一种，45% 用两种，22% 用三种 | |
| 首屏字重 | 常规 48%，中等 18%，粗体或更重 22% | | 大字号不必是粗体 |
| 首屏用大写 | 24% | | |
| 首屏居中 | 39% | | 弱站点上为 52% |

从中要取两点。第一，字号对比是主要的杠杆，最好的站点把它拉得更狠。第二，字重不是：
一半的首屏用的是常规字重。尺度与间距让字体显得自信；粗体只是若干选项之一。

## 2. 尺度：字号少，彼此拉开

评审组把 114 个最强站点中的约 30 个描述为使用两到三种字号、中间什么都没有，而没有
一个使用渐进的五级或六级尺度。所以：一个展示字号、一个正文字号和一个字号小的档位
撑起页面；需要时还有一档导语字号和一档小标题字号。五档是上限。常见的失败是九种彼此
都差不多的字号（16、18、20、24、28、32……），那读起来是一团糊。要选彼此明显不同的
档位：

```css
:root {
  --step-small: clamp(0.8125rem, 0.79rem + 0.1vw, 0.875rem);   /* 13–14px  captions, legal */
  --step-body:  clamp(1.0625rem, 1rem + 0.25vw, 1.1875rem);    /* 17–19px  paragraphs */
  --step-lead:  clamp(1.25rem, 1.1rem + 0.7vw, 1.625rem);      /* 20–26px  supporting line, large body */
  --step-head:  clamp(2rem, 1.3rem + 3.2vw, 4rem);             /* 32–64px  section headings */
  --step-display: clamp(3rem, 1rem + 9vw, 9rem);               /* set by the hero blueprint */
}
```

- `--step-display` 属于那个方向。一座纪念碑式的文字标识是 16–24vw；一件安静器械的标题
  是 28px。用首屏蓝图给出的字号，写成 `clamp()`，这样它随视口缩放，但在手机上和在极宽
  屏幕上都有界。
- 保住间距：在桌面端，展示字号至少应是正文字号的四倍；除非设计确实需要第六种字号，
  否则 `--step-lead` 与 `--step-head` 之间不应再插任何东西。
- 抵制为每张卡片和每个标签都设一档“小标题”字号的做法。如果两种字号看起来几乎一样，
  就把它们变成一样。

## 3. 排展示字体

大字号会暴露出在正文字号下看不见的间距问题。对任何超过 40px 的东西都用上这些：

```css
.display {
  font-size: var(--step-display);
  line-height: 0.95;              /* 0.85–1.05; tighter for capitals and condensed faces */
  letter-spacing: -0.035em;       /* -0.02 to -0.05em; use the value on the direction sheet */
  font-kerning: normal;
  text-wrap: balance;
  max-width: 14ch;                /* choose the measure so lines break where you want */
  margin: 0;
}
```

- **字距随字号缩放。** 字越大，就需要越紧；一个适合 120px 的值会掐死 32px。要逐档设置
  字距，而不是给所有标题设一次。
- **小于 1.0 的行距需要核对。** 检查下一行的下伸部与上伸部或重音符号是否相撞。两行的
  标题用肉眼就很容易验证这一点。
- **全大写**即使在大字号下也想要略微放开的字距（0 到 +0.03em），行距约 0.9。
- **视觉对齐。** 左边缘为圆弧或斜线的大写字母（O、C、A、T、W）看起来像是缩进了。把标题
  向左拉大约 0.04–0.06em（`margin-left: -0.05em`），好让它与下方的文字在视觉上对齐。
- **跨视口的字体。** 对于必须横贯屏幕的一行，用 `vw` 定尺寸，并在 390 与 1440 下核对；
  设置 `white-space: nowrap`，让容器裁切它而不是折行。字号由字符数算出：
  `font-size ≈ 容器宽度 ÷（字符数 × k）`，k 取自 `copy.md` §2。
- 绝不要给展示字体加文字阴影、描边或渐变填充。

## 4. 排正文

```css
body { font-size: var(--step-body); line-height: 1.5; font-kerning: normal; text-rendering: optimizeLegibility; }
p { max-width: 62ch; text-wrap: pretty; margin: 0; }
p + p { margin-top: 0.9em; }
.lead { font-size: var(--step-lead); line-height: 1.35; max-width: 40ch; }
small, .caption { font-size: var(--step-small); line-height: 1.45; }
```

- 行长：45–75 个字符。比这更宽，眼睛就会跟丢下一行；超过约 88 时检查器会警告。
- 行距：正文 1.45–1.6，较大的导语字号更紧一些（1.3–1.4），长文阅读时更松。
- 次要文字用同一种字面、更柔的墨色（`--muted`），不是更轻的字重，也不小于 13px。
- 超过三行的段落不要居中。不要使用两端对齐。
- 深色底上的浅色文字看起来更重：降低一档字重，或者加 0.01em 字距，并略微提高行距。

## 5. 正确地加载字体

单子会给出一个 `<link>` 标签。照原样使用；不要换成你更喜欢的字面。

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="…from the direction sheet…" rel="stylesheet">
```

```css
:root {
  --font-display: "Family From Sheet", "Helvetica Neue", Arial, sans-serif;
  --font-text: "Family From Sheet", Georgia, serif;
}
```

- 只请求你用到的字重（通常总共两到三种）。
- 始终给出同一大类别的回退字体栈（无衬线配无衬线，衬线配衬线）。
- 在框架里，用它的字体加载器配上同样的家族与字重（`next/font/google`，或者自托管的
  `@font-face` 配 `font-display: swap`）。Fontshare 的字面从单子上的
  `api.fontshare.com` 样式表加载。
- 构建之后，`inspect.mjs` 会报告实际渲染出来的字体家族。如果它警告某个字面没有加载，
  那么截图里显示的是回退字体，你从截图中判断的任何事情都不是真的。先修好链接。

## 6. 一个家族还是两个

所研究的站点中有三分之一从头到尾只用一个家族，而这是看起来协调最稳妥的方式。当所发
的系统有两个字面时：

- 给每一个分配职责，并且绝不互换：一个排标题，另一个排其他所有内容。
- 不要为标签、数字或引语引入第三个字面。
- 不要在一个标题里混用两个字面。
- 斜体用于作品标题和段落中真正的强调，绝不作为装饰。

## 7. 区分“排过的字体”与“打出来的文字”的细节

- 弯引号与弯撇号、真正的破折号、真正的省略号（见 `copy.md` §7）。
- 价格、表格、成列日期用 `font-variant-numeric: tabular-nums`；`oldstyle-nums` 适合衬线
  正文。
- 链接上使用 `text-underline-offset: 0.18em; text-decoration-thickness: 0.07em`，让下划线
  避开下伸部。
- 标题上用 `hyphens: none`。只有在长 URL 或邮箱上才用 `overflow-wrap: anywhere`。
- 标题属于它后面的文字：标题上方的间距至少是下方间距的两倍。
- `::selection { background: var(--accent); color: var(--accent-ink); }`，再用强调色画一个
  可见的 `:focus-visible` 轮廓，让连浏览器自带的状态都属于这个设计。
- 不要在悬停时改变字重；那样行会重新折行。

## 8. 检查器看不见的错误

- 一个通过了两行规则、却断得很糟的标题：第二行有一个孤立的词，或者断行切开了短语
  （“Stools for small / kitchens”）。要亲手设计断行。
- 展示字体紧到字母相碰，或者松到散架。
- 一个自信的首屏之后，分区标题几乎同样大。每屏只保留一个尺寸占主导。
- 当某个字面只为大字号而设计时，却用它排正文。
- 什么都加粗。如果每一行都被强调，那就没有一行被强调。
