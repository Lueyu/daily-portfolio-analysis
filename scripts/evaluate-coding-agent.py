"""Opt-in real-provider autonomy evaluation; never runs as a normal unit test.

The model receives only the problem and starter repo. The external oracle is
copied into a separate container AFTER the model finishes and cannot be edited
by it. No production iteration/model-call/time budget is imposed here.
"""
from __future__ import annotations

import argparse
import json
import time
import uuid
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'agent' / 'src'))

from agent_core.config import get_settings
from agent_core.models import ChatService, ModelTask
from agent_core.coder.general_harness import GeneralHarness
from agent_core.coder.general_state import seed_workspace
from agent_core.coder.models import AcceptanceCriterion, CheckKind, DevTask
from agent_core.coder.runtime import ContainerRuntime
from agent_core.coder.task_store import TaskStore

SERVER = """const http=require('node:http'),fs=require('node:fs');
http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync('index.html'));}).listen(8080,'0.0.0.0');
"""
UI = """<!doctype html><html lang="zh"><meta charset="UTF-8"><title>任务筛选</title>
<style>body{font-family:sans-serif;background:#fff;color:#111;padding:32px}button{padding:12px 20px;background:#f3f4f6;color:#111827;border:1px solid #bbb}.selected{background:#fff;color:#fff}li{margin:12px}</style>
<h1>任务列表</h1><button class="selected" data-filter="all" aria-pressed="true">全部</button><button data-filter="active" aria-pressed="false">进行中</button>
<ul id="tasks"><li data-state="active">编写文档</li><li data-state="done">完成测试</li></ul>
<script>document.querySelectorAll('button').forEach(b=>b.onclick=()=>{document.querySelectorAll('button').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b))});document.querySelectorAll('li').forEach(x=>x.hidden=b.dataset.filter==='active'&&x.dataset.state!=='active')})</script></html>"""
FEATURE = """<!doctype html><html lang="zh"><meta charset="UTF-8"><title>加法计算器</title><h1>加法计算器</h1>
<label>第一个数<input id="a" type="number" value=""></label><label>第二个数<input id="b" type="number" value=""></label><button id="add">计算</button><output id="result"></output>
<script>document.querySelector('#add').onclick=()=>{document.querySelector('#result').textContent=String(Number(document.querySelector('#a').value)+Number(document.querySelector('#b').value))}</script></html>"""
UNIT = """const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
test('page and script exist',()=>{const html=fs.readFileSync('index.html','utf8');assert.match(html,/<h1>/);assert.match(html,/<script>/);assert.match(html,/<button/)});
"""
ORACLE_HEAD = """const {test}=require('node:test');const assert=require('node:assert/strict');const {spawn}=require('node:child_process');const {chromium}=require('playwright');
test('external user acceptance',async()=>{const server=spawn('node',['app.cjs']);let browser;try{
for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:8080')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage();await page.goto('http://127.0.0.1:8080');
"""
ORACLE_TAIL = """}finally{if(browser)await browser.close();server.kill();}});"""
ORACLES = {
    "ui": ORACLE_HEAD + """
const all=page.getByRole('button',{name:'全部',exact:true}), active=page.getByRole('button',{name:'进行中',exact:true});
for(const button of [all,active,all]){await button.click();assert.equal(await button.getAttribute('aria-pressed'),'true');
const ratio=await button.evaluate(e=>{const s=getComputedStyle(e);const lum=c=>{const rgb=c.match(/[\\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]};const a=lum(s.color),b=lum(s.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)});assert.ok(ratio>=4.5,'selected contrast must be >=4.5; got '+ratio)}
await active.click();assert.equal(await page.locator('li:visible').count(),1);await all.click();assert.equal(await page.locator('li:visible').count(),2);
""" + ORACLE_TAIL,
    "feature": ORACLE_HEAD + """
await page.locator('#a').fill('7');await page.locator('#b').fill('-2');await page.getByRole('button',{name:'计算',exact:true}).click();assert.equal(await page.locator('#result').textContent(),'5');
const reset=page.getByRole('button',{name:/重置|清空/});assert.equal(await reset.count(),1);await reset.click();assert.equal(await page.locator('#a').inputValue(),'');assert.equal(await page.locator('#b').inputValue(),'');assert.equal(await page.locator('#result').textContent(),'');
await page.locator('#a').fill('1.5');await page.locator('#b').fill('2.25');await page.getByRole('button',{name:'计算',exact:true}).click();assert.equal(await page.locator('#result').textContent(),'3.75');
""" + ORACLE_TAIL,
}


