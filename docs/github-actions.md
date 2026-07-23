# 囤囤（TunNest）GitHub Actions 每日同步

`daily-sync.yml` 每天北京时间约 02:23 运行。GitHub 的计划任务可能有数分钟延迟。Action 不享受 7 天试用，只有有效付费许可证才会继续读取平台数据和写入 Notion。

## Repository Variable

- `LICENSE_API_BASE`：已部署许可证 Worker URL，例如 `https://tnlcs.imnotfound.eu.org`

## Repository Secrets

- `TUNNEST_LICENSE_KEY`：有效订阅许可证
- `NOTION_TOKEN`：共用 Notion Integration Token
- `NOTION_WEREAD_DATABASE_ID`：`囤囤 · 微信读书`数据库 ID
- `NOTION_DOUBAN_DATABASE_ID`：`囤囤 · 豆瓣用户`数据库 ID
- `NOTION_DOUBAN_MOVIE_TOP250_DATABASE_ID`：电影 Top 250 数据库 ID
- `NOTION_DOUBAN_BOOK_TOP250_DATABASE_ID`：图书 Top 250 数据库 ID
- `NOTION_DOUBAN_MUSIC_TOP250_DATABASE_ID`：音乐 Top 250 数据库 ID
- `WEREAD_API_KEY`：微信读书 Gateway API Key
- `DOUBAN_USER_ID`：豆瓣数字用户 ID
- `DOUBAN_AUTH_TOKEN`：可选，用于非公开兴趣数据
- `LICENSE_ADMIN_TOKEN`：仅许可证签发工作流需要

旧版 `NOTION_DATABASE_ID` 只为微信读书和豆瓣用户数据库保留兼容回退；三个 Top 250 数据库必须配置独立 Secret。网页剪藏和微博只在浏览器运行，因此不需要对应的 Actions Secret。

每张付费许可证包含 1 个独立 Actions 槽位，以 GitHub 仓库名作为固定设备标识，不占用 3 个浏览器槽位。将同一许可证放入第二个仓库会被拒绝，需要管理员清空旧设备或为新仓库签发许可证。

两个同步 job 独立运行：微信读书失败不会阻止豆瓣，反之亦然。微博不进入 Action，因为 GitHub 数据中心请求会触发风控且 Cookie 不适合长期 Secrets；网页剪藏天然需要用户主动选择页面。

## 豆瓣风险说明

豆瓣当前没有供新项目稳定申请的公开官方 API。Actions 会自动生成用户收藏接口当前要求的签名，并读取电影、图书、音乐 Top 250 公开页面，无需配置 API Key；这些适配可能因签名、HTML 结构、频率限制或上游策略变化失效，不应理解为豆瓣官方服务或授权。不要在仓库、Issue 或日志中公开豆瓣 Auth Token。
