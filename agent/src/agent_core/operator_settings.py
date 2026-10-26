"""User-owned settings, outside editable tasks. Never return credential values."""
from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .coder.integrations.config import ServerConfig, load_servers
from .models.profiles import profile_connection


class ModelInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    model: str | None = Field(default=None, max_length=200)
    baseUrl: str | None = None
    apiKey: str | None = Field(default=None, max_length=16384, repr=False)
    clearApiKey: bool = False
    supportsImages: bool | None = None
    contextWindow: int | None = Field(default=None, ge=4096, le=2000000)
    maxOutputTokens: int | None = Field(default=None, ge=256, le=65536)

    @field_validator('baseUrl')
    @classmethod
    def endpoint(cls, value):
        if value is None:
            return value
        parsed = urlsplit(value)
        if parsed.scheme not in ('https', 'http') or not parsed.hostname or any(
                (parsed.username, parsed.password, parsed.query, parsed.fragment)):
            raise ValueError('模型地址必须是无凭证的 HTTP(S) 地址')
        return value.rstrip('/')

    @field_validator('apiKey')
    @classmethod
    def secret(cls, value):
        if value and ('\n' in value or '\r' in value):
            raise ValueError('密钥不能包含换行')
        return value


def _path(settings):
    path = Path(settings.coder_settings_path).expanduser().resolve()
    if path.is_relative_to(Path(settings.webapp_workdir).resolve()):
        raise ValueError('操作员配置必须位于可编辑工作区之外')
    return path


def _load(settings):
    path = _path(settings)
    if not path.exists():
        return {}
    if path.stat().st_size > 262144:
        raise ValueError('操作员配置超过 256 KB')
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(value, dict) or set(value) - {'models', 'mcpServers', 'mcpCredentials'}:
            raise ValueError()
        return value
    except (ValueError, UnicodeError):
        raise ValueError('操作员配置文件格式不合法') from None


def _servers(settings):
    inline = settings.coder_mcp_servers
    if inline is not None:
        try:
            return {name: ServerConfig.model_validate(config) for name, config in inline.items()}
        except (ValidationError, AttributeError, TypeError):
            raise ValueError('已保存的 MCP 配置不合法，请检查字段格式') from None
    return load_servers(settings.coder_mcp_config, [Path(settings.webapp_workdir)])


def apply_operator_settings(settings):
    doc = _load(settings)
    overrides = {}
    mapping = {'model': 'model', 'baseUrl': 'base_url', 'apiKey': 'api_key',
               'supportsImages': 'supports_images', 'contextWindow': 'context_window',
               'maxOutputTokens': 'max_output_tokens'}
    for role, profile in doc.get('models', {}).items():
        if role not in ('primary', 'vision'):
            raise ValueError('未知模型配置')
        try:
            profile = ModelInput.model_validate(profile).model_dump(exclude_unset=True)
        except ValidationError:
            raise ValueError('已保存的模型配置不合法') from None
        prefix = 'coder_vision' if role == 'vision' else 'coder'
        for field, value in profile.items():
            if field in mapping:
                overrides[f'{prefix}_{mapping[field]}'] = value
        if 'apiKey' in profile:
            overrides[f'{prefix}_api_key_env'] = None
    overrides['coder_mcp_credentials'] = doc.get('mcpCredentials', {})
    if 'mcpServers' in doc:
        overrides['coder_mcp_servers'] = doc['mcpServers']
    return settings.model_copy(update=overrides)


def read_public_settings(settings):
    effective = apply_operator_settings(settings)
    primary_model = effective.coder_model or getattr(effective, f'{effective.coder_model_tier}_model')
    models = {}
    for role, tier in [('primary', 'coder'), ('vision', 'vision')]:
        prefix = 'coder_vision' if role == 'vision' else 'coder'
        base_url, key = profile_connection(effective, tier)
        supports = getattr(effective, f'{prefix}_supports_images')
        if supports is None:
            supports = False if effective.coder_model else getattr(
                effective, f'{effective.coder_model_tier}_supports_images')
        models[role] = {
            'model': (effective.coder_vision_model or '') if role == 'vision' else primary_model,
            'baseUrl': base_url, 'apiKeyConfigured': bool(key), 'supportsImages': supports,
            'contextWindow': getattr(effective, f'{prefix}_context_window') or 128000,
            'maxOutputTokens': getattr(effective, f'{prefix}_max_output_tokens'),
        }
    servers = []
    for name, config in _servers(effective).items():
        servers.append({'name': name, **config.model_dump(), 'credentialStatus': {
            variable: bool(effective.coder_mcp_credentials.get(variable) or os.environ.get(variable))
            for variable in config.headersEnv.values()}})
    return {'ok': True, 'settingsPath': str(_path(settings)), 'applyMode': 'next_run',
            'models': models, 'mcp': {'configPath': str(_path(settings)) if effective.coder_mcp_servers is not None
                                    else effective.coder_mcp_config or '', 'servers': servers}}


