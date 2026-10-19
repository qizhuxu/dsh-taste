> 本文是 `references/scenes.md` 的简体中文翻译。
> 上游项目：Leonxlnx/taste-skill（commit b9ca2fd8）。
> 译文与英文原文如有出入，以英文原文为准。

# 滚动场景

页面的重大时刻：那些页面不再是一列分区的滚动段落，而变成一个场景。镜头飞过一片图片，一张
图从一个窗口长到整屏，一个词在滚动下弯折，一组照片环绕飞行后落进网格。这些就是访客从获奖
站点上记住的东西，也是一个只用整齐分区搭起来的页面永远不会有的东西。

场景库是从近期的 Awwwards Sites of the Day 拆解而来的（2026 年 10 月：43 个站点在滚动
时逐帧记录，描述出 261 个场景，30 种类型），在我们自己的代码里从零重建，在桌面与手机宽度
下、以及减弱动效下逐帧测试，并对照它们的来源场景复审。其中没有任何属于某个站点的东西。
在 `library/scenes.json` 发布之前，抽取不会发出任何场景；一个需要场景的页面就在舞台上
现搭一个（第 8 节），并且遵守这里的每一条规则。

## 目录

1. 场景是什么
2. 把场景放上页面
3. 填充它
4. 让它适配页面
5. 手机、减弱动效、无脚本
6. 检查它
7. 场景的规则
8. 当库里没有合适的场景时
9. 目录

## 1. 场景是什么

一个很高的分区，它的舞台在页面从旁边滚过时保持不动。舞台是 `position: sticky`；分区高
（保持屏数 + 1）屏，所以舞台被保持 `hold` 屏；一条 GSAP 时间线由这段滚动从 0 擦洗到 1。
没有任何东西捕获滚轮：滚动条永远说的是实话，键盘和触控板像在别处一样工作，而场景会结束。

场景不是什么：淡入上浮、小幅视差、粘性页脚、跑马灯。那些是安静层（`references/motion.md`）。
一个场景改变整块屏幕。

方向单会发两到三个（单子的第 9 节），来自不同的家族，每一个都放在它能承载的那段论证所在
的分区上。在第 6 步连同那个分区一起构建它们：场景是构图，不是到最后才加上去的装饰。

## 2. 把场景放上页面

把共享的舞台和所发场景的文件复制到项目里（`assets/scenes/stage.css`、
`stage.js`、`<id>.css`、`<id>.js`）。每个场景文件的头部注释列出了它期望的标记和它的
选项；`assets/scenes/demo/<id>.html` 是一个完整可用的页面，可以放在旁边对照阅读。

```html
<head>
  <script>document.documentElement.classList.add('js')</script>
  <link rel="stylesheet" href="scenes/stage.css">
  <link rel="stylesheet" href="scenes/<id>.css">
</head>
<body>
  …
  <section class="scene" data-scene="<id>" data-options='{"hold": 3}' aria-label="…">
    <div class="scene-stage">
      <!-- the markup from the scene file's header, filled with this page's content -->
    </div>
  </section>
  …
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/ScrollTrigger.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/lenis@1.3.26/dist/lenis.min.js"></script>
  <script src="scenes/stage.js"></script>
  <script src="scenes/<id>.js"></script>
  <script>Stage.smooth(); Stage.init();</script>
</body>
```

- 只有在某个场景文件说它需要时才加载 SplitText（`gsap@3.15.0/dist/SplitText.min.js`）。
- `Stage.smooth()` 加上带权重的滚轮滚动（Lenis，lerp 0.12）。它在触摸和减弱动效下保持
  关闭。安静的页面可以不用它；场景两种情况下都能工作。
- `Stage.init()` 启动页面上每一个 `[data-scene]`。有两个场景的页面就加载两个文件。
- 版本是钉住的。不要把它们改成 `@latest` 或某个未钉住的主版本。

## 3. 填充它

一个场景的强度只取决于放进去的东西。场景文件的头部和单子上的“Content”一行说明了它需要
几张图和几个词；以下这些对它们全都成立：

- **同一家族的图片。** 同一种光、同一种调色、同一类主体：一片参差不齐的图库照片，比任何
  时间上的失误都更快地打破“同一个空间”的错觉。主题世界的真实图片（`assets.mjs`）、
  项目自己的图片，或者所发的照片，按这个顺序取（`references/imagery.md`）。按它最大的
  显示尺寸定尺寸，并设置 `width` 和 `height`。
- **一口气能读完的文字。** 一句被保持的陈述是 4 到 12 个词；图注是正文字体下的 1 到 4 个
  词，句子大小写。同一时间屏幕上只有一句陈述。
- **场景要说出关于主题的某件事。** 工作室作品的飞越、一趟货运真正走的路线、这栋房子的
  四个房间、产品状态的变化。一个塞满无关图片的场景是噱头，读起来也就是噱头。
- **只用真实内容。** 如果场景需要八张关于主题的图片而只有三张，就用 `--redraw scenes`，
  绝不要用替身把它凑满。

## 4. 让它适配页面

