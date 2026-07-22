# 囤囤（TunNest）验证记录

验证日期：2026-07-22

## 已通过

- 根项目 10 个测试：中英文品牌名、套餐价格、Action 来源边界、豆瓣标准化、四数据库字段、按来源路由、Actions 独立数据库、Notion Emoji 载荷、7 天试用、付费 Action 限制
- 全部 JavaScript/MJS `node --check`
- 扩展 manifest、图标和 Noto Sans SC 字体资源完整性
- 扩展 ZIP 完整性检查
- License Worker TypeScript `tsc --noEmit`
- D1 migration 本地执行成功
- License Worker 冒烟链路：签发月度许可证 → 3 台设备验证 → 第 4 台拒绝 → 管理员暂停 → 已激活设备即时失效
- 改名后年度许可证签发与动态验证通过，许可证前缀为 `tunnest_`
- 同一 Chrome Sync 试用标识在更换安装码后沿用相同到期时间
- 试用到期返回 `TRIAL_EXPIRED` 并进入付费墙
- 3 个浏览器槽位与 1 个独立 Actions 槽位验证通过；释放旧浏览器后可绑定新设备
- 网页剪藏、微信读书、豆瓣和微博四套 Notion 数据库 schema 与设置项静态验证通过
- License Worker Wrangler dry-run
- npm production audit：0 vulnerabilities

## 需要真实账号验证

- 微信读书真实 Gateway API Key
- 豆瓣真实用户 ID/API Key/Auth Token
- 微博真实浏览器登录态与不同用户主页
- Notion Integration Token 与正式数据库
- Chrome Web Store 正式审核
- 支付平台购买链接和付款后的自动发码集成

接口适配受上游平台变化影响。微博已刻意排除在 GitHub Actions 外。
