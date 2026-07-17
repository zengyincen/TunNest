# 囤囤（TunNest）许可证服务部署

许可证 Worker 是整个项目唯一使用 Cloudflare 的部分，只存授权状态、7 天试用期限和匿名安装码哈希。

```bash
cd license-worker
npm install
npx wrangler login
npx wrangler d1 create tunnest-license
```

将返回的 D1 `database_id` 写入 `wrangler.toml`，然后：

```bash
npm run db:remote
npx wrangler secret put ADMIN_TOKEN
npm run deploy
```

`ADMIN_TOKEN` 建议使用至少 32 字节随机值。部署完成后，把 Worker URL 写入：

- `extension/config.js` 的 `licenseApiBase`
- `product.config.json` 的 `licenseApiBase`
- GitHub Repository Variable `LICENSE_API_BASE`

发布前还要替换购买链接和 `supportUrl`。购买平台完成收款后，可以人工运行 `Issue subscription license` 工作流签发；工作流会生成一个保留 7 天的私密 artifact，不把许可证显示在日志中。

所有付费许可证默认包含 3 个浏览器设备槽位和 1 个独立 GitHub Actions 槽位。用户可以在扩展设置中释放当前浏览器；管理员也可以通过 `clearDevices` 清空全部绑定。

管理员可暂停、撤销、延长和清空设备：

```bash
curl -X PATCH "$LICENSE_API_BASE/v1/admin/licenses/lic_xxx" \
  -H "Authorization: Bearer $LICENSE_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"suspended"}'
```
