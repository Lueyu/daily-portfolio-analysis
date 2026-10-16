-- 03_roles.sql
-- 本地模拟妙搭 datapaas 的多租户角色与权限。
--
-- 平台后端在每个 HTTP 请求的 SQL 上下文里执行：
--   SET LOCAL ROLE 'service_role_<schema>'   -- 系统调用
--   SET LOCAL ROLE 'authenticated_<schema>'  -- 登录用户
--   SET LOCAL ROLE 'anon_<schema>'           -- 匿名用户
-- 其中 <schema> 来自连接串 ?schema= 参数。本地连接串使用
-- ?schema=workspace_aadkwdme7deas，因此需要下面三个角色真实存在，否则 SET LOCAL ROLE 报错。
--
-- 本地为开发库：三个角色都授予 workspace schema 的全部权限，且不启用 RLS
-- （导出的表结构本身不含 RLS 策略），保证读/写/导入都能正常进行。

DO $$
DECLARE
  r text;
  roles text[] := ARRAY[
    'service_role_workspace_aadkwdme7deas',
    'authenticated_workspace_aadkwdme7deas',
    'anon_workspace_aadkwdme7deas'
  ];
BEGIN
  FOREACH r IN ARRAY roles LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;

    EXECUTE format('GRANT ALL ON SCHEMA workspace_aadkwdme7deas TO %I', r);
    EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA workspace_aadkwdme7deas TO %I', r);
    EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA workspace_aadkwdme7deas TO %I', r);

    -- 切到该角色后，让裸表名解析到 workspace schema。
    EXECUTE format('ALTER ROLE %I SET search_path = workspace_aadkwdme7deas, public', r);
  END LOOP;
END $$;

-- 数据库级默认 search_path 兜底：即使不经过 SET ROLE，连接后裸表名也能解析到 workspace。
ALTER DATABASE portfolio SET search_path TO workspace_aadkwdme7deas, public;
