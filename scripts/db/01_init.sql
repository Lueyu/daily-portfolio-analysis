-- 01_init.sql
-- 本地 PostgreSQL 初始化：创建与妙搭云端一致的 workspace schema 和复合类型。
--
-- 背景：妙搭（aPaaS）线上把每张业务表放在按 workspace 命名的 schema 下，
-- 并使用两个自定义复合类型（drizzle schema.ts 里的 customType）：
--   - user_profile       : 记录行级所有者（owner / _created_by / _updated_by）
--   - file_attachment    : 附件（bucket_id, file_path），当前业务表未实际使用
--
-- 云平台导出的数据 SQL（INSERT）使用全限定名 workspace_aadkwdme7deas.<table>，
-- 因此本地保持同名 schema，导入时无需改写任何 SQL。

CREATE SCHEMA IF NOT EXISTS workspace_aadkwdme7deas;

-- 行级所有者复合类型。云端导出值形如 (<your_user_id>)，只有一个 user_id 字段。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'workspace_aadkwdme7deas' AND t.typname = 'user_profile'
  ) THEN
    CREATE TYPE workspace_aadkwdme7deas.user_profile AS (user_id text);
  END IF;
END$$;

-- 附件复合类型（与 drizzle customType 定义保持一致，即使当前没有列用到也预先创建）。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'workspace_aadkwdme7deas' AND t.typname = 'file_attachment'
  ) THEN
    CREATE TYPE workspace_aadkwdme7deas.file_attachment AS (bucket_id text, file_path text);
  END IF;
END$$;
