# 驰拓 AI CLI

`@ct-claw/fab-cli` 是驰拓 AI 助手随 GitHub Release 提供的命令行客户端，复用项目现有 CLI 实现，不发布到 npm。

## 安装

从同版本 GitHub Release 下载 TGZ 后本地安装：

```bash
npm install -g ./ct-claw-fab-cli-*.tgz
chituo --help
```

同时保留 `fab`、`lh`、`lobe` 和 `lobehub` 兼容命令。

## 连接 Fab

登录命令默认使用 `https://fab.secsgem.com.cn`：

```bash
chituo login
```

连接其他兼容实例时使用原生参数：

```bash
chituo login --server https://your-fab.example.com
```

也可通过 `LOBEHUB_SERVER` 临时指定服务地址。登录信息沿用上游格式保存在用户目录下的 `.lobehub` 中，便于兼容现有安装。

设备网关、文件 Shell、浏览器和工具调用是否可用取决于服务端及本机授权。自部署实例没有设备网关时，需要显式提供 `--gateway`；该 CLI 不代表能够控制任意操作系统图形界面。

## 开发核验

```bash
npm run build --prefix ./apps/cli
node apps/cli/dist/index.js --help
```

本项目基于 LobeHub/ComHub 上游能力定制，许可证与归属见仓库根目录 `LICENSE`、`NOTICE` 和 `README.md`。
