# 创新班期中试卷 · 按学号领取

一个纯静态的领取站：学生打开网址，输入**学号 + 姓名**，浏览器当场解密出**自己的 3 张扫描件**，
可以逐张看，也可以打包成一个 ZIP 下载。服务器上只有密文，没有姓名、没有学号、没有原图。

不用网盘，因此没有分享链接、没有 4 位提取码、没有 7 天过期，试卷照片也不离开这台电脑。

## 目录

```
exam-drop/
├─ src/
│  ├─ build.mjs      编译 docs：加密每个学生的整套试卷
│  ├─ claim.html     领取页（页面骨架 + 样式）
│  ├─ claim.js       领取页逻辑：输入 → 解密 → 渲染
│  ├─ shared.mjs     加解密（浏览器与 Node 共用）
│  ├─ container.mjs  单学生容器格式（姓名 + 若干张）
│  ├─ zip.mjs        ZIP 打包（浏览器内，无第三方库）
│  ├─ csv.mjs        CSV 读取
│  └─ check.mjs      排查某个学号能不能领
├─ tools/
│  ├─ prep_pages.py  ← 摆正方向、剥 EXIF、按顺序改名（Pillow）
│  ├─ xlsx_to_csv.py 把名单 xlsx 转成 roster.csv
│  ├─ verify_one.mjs 交付校验：解出来的和原件逐字节比对
│  ├─ extract.mjs    把某个学生的试卷导出到本地
│  ├─ check_page.mjs 页面静态自检（id / 模块引用）
│  └─ serve.mjs      本地预览服务器
├─ roster.csv        名单（学号,姓名,区队,成绩）
├─ 试卷_摆正/         处理好的扫描件（每个学生一个文件夹）
└─ docs/             最终要部署的东西（GitHub Pages 发布目录）
```

## 三条命令

```powershell
# 0) 名单（只做一次；换学期再跑）
python tools/xlsx_to_csv.py "C:\Users\enolo\Desktop\数分\2026级中科大交流生名单.xlsx" roster.csv

# 1) 摆正 + 剥 EXIF + 按拍摄顺序命名 01/02/03
python tools/prepare_pages.py --source "C:\Users\enolo\Desktop\期中考试" --out 试卷_摆正 --max-width 2600 --quality 82

# 2) 编译领取站
node src/build.mjs --source 试卷_摆正 --roster roster.csv --out docs `
  --title "创新班期中试卷领取" --subtitle "2026 级中科大交流生 · 数学分析" `
  --second name --order name `
  --note "每张照片是一整张对开卷面（两页），卷面底部印有页码，按页码阅读即可。"

# 3) 本地预览
node tools/serve.mjs docs 5173     # 打开 http://127.0.0.1:5173
```

`--second` 决定第二把钥匙：

| 值 | 学生要输 | 强度 |
|---|---|---|
| `name`（默认） | 学号 + 姓名 | 挡得住随手试学号，挡不住知道全班名单的人 |
| `phone4` | 学号 + 手机后 4 位 | 明显更好，但名单里得先有手机号 |
| `none` | 只要学号 | 最省事，几乎等于没有保护 |

## 发到 GitHub Pages

本地仓库已经初始化并提交好了（分支 `main`，发布目录 `docs/`），只差推到 GitHub。

1. 打开 <https://github.com/new> 新建仓库，例如 `midterm-papers`。
   **不要**勾选 Add a README / .gitignore / license，本地已经有了。
   免费账号的 Pages 需要仓库是 **Public**；本仓库里只有密文，公开不会泄露卷面，但仓库名和文件数可见。
2. 接上远端并推送（把 `YOUR-NAME` 换成你的 GitHub 用户名）：

   ```powershell
   cd C:\Users\enolo\Documents\deepseek-harness\default-workspace\exam-drop
   git remote add origin https://github.com/YOUR-NAME/midterm-papers.git
   git push -u origin main
   ```

   第一次推送会要求登录：弹窗走浏览器授权最省事；或者用 Personal Access Token 当密码。
3. 仓库 **Settings → Pages**：Source 选 **Deploy from a branch**，
   Branch 选 **main**，目录选 **/docs**，Save。
4. 等 1 分钟左右，地址就是 `https://YOUR-NAME.github.io/midterm-papers/`。
   自己先打开确认：输学号 + 姓名 → 出现自己的 3 张卷子。

