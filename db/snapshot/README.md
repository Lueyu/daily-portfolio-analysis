# 数据快照目录（本地，不提交）

本目录存放从妙搭（Miaoda）应用导出的真实数据快照——按表拆分的 `*.sql`，
由 [`scripts/db/rebuild-local.ps1`](../../scripts/db/rebuild-local.ps1)
导入本地 PostgreSQL，让本地全栈离线运行时能看到真实持仓。

> ⚠️ 这些 `*.sql` 含个人持仓与账户数据，仅保存在本地并由 `.gitignore` 忽略；这份说明文件纳入版本管理。

## 快照文件（按外键顺序导入）

| 文件 | 表 | 说明 |
| --- | --- | --- |
| `groups.sql` | groups | 持仓分组（holdings 依赖它，必须先导） |
| `holdings.sql` | holdings | 持仓 |
| `transactions.sql` | transactions | 交易记录 |
| `watchlist.sql` | watchlist | 关注股 |
| `analysis.sql` | analysis | 每日分析 |
| `journal.sql` | journal | 投资日志 |
| `snapshots.sql` | snapshots | 组合快照 |

`archive/` 下的 `*.before-recovery.sql` 以及 `backups/` 下的历史备份不参与导入。

## 如何导出

在妙搭应用的源码 / 数据导出能力中，把数据库各表导出为只含
`INSERT INTO "workspace_<id>"."<table>" ...` 的 SQL（UTF-8），按上表命名放入本目录。

## 如何导入本地库

```powershell
# 一键：启动 PostgreSQL（若未运行）→ 建库建表建角色 → 导入全部快照
powershell -ExecutionPolicy Bypass -File scripts\db\rebuild-local.ps1
```

owner 是复合类型 `user_profile`，导出值形如 `'(1876929917073563)'`，
PostgreSQL 会按复合类型正常解析，无需手工处理。
