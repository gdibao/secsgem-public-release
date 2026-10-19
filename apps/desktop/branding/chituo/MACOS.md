# 驰拓 macOS 构建

沿用现有 Electron、驰拓 build profile 和 `package:mac`，不改认证协议。Apple Silicon 与 Intel 分别在对应架构的真实 macOS 主机运行；本入口不在 Linux 上伪造 DMG。

准备 Node.js 24.18.0、pnpm 10.33.0、Xcode Command Line Tools，以及私有仓库合法读取权限。使用最终已提交源码的新不可变版本 tag 的独立干净检出，不使用生产目录，不携带真实 `.env`。不要移动或覆盖已发布 tag。

```bash
# VERSION 为已经创建、指向本次最终源码的全新版本，不是现存 .7。
bash apps/desktop/scripts/packageChituoMac.sh "$VERSION"
```

脚本使用国内 npm/Electron 镜像与已有缓存、16GB Node 堆，复用现有依赖安装和品牌测试；生成 `apps/desktop/release/` 下 DMG、ZIP 和架构专属 SHA256 清单，解包验证品牌与原生 PTY 依赖。脚本不自动上传、不关闭构建、不配置厂内代理。

此入口明确生成未签名、未公证包，不需要 Developer ID 才能开始构建，但不能声称用户安装顺畅或绕过系统安全检查。面向正式分发的 Developer ID 签名、公证和实际 Mac GUI 登录验收是独立放行条件；目前均未通过。构建开始后前20分钟不干预，之后每20分钟检查进程、日志及空间，不因安静中断。

现有 GitHub 工作流 `.github/workflows/comhub-desktop-release.yml` 同样支持 `macos-15` arm64 与 `macos-15-intel` x64。2026-09-24 核查 run `35942577114` 的官方诊断为付款失败或支出上限问题，首作业没有分配 runner。需账户管理员处理 Actions 计费限制，或提供可用的授权 Mac 主机。不要重新派发已存在 Release 的 `.7`，工作流会拒绝覆盖。