def assessment(source, directory, case, settings):
    workspace = directory / 'workspace'
    seed_workspace(source, workspace)
    (workspace / 'external-oracle.cjs').write_text(ORACLES[case], encoding='utf-8')
    runtime = ContainerRuntime('dev_oracle' + uuid.uuid4().hex[:8], workspace, directory / 'engine',
                               image=settings.coder_runtime_image, docker_prefix=settings.coder_docker_command)
    checks = {}
    try:
        runtime.ensure()
        for name, command in [('existing', 'node --test test.cjs'), ('oracle', 'node --test external-oracle.cjs')]:
            result = runtime.terminal_start(command, timeout_seconds=90)
            while result['status'] == 'running':
                result = runtime.terminal_poll(result['session_id'], wait_ms=1000)
            checks[name] = result
        (directory / 'result.json').write_text(json.dumps(checks, indent=2, ensure_ascii=False), encoding='utf-8')
    finally:
        runtime.stop_all()
    return {name: value['exit_code'] for name, value in checks.items()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('case', choices=['ui', 'feature'])
    parser.add_argument('--directory', type=Path)
    args = parser.parse_args()
    settings = get_settings()
    root = args.directory or Path(settings.coder_data_dir) / 'evaluations' / (args.case + '-' + uuid.uuid4().hex[:8])
    root = root.resolve()
    root.mkdir(parents=True, exist_ok=False)
    source = root / 'starter'
    source.mkdir()
    for name, content in {'app.cjs': SERVER, 'index.html': UI if args.case == 'ui' else FEATURE,
                          'test.cjs': UNIT, 'package.json': json.dumps({'scripts': {'start': 'node app.cjs', 'test': 'node --test test.cjs'}})}.items():
        (source / name).write_text(content, encoding='utf-8')
    baseline = assessment(source, root / 'baseline', args.case, settings)
    print(json.dumps({'directory': str(root), 'baseline': baseline}), flush=True)
    assert baseline == {'existing': 0, 'oracle': 1}, 'fixture must have green tests but fail independent acceptance'
    problem = ('页面任务筛选按钮选中后文字看不清，请自己运行页面定位并修复，让选中状态文字清晰可读（对比度至少4.5），点击全部和进行中的筛选行为保持正确。' if args.case == 'ui' else
               '请给这个加法计算器添加一个“重置”按钮，点击后清空两个输入框和结果；之后仍能继续正确计算，包括小数和负数。')
    task = DevTask(id='dev_eval' + uuid.uuid4().hex[:8], title='真实自主验收 ' + args.case, problem=problem,
                   workdir=str(source), runtime_version=2,
                   acceptance=[AcceptanceCriterion(id='a1', description=problem, check=CheckKind.UNIT)])
    store = TaskStore(root / 'tasks')
    store.create(task)
    chat = ChatService(settings)
    harness = GeneralHarness(task, chat, store, runtime_image=settings.coder_runtime_image,
                             docker_prefix=settings.coder_docker_command,
                             supports_tools=chat.supports_tools_for(ModelTask.CODE))
    start = time.monotonic()
    print(json.dumps({'task_id': task.id, 'model': chat.spec_for_task(ModelTask.CODE).model,
                      'supports_images': chat.supports_images_for(ModelTask.CODE)}), flush=True)
    harness.run()
    candidate = assessment(harness.workspace, root / 'candidate', args.case, settings)
    events = [json.loads(line) for line in (harness.state_dir / 'events.jsonl').read_text(encoding='utf-8').splitlines()]
    result = {'case': args.case, 'task_id': task.id, 'status': task.status.value,
              'baseline': baseline, 'candidate': candidate, 'seconds': round(time.monotonic()-start, 2),
              'model_calls': sum(e['action'] == 'model' for e in events),
              'source_changes': sum(bool(c['files']) for c in harness.journal.list_changes()),
              'events': len(events), 'models': sorted({e['payload']['model'] for e in events if e['action'] == 'model'}),
              'passed': task.status.value == 'awaiting_approval' and candidate == {'existing': 0, 'oracle': 0}}
    (root / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
