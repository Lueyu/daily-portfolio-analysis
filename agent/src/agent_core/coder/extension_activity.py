"""Public descriptions of orchestration; full configuration stays in details."""

WORKER_STATUS = {'pending': '等待执行', 'starting': '启动中', 'running': '执行中', 'completed': '已完成',
                 'blocked': '受阻', 'failed': '失败', 'cancelled': '已取消',
                 'cancelling': '正在取消', 'merged': '已合并', 'cleanup_failed': '清理失败'}


def extension_summary(step, result):
    action = type(step).__name__
    if action == 'Capabilities':
        summary = f'检查模型与工具能力 · {len(result.get("tools", []))} 项工具'
    elif action == 'UpdatePlan':
        plan = result.get('plan', [])
        completed = sum(item.get('status') == 'completed' for item in plan)
        current = next((item.get('step') for item in plan if item.get('status') == 'in_progress'), '')
        summary = f'更新计划 · 已完成 {completed}/{len(plan)}'
        if current:
            summary += f' · 正在{current}'
    elif action == 'Remember':
        summary = f'保留任务进度 · {len(step.facts)} 条发现 · {len(step.next_actions)} 个后续步骤'
    elif action == 'McpTools':
        summary = f'发现 MCP 工具 · {step.server or "全部服务"} · {len(result.get("tools", []))} 项工具'
        if result.get('errors') or result.get('ok') is False:
            summary += ' · 部分服务不可用'
    elif action == 'McpCall':
        status = '失败' if result.get('ok') is False else '已完成'
        summary = f'调用 MCP · {step.server}/{step.tool} · {status}'
    elif action == 'SkillsList':
        summary = f'查找项目技能 · {len(result.get("skills", []))} 项可用'
        if result.get('errors'):
            summary += ' · 部分目录无法读取'
    elif action == 'SkillRead':
        name = result.get('skill', {}).get('name') or step.skill_id
        summary = f'读取项目技能 · {name}'
        if result.get('ok') is False:
            summary += ' · 未找到'
    elif action == 'InspectImage':
        summary = f'观察截图 · {step.question}'
    elif action == 'InspectLocalApp':
        listening = result.get('tcp', {}).get('postgres', {}).get('listening')
        status = '可连接' if listening else '不可连接'
        summary = f'观察本机主项目 · 数据库 {status} · 仅诊断，不代表沙箱验收'
    elif action == 'AgentSpawn':
        summary = f'启动子任务 · {step.prompt}'
    elif action == 'AgentList':
        workers = result.get('workers', [])
        active = sum(item.get('status') in {'starting', 'running', 'cancelling', 'cleanup_failed'} for item in workers)
        summary = f'查看子任务 · 共 {len(workers)} 项 · {active} 项未结束'
    elif action in {'AgentPoll', 'AgentCancel'}:
        label = '查看子任务' if action == 'AgentPoll' else '取消子任务'
        status = WORKER_STATUS.get(result.get('status'), '状态已更新')
        summary = f'{label} · {status}'
        if result.get('prompt'):
            summary += f' · {result["prompt"]}'
    elif action in {'AgentDiff', 'AgentMerge'}:
        label = '审阅子任务修改' if action == 'AgentDiff' else '合并子任务修改'
        summary = f'{label} · {len(result.get("files", []))} 个文件'
    else:
        summary = '执行扩展工具'
    return ' '.join(summary.split())[:240]
