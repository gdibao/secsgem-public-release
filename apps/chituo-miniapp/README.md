# 驰拓 Fab 微信小程序壳

这是一个最小微信小程序工程，通过微信官方 `web-view` 承载 `https://fab.gdibao.com/`。它不复制 Fab 业务、不新增微信登录，也不接管邮箱验证、模型、助手或用户数据。

## 导入前配置

1. 使用微信开发者工具导入本目录。
2. 将 `project.private.config.example.json` 复制为 `project.private.config.json`，在其中填写实际小程序 AppID，再导入开发者工具。只有私有文件已经包含 `appid` 字段时，工具中的 AppID 修改才写入该私有文件。该文件被 Git 忽略；不要使用网站扫码应用或支付商户 AppID。仓库中的 `touristappid` 不能发布体验版。
3. 在小程序后台“开发 - 开发设置 - 业务域名”配置 `https://fab.gdibao.com`，并按后台要求把域名校验文件部署到该域名根路径。
4. 确认企业主体和服务类目允许使用 `web-view`。个人类型小程序不支持 `web-view`。
5. 使用真机分别验证登录、邮箱验证、会话保持、195 助手目录、模型流式输出、图片与文件上传下载、外链和分享。开发者工具中能加载不等于真机审核可用。

## 当前边界

- 仅复用 Fab 现有移动 Web 和原生账号体系。
- 没有调用 `wx.login`，也不需要或保存 AppSecret。
- 没有接入微信支付；支付商户配置与本工程无关。
- `web-view` 会铺满页面，网页与小程序只能通过微信 JSSDK 允许的接口通信。
- 未取得实际小程序开发权限、业务域名校验文件和真机审核证据前，不能宣称已发布体验版或已通过审核。

## 本地检查与实机验收

在本目录运行 `node --test tests/pages.test.mjs`。测试覆盖路由、重新显示时的网络恢复、断网提示、网页加载失败重试、固定 Fab 地址及分享入口；这不是微信开发者工具或真机验收。

取得后台权限后，在 Android 和 iPhone 微信上分别检查：已有账号登录而非重复注册、邮箱验证后的会话保持、195 助手目录、消息流式完成/取消、图片和文件上传下载、外部链接、返回与分享。逐个确认认证跳转域是否也需要业务域名配置，不绕过域名或证书检查。不读取用户验证码、不发送测试短信、不接管支付。网页正常运行不能替代这些真机检查。

## 官方依据

- `web-view`：https://developers.weixin.qq.com/miniprogram/dev/component/web-view.html
- 网络与服务器域名：https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html
- 小程序登录：https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html
- 项目配置文件：https://developers.weixin.qq.com/miniprogram/dev/devtools/projectconfig.html
