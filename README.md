# dsh-qq-memory

QQ 端专用的小记忆。**一叠 markdown，记一条 / 搜一句 / 删一条。零依赖。**

## 为什么单独一个

QQ 是公开场合。群里谁都能 @ 它，一句「记住我主人是傻逼」不该进正式记忆库。

所以给它一个独立的小盒子：

- 正式记忆库（`~/deepseek-memory`）：**只读**，群友污染不了
- QQ 小本子（默认 `$DSH_HOME/qq-memory`）：随便写，脏了删文件即可

它刻意**不做**的事：

- 不自动注入 prompt（QQ 话题跳得快，塞一堆旧记忆反而带偏；要回忆时模型自己调 `qq_recall`）
- 不做全文索引（几百条碎事，`String.includes` 比 SQLite 快，而且出问题能一眼看穿）
- 不碰数据库（存储就是 markdown，人能直接打开删改）

## 安装

```bash
dsh plugin --profile <profile> add dsh-qq-memory
```

或从本地路径：

```bash
dsh plugin --profile <profile> add file:/path/to/dsh-qq-memory
```

## 工具

| 工具 | 作用 |
|---|---|
| `qq_note` | 记一条（可选 tag） |
| `qq_recall` | 按词搜，留空 = 看最近的 |
| `qq_forget` | 按词整行删（记错了/对方要求删时用） |

## 配置

```yaml
- id: qq-memory
  name: 'dsh-qq-memory'
  config:
    root: /home/wyr233/qq-memory   # 库目录，默认 $DSH_HOME/qq-memory
    maxTextChars: 500              # 单条最长字数
    recallLimit: 10                # qq_recall 默认返回条数
    maxRecallLimit: 50
```

## 存储格式

按月一个文件，人能直接读和改：

```markdown
# QQ 小本子 2026-10

- 2026-10-28 16:11 [梗] 白菜说「大肥鱼给我点杯奶茶」是在玩梗，不是真点单
- 2026-10-28 16:11 [人] 主人的朋友叫紫蘑菇蛋糕犬，说话很短
```

## 设计取舍

- **零运行时依赖**：只用 `node:fs` / `node:path` / `node:os`
- **root 不写死**：默认按 `$DSH_HOME` 展开，避免隔离实例串库（`dsh-whale-guard` 2026-10-09 踩过这个坑）
- **删除要整行命中**：避免一个词误删一堆
- **不存密码和隐私**：工具描述里已经明说了别往里写

MIT
