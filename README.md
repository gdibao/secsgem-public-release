# 驰拓 AI 助手

驰拓 AI 助手是无锡市驰拓信息科技有限公司面向半导体工厂、系统集成商和工程服务团队建设的私有化 AI 工作平台。

- 官网：[https://secsgem.com.cn](https://secsgem.com.cn)
- 在线体验：[https://fab.secsgem.com.cn](https://fab.secsgem.com.cn)
- 联系邮箱：[wodekefu@gmail.com](mailto:wodekefu@gmail.com)

## 当前版本

当前代码已交付以下能力：

- 以 18 个半导体工程域组织本地助手和入门入口。
- 提供 150 个专业工程助手与 45 个历史助手，合计 195 个本地助手目录。
- 支持在本地助手市场检索、筛选并通过平台原生流程添加助手副本。
- 保留平台原生的助手选择、安装、编辑和群组创建界面。
- 提供 32 个 Fab 工程工作流技能定义和 20 类工具能力映射，供不同岗位按职责组合。
- 提供本地助手、技能、MCP、模型及模型供应商市场入口。
- 提供站点品牌、默认助手外观、关于与帮助、入口文案等管理配置。
- 支持容器化私有部署，业务数据和运行凭据由部署方自行管理。

## 验收边界

以下能力仍需结合目标部署环境逐项配置和验收，不应仅凭目录或界面判断为可用：

- 群组创建和成员保存已完成界面与数据路径测试；真实多助手群组推理仍有已知额度幂等冲突待解决。
- 32 个技能定义及岗位映射已随代码交付；外部 MCP、专业工程工具和沙箱需具备对应服务、授权及连接器后才能运行。
- 知识库接口及助手知识范围已有配置入口；全量资料挂载、权限隔离和检索效果仍需在实际知识库环境验收。
- 模型、邮件、短信、微信登录及支付等外部服务均依赖部署方配置，不能由本仓库默认值代替真实验收。

## 客户端下载与使用

普通用户请从 [官网客户端下载页](https://secsgem.com.cn/downloads/) 下载，也可从项目 GitHub Release 获取同一批不可变资产。安装前请核对 `SHA256SUMS`。当前 secsgem 业务发行版本为 **2.2.17-chituo.32 预发布版**。

| 平台         | 当前可用包                       | 边界                                                                                       |
| ------------ | -------------------------------- | ------------------------------------------------------------------------------------------ |
| Windows x64  | 安装 EXE + x64 portable          | 未使用商业代码签名；无 ARM64/32 位包                                                        |
| Linux x86_64 | AppImage、DEB、RPM、Snap、tar.gz | 按发行版选择一种；无 ARM64 包；安装启动仍需目标发行版实测                                  |
| macOS        | Apple Silicon、Intel 的 DMG/ZIP | 未使用 Apple 公证；首次启动可能需要在系统安全设置中确认                                     |
| CLI          | 独立 Node.js TGZ                 | Linux Node 22.23.2 已验证 help/version；Windows PowerShell、macOS 入口存在但本轮未实机验收 |

CLI 不是 Linux 专属，也不是桌面 GUI 或任意电脑控制工具。已发布包没有声明 `engines` 最低版本，因此不能声称某个更低 Node 版本已受支持；本轮使用 **Node.js 22.23.2** 验证，其他版本需验证。

```bash
npm install -g https://secsgem.com.cn/downloads/v2.2.17-chituo.32/ct-claw-fab-cli-2.2.17-chituo.32.tgz
chituo --version
chituo --help
chituo login --server https://fab.secsgem.com.cn
chituo whoami
chituo agent list
```

`fab` 与 `chituo` 是同一个 CLI 的别名；Windows PowerShell 如限制 `.ps1`，使用 `npm.cmd`、`chituo.cmd`，不要为此关闭系统策略。安装时还需要解析 `ws` 依赖，不是完全离线安装。包未发布到公共 npm，不能改写为 `npm install -g @ct-claw/fab-cli`。

登录沿原生浏览器设备授权流程，需要服务器支持该客户端。命令存在不等于当前 Fab 的授权、群组推理和设备工具均已完成端到端验收；不要公开账号令牌。详细的安装、登录、更新、卸载和 Linux 五种包的区别见 [客户端使用说明](docs/client-installation.zh-CN.md)。

## 本地开发

项目声明使用 `pnpm 10.33.0` 管理依赖，并通过仓库脚本启动开发环境：

```bash
pnpm install --no-frozen-lockfile
pnpm dev
```

仅启动 SPA 开发服务：

```bash
pnpm dev:spa
```

常用仓库检查：

```bash
pnpm type-check
pnpm test
```

生产部署应使用 [`deploy/comhub-125/`](deploy/comhub-125/) 中的 Compose 模板和核验脚本，并先按目标环境审查镜像、域名、存储、数据库、代理和密钥配置。真实 `.env`、凭据、日志、数据库、备份和用户资料不得提交到 Git。

## 开源归属与许可

本项目是在独立维护的 [ComHub](https://github.com/maheshenga/comhub) 基础上进行的半导体场景定制；ComHub 基于 [LobeHub](https://github.com/lobehub/lobehub)。驰拓 AI 助手不是 LobeHub 官方发行版，也不应被表述为完全独立开发。

代码使用仓库现有的 [LobeHub Community License](LICENSE)。使用、修改、商业部署或分发前，请阅读并遵守该许可证及上游项目的适用要求。本项目未修改 `LICENSE`。

## 安全

请勿在 Issue、提交、日志或部署模板中加入生产凭据、内部地址、真实用户资料或未脱敏运行数据。安全问题请通过上方联系邮箱私下报告。
