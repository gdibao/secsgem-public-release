# Fab 本地市场批量导入

`build-installable-catalog.py` 将已经落盘的 LobeHub 市场镜像和本地内容整理为
Fab 的稳定离线市场协议。它不访问 LobeHub，不执行全量同步，也不修改源快照。

稳定目录包含：

- `manifest.json`：协议版本及三类目录路径；
- `assistant/catalog.json`：可复制为当前用户私有副本的助手定义；
- `catalog.json`：技能内容包索引；
- `skills/<id>/<sha256>.zip`：不可变技能包；
- `mcp/catalog.json`：MCP 连接或部署定义。

应用只读取 `FAB_LOCAL_INSTALLABLE_BASE_URL` 指向的稳定目录。后续批量导入的流程是：

1. 从既有镜像、快照和内容缓存生成新的版本目录；
2. 校验目录结构、路径、包哈希和 ZIP 完整性；
3. 审核计数和差异后，原子切换 `installable-current`；
4. 等待应用目录缓存过期或仅失效目录缓存。

上述流程不修改 Fab 源码，不需要重新构建应用。LobeHub 已发布内容沿用其来源状态；
`official`、`featured`、`validated` 只按镜像原字段展示，不由 Fab 伪造或二次评级。
权限、凭据示例和 Shell 说明作为安装提示保留，不作为内容质量阻断。仅缺少必需结构、
包损坏、路径不安全或无法映射到原生类型的记录进入资料目录。

目录协议不包含 LobeHub 登录地址、OIDC 配置或 MarketAuth 数据。助手安装创建当前用户
私有副本；技能先安装到当前用户再绑定助手；MCP 只使用 Fab 服务端连接配置或隔离
runner，浏览器不接收服务凭据。