- 场景文件读取页面的令牌：`--ground`、`--ink`、`--muted`、`--accent`、
  `--font-display`、`--font-text`（带回落）。在 `:root` 上按单子设置它们，场景就取用
  页面的颜色与字体。拿演示去对照你的页面，而不是反过来。
- 场景里的展示字体使用所发的展示字面和两行标题规则；陈述句保持在陈述字号。
- 在两个场景之间留一个安静的分区（一个文字分区、一个列表、一张朴素的图片），好让每一个
  都落得住。两个场景背靠背读起来是一趟漫长的旅程，第二个就输了。
- 首屏上的场景必须在进度 0 时可读：标题、那句话和动作在第一帧就都在（动效规则 1），
  场景只在访客滚动时才动起来。
- 给这个分区一个标题。如果设计中场景里没有可见的标题，这个分区仍然带一个（在分区上放
  `aria-label`，并在成品构图里放一个真实的标题）。

## 5. 手机、减弱动效、无脚本

- **手机。** 每个场景在它的文件里都有一套手机方案：同一个场景配上改过的数字、一个更简单
  的版本，或者 `phone: 'rest'`——此时手机显示成品构图。触摸滚动绝不做平滑。看手机长图
  要和看桌面长图一样仔细。
- **减弱动效与无脚本。** 这个分区就是一个普通分区，显示成品构图：同样的内容，排成不用
  动效也能读的样子。没有任何东西被藏起来等待脚本。检查器的 `reduced-hidden` 检查与
  `scenes.mjs` 的减弱动效长图会显示它。
- **CDN 失败**时也回落到成品构图（舞台会加上 `.is-rest`）。检查器会让在桌面端静止的场景
  不通过（`scene-not-live`），所以坏掉的脚本无法蒙混过关。

## 6. 检查它

```bash
node <skill>/scripts/scenes.mjs <page>        # every scene at 0, 10 … 100%, desktop and phone, and reduced motion
node <skill>/scripts/inspect.mjs <page>       # the gate; with scenes on the sheet it also films the scroll
```

`scenes.mjs` 为每个场景、每个宽度写一张联系表到 `.taste-skill/scenes/`。每一张都要看。
在每一帧都问：有没有一件清楚的东西可看；屏幕上那句陈述能不能读完；有没有东西突然弹出、
空白、被切断或者压过文字；它是不是该有那么大胆。检查器的 `desktop-film-NN.jpg` 以
每帧三分之一屏展示整页的滚动：核对场景与它们之间安静的分区是否形成节奏，以及它们之间
没有任何东西是空的。

## 7. 场景的规则

1. **每页两到三个，**来自不同的家族，中间隔一个安静的分区。检查器在超过四个时警告
   （`many-scenes`），也在场景占据页面超过 60% 时警告（`scene-heavy`）。
2. **每个保持一到四屏：**大约故事的每一拍占一屏；一段没有新东西可展示的保持应当被砍掉，
   而不是被填充。
3. **只用原生滚动。** 不捕获滚轮、不锁定页面、不要只在点击时才运行的场景。平滑只能通过
   `Stage.smooth()`。
4. **在静止点处可读。** 屏幕上的陈述要能整句读完；在它被阅读时没有任何东西从文字上经过；
   图片上的文字下面要有平涂遮罩或一块平静区域。
5. **场景内部适用场景自己的数字**（动效规则 7）：一张图可以从一个窗口长到整屏，字体可以
   横穿舞台，镜头可以飞过图片。场景之外，适用 `references/motion.md` 的安静限制。
6. **变形、不透明度、clip-path。** 不用任何每帧都强制布局的东西。图片在移动之前先解码。
7. **自定规则在场景内部同样成立：** 没有等宽字体图注、没有 01/07 计数器（如果确实需要
   计数，就用朴素的“3 of 7”）、没有渐变（用平涂遮罩）、没有阴影或光晕、没有细线装饰、
   没有装饰性粒子、没有紫罗兰色。
8. **成品构图是设计出来的，**不是事后补的：减弱动效、脚本失败以及一些手机看到的就是它。

## 8. 当库里没有合适的场景时

先重抽（`--redraw scenes`）。如果简报确实需要一个库里没有的场景，就在同一个舞台上搭它，
好让它继承那些护栏：

```js
Scenes['my-scene'] = (root, opts = {}) => Stage.scene(root, {
  hold: opts.hold ?? 2,          // screens the stage is held for
  scrub: opts.scrub ?? true,     // true when Lenis runs; 0.4-0.8 without it reads as weight
  phone: 'same',                 // or 'rest', or { hold, build } for a phone plan
  build(tl, { q, phone }) {      // positions are fractions of the scene, 0-1
    tl.fromTo(q('.picture'), { clipPath: 'inset(30% 30% 30% 30%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.6 }, 0)
      .to(q('.title'), { yPercent: -40, autoAlpha: 0, duration: 0.25 }, 0.7);
  },
});
```

并且先写它的 CSS 成品构图，再在 `.scene.is-live` 下写实时布局。像对待任何其他场景一样用
`scenes.mjs` 检查它。

## 9. 目录

（由 `library/scenes.json` 生成；抽取从它里面发牌。`node <skill>/scripts/draw.mjs --list
scenes` 会打印它。）
