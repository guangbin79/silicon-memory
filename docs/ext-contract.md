# agentctl ext 契约（三方 CLI 接入标准）

`agentctl`（部署方私有壳）对外部命令族的接入采用**落件约定**：ext 文件本身就是注册——写文件即安装，删文件即卸载，扫目录即发现。无注册命令、无状态库。

## 契约三要素

1. **文件名＝命令族名**：`~/.config/agentctl/ext/<family>.sh`；agentctl 对未命中的 `<family>` 自动查此文件
2. **内容＝一行 exec**：`exec <your-cli> <family> "$@"`——剩参全量透传，组名对齐（`agentctl <family> <sub>` → `<cli> <family> <sub>`）
3. **可选 `# desc:` 头**：一句话描述，`agentctl ext list`／帮助扫描时呈现

## 生命周期

| 动作 | 执行者 | 动作 |
|------|--------|------|
| 安装 | 域仓自己的 `install.sh` | 完成自身安装后落 ext 件（幂等：已存在则不动） |
| 卸载 | 域仓卸载入口 | 对称清理：删自己的 ext 件＋symlink＋config |
| 发现 | agentctl | `agentctl --help` 列 `memory (ext)` 形态；`agentctl ext list` 出族名＋desc＋目标健康 |

## 设计规则

- **安装入口永远是域仓自身安装器**——agentctl 不提供安装/卸载命令：公开部署环境没有 agentctl，且私有壳不得耦合公开仓的安装演进
- **agentctl 只读消费** ext 目录；内建命令族优先，ext 仅补未命中命名空间
- ext 件缺失时 `agentctl <family>` 报 `extension '<family>' not installed`——降级诚实
- 参考实现：本仓 install.sh 的 `ext/{memory,knowledge}.sh` 落件段
