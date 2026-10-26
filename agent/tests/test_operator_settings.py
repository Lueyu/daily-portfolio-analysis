import json
from pathlib import Path

import pytest

from agent_core.config import Settings
from agent_core.operator_settings import apply_operator_settings, read_public_settings, save_settings


@pytest.fixture
def settings(tmp_path):
    return Settings(_env_file=None, webapp_workdir=str(tmp_path / 'project'),
                    coder_settings_path=str(tmp_path / 'operator' / 'settings.json'),
                    coder_mcp_config=None, pro_api_key='inherited-secret')


def test_saved_model_applies_next_load_and_public_payload_never_returns_secret(settings):
    result = save_settings(settings, {'models': {'primary': {
        'model': 'coding-model', 'baseUrl': 'https://models.example/v1', 'apiKey': 'private-key'}}})
    assert result['models']['primary']['apiKeyConfigured'] is True
    assert 'private-key' not in json.dumps(result)
    effective = apply_operator_settings(settings)
    assert effective.coder_model == 'coding-model'
    assert effective.coder_api_key == 'private-key'
    save_settings(settings, {'models': {'primary': {'apiKey': ''}}})
    assert apply_operator_settings(settings).coder_api_key == 'private-key'


def test_endpoint_change_does_not_reuse_saved_or_inherited_key(settings):
    save_settings(settings, {'models': {'primary': {
        'baseUrl': 'https://first.example/v1', 'apiKey': 'secret'}}})
    result = save_settings(settings, {'models': {'primary': {'baseUrl': 'https://second.example/v1'}}})
    assert result['models']['primary']['apiKeyConfigured'] is False
    assert apply_operator_settings(settings).coder_api_key is None


def test_mcp_preserves_operator_policy_and_keeps_credentials_out_of_public_json(settings):
    server = {'name': 'docs', 'url': 'https://docs.example/mcp',
              'headersEnv': {'Authorization': 'DOCS_TOKEN'}, 'allowedTools': ['search', 'write'],
              'readOnlyTools': ['search'], 'timeoutSeconds': 30, 'maxResultChars': 24000}
    result = save_settings(settings, {'mcp': {'servers': [server], 'credentials': {'DOCS_TOKEN': 'Bearer hidden'}}})
    assert result['mcp']['servers'][0]['credentialStatus'] == {'DOCS_TOKEN': True}
    assert 'Bearer hidden' not in json.dumps(result)
    saved = json.loads(Path(result['settingsPath']).read_text())
    assert 'Bearer hidden' not in json.dumps(saved['mcpServers'])
    assert apply_operator_settings(settings).coder_mcp_credentials == {'DOCS_TOKEN': 'Bearer hidden'}


def test_mcp_endpoint_change_requires_explicit_replacement_credential(settings):
    server = {'name': 'docs', 'url': 'https://one.example/mcp',
              'headersEnv': {'Authorization': 'DOCS_TOKEN'}}
    save_settings(settings, {'mcp': {'servers': [server], 'credentials': {'DOCS_TOKEN': 'hidden'}}})
    with pytest.raises(ValueError, match='认证'):
        save_settings(settings, {'mcp': {'servers': [{**server, 'url': 'https://two.example/mcp'}]}})
    with pytest.raises(ValueError, match='认证'):
        save_settings(settings, {'mcp': {'servers': [{**server, 'name': 'renamed', 'url': 'https://two.example/mcp'}]}})


def test_invalid_saved_mcp_errors_do_not_echo_secret_input(settings):
    path = Path(settings.coder_settings_path)
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({'mcpServers': {'bad': {'url': 'https://example.com?token=private-secret'}}}))
    with pytest.raises(ValueError) as error:
        read_public_settings(settings)
    assert 'private-secret' not in str(error.value)


def test_invalid_update_is_atomic_and_cannot_inject_runtime_settings(settings):
    save_settings(settings, {'models': {'primary': {'model': 'kept'}}})
    before = Path(settings.coder_settings_path).read_text()
    with pytest.raises(ValueError):
        save_settings(settings, {'coder_sandbox_enabled': False})
    assert Path(settings.coder_settings_path).read_text() == before


def test_rejects_settings_inside_editable_project(settings):
    settings.coder_settings_path = str(Path(settings.webapp_workdir) / 'settings.json')
    with pytest.raises(ValueError, match='工作区'):
        read_public_settings(settings)