已经提交的内容：`docs/`（页面 + 20 个密文）、`src/`、`tools/`、`test/`、`README`、`package.json`。
`roster.csv`、`试卷_摆正/`、`dist/` 都在 `.gitignore` 里，不会上传。

以后换试卷或改参数：

```powershell
python tools/prepare_pages.py --source "C:\Users\enolo\Desktop\期中考试" --out 试卷_摆正 --max-width 2600 --quality 82
node src/build.mjs --source 试卷_摆正 --roster roster.csv --out docs --second name --order name --title "创新班期中试卷领取"
git add -A; git commit -m "update papers"; git push
```

> 每次 rebuild 都会换新 pepper 和随机盐，所以 20 个密文文件名全变、内容全变，提交会显示 20 个删除 + 20 个新增。正常现象。

其他托管方式：Vercel / Netlify 把 `docs` 目录拖进去；校内静态空间同理，
注意 `.bin` 用 `application/octet-stream`、`.js` 用 `text/javascript`（页面脚本已统一输出 `.js`，不用 `.mjs`）。

不要部署：`roster.csv`、`试卷_摆正/`。`docs/` 里只有密文。

发给学生一句话：

> 期中试卷已上传：<网址> 。输入你的学号（如 2026C001）和姓名即可查看，每人只能看到自己的。

## 安全模型（请先读这一段）

这是**静态页面**，没有服务器，也没有登录态。所以它的强度来自密码学，而不是来自身份验证：

- 每个学生一整个容器用 **AES-256-GCM** 单独加密，密钥由 `PBKDF2(学号|姓名|pepper, 200000 次)` 派生；
  文件按 `HMAC 式哈希(学号|姓名|pepper).bin` 命名。
- 公开目录里只有 20 个哈希命名的密文，扫描任何文件都找不到姓名、学号、明文图片（已实测）。
- 但**学号是可枚举的**，姓名对同班同学也不是秘密。知道名单的人理论上可以逐个尝试，
  每次尝试要跑 20 万次 PBKDF2（约 50–100 ms），一个班 20 人几分钟就能全试完。
- 因此：**这套方案防的是「随手翻到别人的」「搜索引擎收录」「转发链接」**，
  不防「有备而来的同班同学」。要真身份验证，得走学校统一认证或教学平台（学习通/雨课堂/Moodle）。

如果这批东西还带成绩、评语，建议改成 `--second phone4`，或者干脆用带账号的平台。

## 维护与排查

- **换试卷 / 加学生**：重跑第 1、2 步即可，`pepper` 会重新生成，所有密文重新加密（约 5 秒）。
  页面地址不变，学生重新输一次学号就能看到。
- **某学生说领不到**：

  ```powershell
  node src/check.mjs --dist docs --sid 2026C001 --factor 张倚晗
  # 解密成功 → 页面应当能领；未找到 → 学号/姓名与名单不一致
  ```

- **确认发出去的是原件**：`node tools/verify_one.mjs --dist docs --source "试卷_摆正\张倚晗" --sid 2026C001 --factor 张倚晗`
  （哈希逐张比对；注意用 `试卷_摆正`，不是原始照片目录，因为重新编码过）。
- **名单和文件夹名字有错别字**：build 会在同姓、同长度、只差一个字且候选唯一时自动配对，
  并在「需要注意」里点名提示；配对成功的会**同时生成两个入口**（同一份内容，按两种写法各加密一次），
  学生输哪种写法都能进。这只是安全网：当前数据里文件夹与名单已经一致，不会触发。
- **学生说「不知道学号」**：页面要的是名单上的交流生编号（`2026C001` 这种），
  卷面右上角手写的 `JL26…` 是原学校学号，两者不是一回事，别混。
- **页面白屏**：直接用 `file://` 双击 `index.html` 会因为 ES module 的跨源限制白屏，
  必须走 `node tools/serve.mjs` 或任何 http 服务。
- **页序**：每张照片是一整张对开卷面（两页），卷面底部自带「第 X 页，共 6 页」，
  所以页面上的「第 1/2/3 张」只是照片顺序，学生按卷面页码读即可。

## 数据卫生

- `roster.csv` 里有成绩；`试卷_摆正/` 是明文扫描件；`docs/data/` 是密文。
- 这三者都别进公开仓库。要备份就放在本机或私有位置。
- 授权/令牌类信息本方案完全不需要：不连网盘、不连第三方。
