"""Prompt templates for the coder inner loop.

The prompts are deliberately explicit about:
  * the closed action set (read-only exploration read_file/list_dir/glob/grep/
    probe_env, then run_check / apply_patch / finish / blocked);
  * the red-first verification gate and the ban on editing/skipping tests;
  * the fact that a patch is proposed, never committed or pushed by the agent.

JSON-only replies are requested so parser.py can validate them.
"""

from __future__ import annotations

from .models import AcceptanceCriterion, CheckKind

_ACTION_CONTRACT = (
    "只输出一个 JSON 对象，不要输出多余解释。允许的 action 仅有：\n"
    "1. read_file：{\"action\":\"read_file\",\"params\":{\"path\":\"server/...\"}}\n"
    "1b. list_dir：{\"action\":\"list_dir\",\"params\":{\"path\":\"server\"}}\n"
    "1c. glob：{\"action\":\"glob\",\"params\":{\"pattern\":\"server/**/*.ts\"}}\n"
    "1d. grep：{\"action\":\"grep\",\"params\":{\"pattern\":\"正则\",\"glob_include\":\"*.ts\"}}\n"
    "1e. probe_env：{\"action\":\"probe_env\"}（探测本地数据库/后端/前端是否在运行）\n"
    "2. run_check：{\"action\":\"run_check\",\"params\":{\"check\":\"unit|e2e|typecheck|lint\"}}\n"
    "3. apply_patch：{\"action\":\"apply_patch\",\"params\":{\"diff\":\"<unified diff>\",\"hypothesis\":\"<根因>\"}}\n"
    "4. finish：{\"action\":\"finish\",\"params\":{\"summary\":\"...\"}}\n"
    "5. blocked：{\"action\":\"blocked\",\"params\":{\"reason\":\"...\"}}\n"
)

_GUARDRAILS = (
    "硬性约束：\n"
    "- 不得运行白名单之外的命令，不得访问网络、不得安装依赖、不得修改依赖清单。\n"
    "- 不能修改、删除或跳过任何测试来让它通过；不能删除 expect/assert 断言。\n"
    "- 只能读取/修改工作目录内的业务代码，不能读取 .env、.venv、node_modules、.git。\n"
    "- 你提出的只是补丁，禁止自行提交或推送；补丁经人工确认后才会落地。\n"
)


def _fmt_acceptance(acceptance: list[AcceptanceCriterion]) -> str:
    lines = []
    for c in acceptance:
        lines.append(
            f"- [{c.id}] ({c.check.value} -> {_script(c.check)}) {c.description}"
            + (f"（目标：{c.target}）" if c.target else "")
        )
    return "\n".join(lines)


def _script(kind: CheckKind) -> str:
    return {
        CheckKind.UNIT: "npm run test:unit",
        CheckKind.E2E: "npm run test:e2e",
        CheckKind.TYPECHECK: "npm run type:check",
        CheckKind.LINT: "npm run lint",
    }[kind]


def reproduce_prompt(problem: str, acceptance: list[AcceptanceCriterion]) -> str:
    return (
        "你是资深工程师，正在修复一个 webapp 缺陷。第一步必须先复现，禁止猜测修复。\n"
        f"问题描述：{problem}\n\n"
        "验收标准（不可放宽）：\n"
        f"{_fmt_acceptance(acceptance)}\n\n"
        "先用 list_dir / glob / grep 定位相关代码与测试（少量、有针对性），"
        "再用 read_file 读关键文件，然后用 run_check 运行能复现该问题的测试。\n"
        "不要连续盲读文件：定位到关键代码后就必须 run_check 取证。\n"
        "凡是现象像“页面为空、本地无数据、连不上、服务无响应”，先调用 probe_env："
        "若有服务 DOWN，直接输出 blocked，reason 写明哪个服务没起、如何启动"
        "（例如 PostgreSQL 未运行就执行 scripts/db/start-db.ps1）。\n"
        "若配置的相关 run_check 均通过且无法复现，可能当前代码已修复；"
        "不要为获得红灯制造失败，不要重复搜索相同内容，"
        "应 blocked 说明缺少能够复现的用例或步骤，不能据此宣称修复成功。\n"
        "若你判断问题属于本地环境/数据库/数据迁移/seed/配置 "
        "（而非代码缺陷），立即输出 blocked；reason 中给出可执行的人工排查清单，"
        "例如：相关服务是否启动、数据库是否可连接、迁移与 seed 是否执行、应用实际指向哪个配置。\n"
        f"{_ACTION_CONTRACT}\n{_GUARDRAILS}"
    )


_REACT_RULES = (
    "工作方式（ReAct）：每一轮只做一个决定——调用一个工具，或宣布完成/受阻。\n"
    "1. 先复现：在看到一个真正失败的测试之前，禁止修改代码。\n"
    "   先做少量、有针对性的只读探查，然后用 run_check 取证。\n"
    "2. 看到红灯后，才允许 apply_patch；补丁必须最小、对症。\n"
    "3. 补丁会在隔离沙箱里自动跑验收检查；只有全部通过后你才会看到 finish 工具。\n"
    "4. 不要连续盲读：若现象像本地环境/数据/连不上，先 probe_env，服务 DOWN 就 blocked。\n"
    "5. 一轮最多提交一个写操作（apply_patch）。\n"
    "6. 同一文件/搜索返回相同内容不算进展，程序会对重复探查主动运行复现检查。"
    "若配置的检查均通过而问题无法复现，用 blocked 说明需补充用例；"
    "不要为了开放补丁工具而制造失败，也不要把检查全绿当作已完成用户需求。\n"
)


def react_system_prompt(problem: str, acceptance: list[AcceptanceCriterion]) -> str:
    """System prompt shared by the native and JSON ReAct protocols."""
    return (
        "你是资深工程师，正在一个隔离的 git worktree 沙箱里修复 webapp 缺陷。\n"
        "你通过调用工具推进；每一步都基于上一步工具返回的真实证据，不要猜测。\n\n"
        f"问题描述：{problem}\n"
        "验收标准（不可放宽）：\n"
        f"{_fmt_acceptance(acceptance)}\n\n"
        f"{_REACT_RULES}\n"
        f"{_GUARDRAILS}"
    )


def json_tools_contract(visible_specs) -> str:
    """Describe only the tools currently exposed by the capability gates."""
    lines = ["只输出一个 JSON 对象，不要输出多余解释。当前可用工具："]
    for item in visible_specs:
        if isinstance(item, str):
            name, description = item, ""
        else:
            name, description = item.name, item.description
        lines.append(f"- {name}：{description}" if description else f"- {name}")
    lines.append(
        '形如：{"action":"工具名","params":{...}}（也允许把参数平铺在顶层）。')
    return "\n".join(lines)
