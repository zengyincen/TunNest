# 囤囤（TunNest）扩展与 Notion 配置

1. 在 Notion 创建 Internal Integration，复制 `ntn_…` Token。
2. 新建目标父页面，并通过 Notion 的“连接”菜单共享给 Integration。
3. 打开扩展设置，输入 Token 与父页面链接，扩展会创建统一的“囤囤 TunNest”数据库。
4. 微信读书同步前，在同一浏览器登录 `weread.qq.com`。
5. 豆瓣同步需要用户 ID 和 API Key；私密条目还需要 Auth Token。
6. 微博同步填写一个或多个 UID，并保持 `weibo.com` 登录状态。

Notion Token 保存于本机 `chrome.storage.local`，不会使用 Chrome Sync。公共电脑不应保存 Token。

扩展首次联网时会自动生成安装码并开始 7 天完整试用。安装码可以在设置页查看和复制，用于客服定位设备，但它不是硬件序列号。试用结束后只暂停新的同步，不影响用户已有的 Notion 页面。
