/**
 * 本地开发数据库配置（仅用于在本地 PostgreSQL 里重建业务表结构）。
 *
 * 业务表 schema.ts 使用不带 schema 前缀的 pgTable(...)，运行时靠 search_path
 * 解析到 workspace schema。这里通过连接串 options 把会话 search_path 设为
 * workspace_aadkwdme7deas，使 drizzle-kit 把表建在该 schema 下。
 *
 * 注意：这里故意使用「纯对象」导出、不 import { defineConfig } from 'drizzle-kit'，
 * 这样在未把 drizzle-kit 安装为项目依赖时，通过 `npx drizzle-kit` 也能加载本配置。
 *
 * 仅本地使用，连接的是本机 trust 认证的 PostgreSQL（无密码、无敏感信息）。
 */
export default {
  dialect: 'postgresql',
  schema: './server/database/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url:
      'postgres://postgres@127.0.0.1:5432/portfolio?options=-csearch_path%3Dworkspace_aadkwdme7deas',
  },
  verbose: true,
};
