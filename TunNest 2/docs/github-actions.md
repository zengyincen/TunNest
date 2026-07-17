# 囤囤（TunNest）GitHub Actions 每日同步

`daily-sync.yml` 每天北京时间约 02:23 运行。GitHub 的计划任务可能有数分钟延迟。Action 不享受 7 天试用，只有有效付费许可证才会继续读取平台数据和写入 Notion。

## Repository Variable

- `LICENSE_API_BASE`：已部署许可证 Worker URL

## Repository Secrets

- `TUNNEST_LICENSE_KEY`：有效订阅许可证
- `NOTION_TOKEN`：Notion Integration Token
- `NOTION_DATABASE_ID`：扩展创建的“囤囤 TunNest”数据库 ID
- `WEREAD_API_KEY`：微信读书 Gateway API Key
- `DOUBAN_USER_ID`：豆瓣数字用户 ID
- `DOUBAN_API_KEY`：豆瓣/Frodo API Key
- `DOUBAN_AUTH_TOKEN`：可选，用于非公开兴趣数据
- `LICENSE_ADMIN_TOKEN`：仅许可证签发工作流需要

每张付费许可证包含 1 个独立 Actions 槽位，以 GitHub 仓库名作为固定设备标识，不占用 3 个浏览器槽位。将同一许可证放入第二个仓库会被拒绝，需要管理员清空旧设备或为新仓库签发许可证。

两个同步 job 独立运行：微信读书失败不会阻止豆瓣，反之亦然。微博不进入 Action，因为 GitHub 数据中心请求会触发 432 风控且 Cookie 不适合长期 Secrets；网页剪藏天然需要用户主动选择页面。