def save_settings(settings, update):
    if not isinstance(update, dict) or set(update) - {'models', 'mcp'}:
        raise ValueError('仅允许修改模型和 MCP 配置')
    doc = _load(settings)
    current = read_public_settings(settings)
    models = update.get('models', {})
    if not isinstance(models, dict) or set(models) - {'primary', 'vision'}:
        raise ValueError('未知模型配置')
    for role, raw in models.items():
        if not isinstance(raw, dict) or any(value is None for value in raw.values()):
            raise ValueError('模型字段不能为 null；清除密钥请使用 clearApiKey')
        try:
            parsed = ModelInput.model_validate(raw).model_dump(exclude_unset=True)
        except ValidationError:
            raise ValueError('模型字段不合法，请检查地址、上下文长度和输出限制') from None
        saved = doc.setdefault('models', {}).setdefault(role, {})
        changed_url = 'baseUrl' in parsed and parsed['baseUrl'] != current['models'][role]['baseUrl'].rstrip('/')
        clear = parsed.pop('clearApiKey', False)
        if parsed.get('apiKey') == '':
            parsed.pop('apiKey')
        if 'baseUrl' in parsed and not changed_url and not clear and 'apiKey' not in parsed:
            # A form submits the displayed inherited URL too. Pin its effective
            # credential so saving unrelated fields does not disable that profile.
            parsed['apiKey'] = profile_connection(apply_operator_settings(settings),
                                                 'vision' if role == 'vision' else 'coder')[1]
        if clear or (changed_url and not parsed.get('apiKey')):
            parsed['apiKey'] = None
            parsed.setdefault('baseUrl', current['models'][role]['baseUrl'])
        saved.update(parsed)
    if 'mcp' in update:
        mcp = update['mcp']
        if not isinstance(mcp, dict) or set(mcp) - {'servers', 'credentials'}:
            raise ValueError('MCP 配置不合法')
        rows = mcp.get('servers')
        credentials = mcp.get('credentials', {})
        if not isinstance(rows, list) or len(rows) > 32 or not isinstance(credentials, dict):
            raise ValueError('MCP 服务最多 32 个，凭证需为字段映射')
        servers = {}
        referenced = set()
        old_by_name = {row['name']: row for row in current['mcp']['servers']}
        credential_origins = {}
        for old in old_by_name.values():
            for variable in old['headersEnv'].values():
                credential_origins.setdefault(variable, set()).add(old['url'])
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError('MCP 服务不合法')
            name = row.get('name', '')
            if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', name) or name in servers:
                raise ValueError('MCP 服务名需唯一，仅允许字母、数字、下划线和横线')
            try:
                config = ServerConfig.model_validate({key: value for key, value in row.items() if key != 'name'})
            except ValidationError:
                raise ValueError(f'MCP 服务 {name} 的配置不合法') from None
            if config.allowedTools is not None and not set(config.readOnlyTools).issubset(config.allowedTools):
                raise ValueError('只读工具必须包含在允许工具清单内')
            old = old_by_name.get(name)
            if old and old['url'] != config.url and any(not credentials.get(v) for v in config.headersEnv.values()):
                raise ValueError('MCP 地址改变后必须重新提供认证值，或移除认证映射')
            if any(variable in credential_origins and config.url not in credential_origins[variable]
                   and not credentials.get(variable) for variable in config.headersEnv.values()):
                raise ValueError('MCP 新地址不可复用其他服务的认证值，请重新提供凭证')
            servers[name] = config.model_dump()
            referenced.update(config.headersEnv.values())
        if set(credentials) - referenced or any(not isinstance(v, str) or len(v) > 16384 or '\n' in v or '\r' in v
                                               for v in credentials.values()):
            raise ValueError('凭证只能设置为服务声明的认证变量且不能包含换行')
        saved_credentials = {k: v for k, v in doc.get('mcpCredentials', {}).items() if k in referenced}
        saved_credentials.update({k: v for k, v in credentials.items() if v})
        doc.update(mcpServers=servers, mcpCredentials=saved_credentials)
    serialized = json.dumps(doc, ensure_ascii=False, indent=2)
    if len(serialized.encode()) > 262144:
        raise ValueError('配置超过 256 KB')
    path = _path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix='.settings-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            out.write(serialized + '\n')
        os.replace(temp, path)
    finally:
        Path(temp).unlink(missing_ok=True)
    return read_public_settings(settings)