def test_clear_inherited_key_is_effective_and_vision_output_limit_applies(settings):
    result = save_settings(settings, {'models': {'primary': {'clearApiKey': True},
                                                'vision': {'maxOutputTokens': 1024}}})
    assert result['models']['primary']['apiKeyConfigured'] is False
    assert result['models']['vision']['maxOutputTokens'] == 1024
    assert apply_operator_settings(settings).coder_vision_max_output_tokens == 1024


def test_saving_current_endpoint_with_blank_key_keeps_inherited_authentication(settings):
    current = read_public_settings(settings)['models']['primary']
    result = save_settings(settings, {'models': {'primary': {
        'model': current['model'], 'baseUrl': current['baseUrl'], 'apiKey': ''}}})
    assert result['models']['primary']['apiKeyConfigured'] is True


def test_vision_connection_sends_decodable_sized_png(settings, httpx_mock):
    import base64
    import struct
    import zlib
    from agent_core.operator_settings import test_connection
    save_settings(settings, {'models': {'vision': {
        'model': 'vision-model', 'baseUrl': 'https://vision.example/v1',
        'apiKey': 'private-vision-key', 'supportsImages': True}}})
    httpx_mock.add_response(json={'choices': [{'message': {'content': 'blue'}}]})
    assert test_connection(settings, 'vision')['ok'] is True
    request = json.loads(httpx_mock.get_request().content)
    image = request['messages'][0]['content'][1]['image_url']['url']
    data = base64.b64decode(image.split(',', 1)[1])
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    width, height = struct.unpack('!II', data[16:24])
    assert width >= 32 and height >= 32
    index = 8
    while index < len(data):
        length = struct.unpack('!I', data[index:index + 4])[0]
        chunk = data[index + 4:index + 8 + length]
        crc = struct.unpack('!I', data[index + 8 + length:index + 12 + length])[0]
        assert crc == zlib.crc32(chunk) & 0xffffffff
        index += length + 12


def test_model_error_message_explains_unopened_model_without_echoing_provider_secrets(settings, httpx_mock):
    from agent_core.operator_settings import test_connection
    save_settings(settings, {'models': {'vision': {
        'model': 'vision-model', 'baseUrl': 'https://vision.example/v1',
        'apiKey': 'private-vision-key', 'supportsImages': True}}})
    httpx_mock.add_response(status_code=404, json={'error': {
        'code': 'ModelNotOpen', 'message': 'model unavailable private-vision-key OTHER_PROVIDER_SECRET'}})
    result = test_connection(settings, 'vision')
    assert result['ok'] is False and '未开通' in result['message']
    assert 'private-vision-key' not in json.dumps(result) and 'OTHER_PROVIDER_SECRET' not in json.dumps(result)


def test_saved_model_values_use_validated_types_and_preserve_explicit_key_clear(settings):
    from agent_core.operator_settings import apply_operator_settings
    path = Path(settings.coder_settings_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({'models': {'vision': {
        'supportsImages': 'false', 'contextWindow': '4096', 'apiKey': None}}}), encoding='utf-8')
    effective = apply_operator_settings(settings)
    assert effective.coder_vision_supports_images is False
    assert effective.coder_vision_context_window == 4096
    assert effective.coder_vision_api_key is None
    assert effective.coder_vision_api_key_env is None


def test_vision_test_does_not_claim_success_for_reasoning_only_response(settings, httpx_mock):
    from agent_core.operator_settings import test_connection
    save_settings(settings, {'models': {'vision': {
        'model': 'vision-model', 'baseUrl': 'https://vision.example/v1',
        'apiKey': 'private-vision-key', 'supportsImages': True}}})
    httpx_mock.add_response(json={'choices': [{'message': {'content': None, 'reasoning_content': 'private'}}]})
    result = test_connection(settings, 'vision')
    assert result['ok'] is False
    assert '可见' in result['message'] and 'private' not in json.dumps(result)


@pytest.mark.parametrize('trust_env', [False, True])
def test_model_smoke_test_uses_same_proxy_policy_as_runtime(settings, httpx_mock, monkeypatch, trust_env):
    import httpx
    from agent_core.operator_settings import test_connection
    configured = settings.model_copy(update={'model_trust_env': trust_env})
    seen = []
    original = httpx.Client.__init__
    def capture(client, *args, **kwargs):
        seen.append(kwargs.get('trust_env'))
        original(client, *args, **kwargs)
    monkeypatch.setattr(httpx.Client, '__init__', capture)
    httpx_mock.add_response(json={'choices': [{'message': {'content': 'OK'}}]})
    assert test_connection(configured, 'primary')['ok'] is True
    assert seen == [trust_env]
