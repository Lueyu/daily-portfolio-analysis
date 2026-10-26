"""Observed browser evidence is scoped to a source revision and task preview."""
from urllib.parse import urlsplit

from .models import CheckKind

BROWSER_ACTIONS = ('navigate', 'snapshot', 'screenshot', 'errors')
INTERACTIONS = {'click', 'fill', 'press', 'select', 'scroll', 'wait_for'}


def _origin(url):
    parsed = urlsplit(url or '')
    return (parsed.scheme, parsed.netloc) if parsed.scheme in {'http', 'https'} and parsed.netloc else None


def begin_browser_action(state, action):
    # Clear first: a failed attempted navigation/interaction must not leave a
    # previous successful screenshot usable as evidence for the new page.
    if action in {'navigate', 'close'}:
        state.pop('browser_verification', None)
    elif action in INTERACTIONS and state.get('browser_verification'):
        evidence = state['browser_verification']
        evidence['actions'] = [name for name in evidence['actions'] if name == 'navigate']
        evidence.pop('artifact_id', None)
        evidence.pop('error_counts', None)


def record_browser_action(state, action, result):
    if state.get('pending'):
        return  # A live source-writing command has not sealed its revision yet.
    revision = state.get('revision')
    evidence = state.get('browser_verification', {})
    url = result.get('url') or evidence.get('url')
    origins = {_origin(service.get('url')) for service in state.get('services', [])
               if service.get('status') == 'running'}
    if _origin(url) is None or _origin(url) not in origins:
        state.pop('browser_verification', None)
        return  # External documentation cannot establish that the user's app works.
    if action == 'navigate':
        evidence = {'revision': revision, 'url': url, 'actions': ['navigate']}
        state['browser_verification'] = evidence
    if evidence.get('revision') != revision or 'navigate' not in evidence.get('actions', []):
        return
    if url != evidence.get('url'):
        evidence.update(url=url, actions=['navigate'])
        evidence.pop('artifact_id', None)
        evidence.pop('error_counts', None)
    if action not in BROWSER_ACTIONS:
        return
    if action == 'screenshot':
        if not result.get('artifact_id'):
            return
        evidence['artifact_id'] = result['artifact_id']
    if action == 'errors':
        evidence['error_counts'] = {name: len(result.get(name, []))
                                    for name in ('pageErrors', 'networkFailures', 'httpErrors')}
    evidence['actions'] = list(dict.fromkeys([*evidence['actions'], action]))


def browser_gaps(task, state):
    required = any(criterion.check == CheckKind.E2E for criterion in task.acceptance)
    evidence = state.get('browser_verification', {})
    current = evidence.get('revision') == state.get('revision') and not evidence.get('invalidated')
    observed = set(evidence.get('actions', [])) if current else set()
    return {'browser_required_actions': [name for name in BROWSER_ACTIONS if name not in observed] if required else [],
            'browser_evidence': evidence if required and current else None}