def _vision_test_image():
    """A valid RGB PNG large enough for providers with minimum image sizes."""
    import base64
    import struct
    import zlib
    def chunk(kind, content):
        return (struct.pack('!I', len(content)) + kind + content
                + struct.pack('!I', zlib.crc32(kind + content) & 0xffffffff))
    width, height = 128, 128
    pixels = (b'\x00' + bytes((32, 96, 224)) * width) * height
    image = (b'\x89PNG\r\n\x1a\n'
             + chunk(b'IHDR', struct.pack('!IIBBBBB', width, height, 8, 2, 0, 0, 0))
             + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b''))
    return 'data:image/png;base64,' + base64.b64encode(image).decode('ascii')


def _model_test_error(response):
    # Classify provider errors without echoing a provider-controlled message,
    # which may contain credentials, request bodies or private endpoints.
    try:
        error = response.json().get('error', {})
        code = str(error.get('code', '')).casefold()
        detail = str(error.get('message', '')).casefold()
    except (ValueError, AttributeError):
        code, detail = '', ''
    if code == 'modelnotopen':
        hint = '该模型尚未开通，请在服务商控制台开通对应模型后重试'
    elif response.status_code in (401, 403):
        hint = '认证或访问权限不足，请检查凭证和模型授权'
    elif response.status_code == 429:
        hint = '请求受到限流或额度限制，请检查服务商额度后重试'
    elif 'image' in detail and ('dimension' in detail or 'too small' in detail):
        hint = '图片尺寸不符合模型要求，请检查输入图片的宽高'
    elif response.status_code == 400:
        hint = '模型拒绝输入参数，请确认这是支持图片输入的聊天模型及兼容端点'
    else:
        hint = '检查模型用途、端点和访问权限'
    return {'ok': False, 'message': f'模型测试返回 HTTP {response.status_code}；{hint}'}


def test_connection(settings, target, server=None):
    """Small, explicit network test; no external writes and no model content returned."""
    effective = apply_operator_settings(settings)
    try:
        if target == 'mcp':
            from .coder.integrations.mcp import MCPClient
            configs = _servers(effective)
            if server not in configs:
                return {'ok': False, 'message': '请选择已保存的 MCP 服务'}
            client = MCPClient(server, configs[server].model_copy(update={'allowedTools': None}),
                               credentials=effective.coder_mcp_credentials)
            rows = client.redact(client.list_tools())
            return {'ok': True, 'message': f'连接成功，发现 {len(rows)} 个工具；仍以已保存的允许清单决定可用工具',
                    'tools': [{'name': row['name'], 'description': row.get('description', '')[:500]} for row in rows]}
        if target not in ('primary', 'vision'):
            return {'ok': False, 'message': '未知测试目标'}
        import httpx
        public = read_public_settings(settings)['models'][target]
        base_url, key = profile_connection(effective, 'vision' if target == 'vision' else 'coder')
        if not key or not public['model']:
            return {'ok': False, 'message': '缺少模型名称或凭证，请先保存配置'}
        content = 'Reply with OK.'
        if target == 'vision':
            if not public['supportsImages']:
                return {'ok': False, 'message': '请先启用图片输入能力'}
            content = [{'type': 'text', 'text': 'What is the dominant color? Reply with one word.'},
                       {'type': 'image_url', 'image_url': {'url': _vision_test_image()}}]
        with httpx.Client(timeout=25, follow_redirects=False, trust_env=effective.model_trust_env) as client:
            response = client.post(base_url.rstrip('/') + '/chat/completions', headers={'Authorization': 'Bearer ' + key},
                                   json={'model': public['model'], 'messages': [{'role': 'user', 'content': content}],
                                         'max_tokens': 256 if target == 'vision' else 32})
        if response.status_code >= 300:
            return _model_test_error(response)
        data = response.json()
        if not isinstance(data, dict) or not data.get('choices'):
            return {'ok': False, 'message': '服务未返回兼容的聊天结果'}
        if target == 'vision' and not data['choices'][0].get('message', {}).get('content'):
            return {'ok': False, 'message': '模型接受了图片但未返回可见回答，请检查输出上限或模型思考设置'}
        return {'ok': True, 'message': '图片输入测试成功' if target == 'vision' else '聊天连接测试成功'}
    except Exception as exc:
        # Neither provider payloads nor URLs containing accidental credentials escape.
        return {'ok': False, 'message': f'连接测试失败（{type(exc).__name__}），请检查地址、凭证和网络'}
