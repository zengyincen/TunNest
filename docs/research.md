# 囤囤（TunNest）接口选择记录

调研与验证日期：2026-07-17。

- 微信读书每日同步使用 `https://i.weread.qq.com/api/agent/gateway`，通过用户提供的 API Key 调用笔记本、章节、划线和笔记接口。
- 豆瓣每日同步使用 `https://frodo.douban.com/api/v2/user/{id}/interests` 的普通 GET 分页，请求参数和凭据全部由仓库 Secrets 配置。
- 微博移动接口 `m.weibo.cn/api/container/getIndex` 在无浏览器登录环境实测返回 HTTP 432。因此只保留浏览器登录态同步，不把易过期 Cookie 放进定时 Actions。
- 任意网页没有统一的自动来源，必须由用户主动打开、选择和剪藏。
- 字体采用 Google Fonts 发布的 Noto Sans SC UI 子集，许可为 SIL OFL 1.1，可商用和随扩展再分发。

微信读书、豆瓣和微博接口均可能调整；它们被拆成独立适配器，便于后续单独修复。
