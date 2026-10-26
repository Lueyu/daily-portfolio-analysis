"""Short public activity labels; raw results remain available in event payloads."""


def tool_summary(action, step, result):
    inputs = step.model_dump(exclude_none=True)
    command = inputs.get('command') or result.get('command')
    if action in {'TerminalStart', 'TerminalPoll', 'TerminalCancel', 'Verify'}:
        verification = result.get('verification')
        if verification:
            state = '通过' if verification.get('passed') else '未通过'
        elif result.get('status') == 'running':
            state = '运行中'
        else:
            code = result.get('exit_code')
            state = f'退出码 {code}' if code is not None else result.get('status', '已读取')
        label = '验证目标' if inputs.get('scope') == 'target' else (
            '验证回归' if inputs.get('scope') == 'regression' else '执行命令')
        summary = f'{label} · {command or "终端输出"} · {state}'
    elif action == 'Browser':
        operation = inputs.get('action')
        labels = {'navigate': '打开网页', 'snapshot': '观察页面', 'screenshot': '截取页面',
                  'click': '点击元素', 'fill': '填写输入', 'press': '键盘操作', 'select': '选择选项',
                  'scroll': '滚动页面', 'styles': '检查样式', 'wait_for': '等待页面内容', 'close': '关闭浏览器'}
        if operation == 'errors':
            summary = ('检查浏览器 · 页面错误 ' + str(len(result.get('pageErrors', [])))
                       + ' · HTTP 错误 ' + str(len(result.get('httpErrors', [])))
                       + ' · 网络错误 ' + str(len(result.get('networkFailures', []))))
        else:
            target = inputs.get('url') or inputs.get('ref') or inputs.get('text') or result.get('url', '')
            summary = f'{labels.get(operation, operation)} · {target}'
    elif action in {'read_file', 'list_dir', 'glob', 'grep'}:
        labels = {'read_file': '读取文件', 'list_dir': '查看目录', 'glob': '查找文件', 'grep': '搜索代码'}
        target = inputs.get('pattern') or inputs.get('path', '.')
        summary = f'{labels[action]} · {target}'
        if action == 'read_file' and inputs.get('start_line', 1) > 1:
            summary += f' · 第 {inputs["start_line"]} 行起'
    elif action in {'WriteFile', 'EditFile', 'ApplyPatchStep'}:
        target = inputs.get('path') or f'{len(result.get("files", []))} 个文件'
        summary = f'修改文件 · {target} · {inputs.get("reason") or inputs.get("hypothesis", "")}'
    elif action in {'ServiceStart', 'ServicePoll', 'ServiceStop'}:
        summary = f'预览服务 · {result.get("url", "")} · {result.get("status", "")}'
    elif action == 'Changes':
        summary = f'查看修改 · {len(result.get("changes", []))} 笔操作'
    elif action in {'UndoChange', 'RestoreCheckpoint'}:
        summary = f'恢复源码 · {len(result.get("files", []))} 个文件'
    elif action == 'TerminalWrite':
        summary = '向运行中的终端发送输入'
    else:
        summary = action
    return ' '.join(str(summary).split())[:240]
