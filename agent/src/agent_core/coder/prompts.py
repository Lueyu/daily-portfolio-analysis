"""Prompt templates for the coder inner loop.

The prompts are deliberately explicit about:
  * the closed action set (only read_file / run_check / apply_patch / finish /
    blocked);
  * the red-first verification gate and the ban on editing/skipping tests;
  * the fact that a patch is proposed, never committed or pushed by the agent.

JSON-only replies are requested so parser.py can validate them.
"""

from __future__ import annotations

from .models import AcceptanceCriterion, CheckKind

_ACTION_CONTRACT = (
    "只输出一个 JSON 对象，不要输出多余解释。允许的 action 仅有：\n"
    "1. read_file：{\"action\":\"read_file\",\"params\":{\"path\":\"server/...\"}}\n"
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
        "先用 read_file 阅读相关代码与测试（少量、有针对性），再用 run_check 运行能复现该问题的测试。\n"
        "不要连续读取大量文件：读完关键代码后就必须 run_check 取证。\n"
        "若 run_check 无法复现，或你判断问题属于本地环境/数据库/数据迁移/seed/配置 "
        "（而非代码缺陷），立即输出 blocked；reason 中给出可执行的人工排查清单，"
        "例如：相关服务是否启动、数据库是否可连接、迁移与 seed 是否执行、应用实际指向哪个配置。\n"
        f"{_ACTION_CONTRACT}\n{_GUARDRAILS}"
    )


def diagnose_prompt(red_evidence: str, observations: list[str]) -> str:
    obs = "\n".join(f"- {o}" for o in observations) or "- （暂无）"
    return (
        "已经复现失败（红灯）。现在基于证据定位根因，给出最小修复假设，再输出补丁。\n"
        f"失败证据：\n{red_evidence}\n\n"
        f"已知观察：\n{obs}\n\n"
        "只允许修改业务代码；补丁必须最小且针对性修复。若同一根因已连续失败两次，"
        "必须重新诊断而不是重复同类修改。\n"
        f"{_ACTION_CONTRACT}\n{_GUARDRAILS}"
    )


def verify_prompt(acceptance: list[AcceptanceCriterion]) -> str:
    return (
        "补丁已生成（尚未落地）。现在严格按验收标准验证，顺序为：\n"
        "1) 先运行相关单测确认目标用例由红转绿；\n"
        "2) 运行相邻/回归用例，防止修一处坏一处；\n"
        "3) 运行 npm run type:check 与 npm run lint；\n"
        "4) 涉及页面流程时运行 npm run test:e2e。\n"
        "全部通过才允许 finish；任何一项失败，带着失败证据 apply_patch 修复或回到诊断。\n"
        "验收标准：\n"
        f"{_fmt_acceptance(acceptance)}\n\n"
        f"{_ACTION_CONTRACT}\n{_GUARDRAILS}"
    )
