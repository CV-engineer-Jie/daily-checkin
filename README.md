# daily-checkin 📅

一个纯前端、无需登录、无服务器的日常打卡应用。按周展示周一至周日，每天的上午、下午、晚上均可独立签到、签退、记录备注和照片。

**[功能截图占位]**：发布后可把应用截图放到 `docs/screenshot.png`，并在这里替换成 `![daily-checkin 应用截图](docs/screenshot.png)`。

## ✨ 功能

- 周视图：上一周 / 下一周 / 回到本周，今天突出显示。
- 三时段打卡：未打卡 / 已签到 / 已完成；支持时间修改和备注。
- 智能时间：原生时间选择器、「现在」快捷填入、推荐时间。
- 时间验证：未签到不可签退，签退时间不可早于签到时间。
- 照片：支持相册或拍照、多张上传、缩放压缩、预览和删除。
- 本地存储：打卡记录与照片 Blob 都保存在 IndexedDB。
- JSON 备份：可选包含照片；支持合并或覆盖导入。
- 风险操作确认：清空时段先确认，清空全部需要两次确认。
- 响应式布局：适合手机、平板和电脑。

## 🛠 技术栈

- Vite 8
- React 19
- TypeScript 7
- 原生 CSS
- 原生 IndexedDB、Canvas、FileReader
- GitHub Actions + GitHub Pages

无后端、无 API Key、无数据库服务器，也不需要用户账号。

## 🚀 本地运行

**环境要求：Node.js 22.12 或更新版本。** 推荐 Node.js 22 LTS。

```bash
git clone https://github.com/<YOUR_USERNAME>/daily-checkin.git
cd daily-checkin
npm install
npm run dev
```

浏览器打开终端显示的地址（通常为 `http://localhost:5173/`）。

生产构建与本地预览：

```bash
npm run build
npm run preview
```

生成的静态页面位于 `dist/`。

## ☁️ 部署到 GitHub Pages

1. 新建公开仓库 `daily-checkin`（也可使用其他仓库名）。
2. 将代码推送到仓库的 `main` 分支。
3. 打开仓库 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**。
4. 推送后，`.github/workflows/deploy.yml` 会执行依赖安装、类型检查、生产构建和静态页面部署。
5. 进入仓库的 **Actions** 页，确认工作流成功，再查看 Pages 地址。

默认访问地址：

```text
https://<YOUR_USERNAME>.github.io/daily-checkin/
```

### Vite `base` 说明

GitHub Pages 的项目仓库通常使用子路径：

```ts
base: '/daily-checkin/'
```

本项目的 `vite.config.ts` 已自动处理：

- 本地开发和普通构建：`base: '/'`。
- GitHub Actions 构建：读取 `GITHUB_REPOSITORY` 的仓库名，自动使用 `/<仓库名>/`。
- 若仓库名为 `<YOUR_USERNAME>.github.io`（用户主页仓库），则使用 `/`。

在 GitHub Actions 中通过环境变量 `GITHUB_PAGES=true` 开启仓库子路径配置。若部署到自定义域名，需将 `base` 调整为 `/`，并按 GitHub Pages 的自定义域名流程配置。

若手动在本地构建用于项目 Pages，可执行：

```bash
GITHUB_REPOSITORY=yourname/daily-checkin GITHUB_PAGES=true npm run build
```

Windows PowerShell 可使用：

```powershell
$env:GITHUB_REPOSITORY="yourname/daily-checkin"
$env:GITHUB_PAGES="true"
npm run build
```

GitHub 官方和 Vite 文档参考：
- https://vite.dev/guide/static-deploy
- https://docs.github.com/en/pages

## 💾 数据模型与备份

一条记录对应唯一 `日期 + 时段` ID，例如 `2026-11-16__morning`。

```ts
interface CheckinRecord {
  id: string;
  date: string;        // YYYY-MM-DD
  period: 'morning' | 'afternoon' | 'evening';
  checkIn: string | null;   // HH:mm
  checkOut: string | null;  // HH:mm
  note: string;
  photoIds: string[];
  createdAt: string;
  updatedAt: string;
}
```

照片作为独立 Blob 保存在 IndexedDB 中，通过 `recordId` 关联记录。长边压缩至最多 1280px，使用约 0.8 质量的 JPEG 编码。

**备份方式**：点「导出 JSON」，可先勾选「导出时包含照片」。包含照片的备份使用 Base64 编码，体积通常明显增加。

**恢复方式**：选「合并」或「覆盖」，再选择 JSON 文件并确认。

- **合并**：其他日期的本地记录保持不变；同一日期+时段以备份中的记录为准。如果备份未包含照片，则保留该时段原有的本地照片。
- **覆盖**：清空全部原有记录和照片，再恢复备份。若备份未包含照片，则恢复的记录没有照片。
- 导入前会检查结构、唯一键、签到签退时间以及照片引用，校验失败不会写入数据库。
- 导入和删除使用 IndexedDB 事务，尽量避免只更新记录而遗漏关联照片。

## 🔐 数据隐私说明

- **不会将打卡记录和照片上传服务器**。所有用户数据仅位于当前浏览器的 IndexedDB。
- GitHub Pages 只托管静态网页，不会存储个人打卡数据。
- 不同设备、不同浏览器和不同浏览器配置之间不会自动同步。
- 清除网站数据、使用隐私模式、浏览器存储清理或卸载浏览器，可能导致数据丢失。
- 浏览器容量可能有限；照片多时请定期导出含照片的 JSON 备份。
- 导出的 JSON 备份文件是**明文**，含照片时应妥善保管。
- 本项目使用本地设备时钟；不支持跨零点的同一时段签到签退。

## 🧭 项目结构

```text
src/
  App.tsx                 # 周视图、操作协调、数据管理
  components/PeriodCard.tsx  # 单个时段卡片
  db.ts                   # IndexedDB 及照片压缩
  backup.ts               # JSON 导出、导入及校验
  types.ts                # 业务类型定义
  utils.ts                # 日期、状态与时间规则
  styles.css              # 移动端优先样式
  main.tsx                # React 入口
.github/workflows/deploy.yml  # 自动部署
```

## 🤝 参与贡献

欢迎通过 Issue 报告问题、提出建议，或通过 Pull Request 贡献功能。建议先运行：

```bash
npm install
npm run build
```

本项目没有云端同步能力；未来若加入，应确保默认仍可离线、隐私优先。

## 📄 License

本项目采用 [MIT License](LICENSE)。
