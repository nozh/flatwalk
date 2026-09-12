"""Contract transport validator. No parser, geometry or patch application here.

Requires jsonschema==4.25.1. JSON Schema + generated portable rules are one unit.
"""
import json
import math
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

SCHEMAS = Path(__file__).resolve().parents[1] / 'schemas'
MISSING = object()


def read(root, path):
    value = root
    for key in path.split('.'):
        if not isinstance(value, dict) or key not in value:
            return MISSING
        value = value[key]
    return value


def present(value):
    return value is not MISSING and value is not None


def expand(root, parts, prefix=()):
    if not parts or not isinstance(root, dict):
        return
    part, *tail = parts
    for key in root if part == '*' else [part]:
        value = root.get(key, MISSING)
        if tail:
            yield from expand(value, tail, prefix + (key,))
        else:
            yield prefix + (key,), value, root


def validate(kind, value):
    """Return path-bearing errors. Empty means contract-valid, never walk-ready."""
    def nonfinite(item):
        if isinstance(item, float):
            return not math.isfinite(item)
        if isinstance(item, dict):
            return any(nonfinite(v) for v in item.values())
        if isinstance(item, list):
            return any(nonfinite(v) for v in item)
        return False
    if nonfinite(value):
        return [{'path': [], 'message': 'Nonfinite values are not JSON numbers'}]
    schema = json.loads((SCHEMAS / f'{kind}.schema.json').read_text())
    errors = [{'path': list(e.absolute_path), 'message': e.message}
              for e in Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(value)]
    if errors:
        return errors
    rules = json.loads((SCHEMAS / 'semantic-rules.json').read_text())
    def fail(path, message):
        errors.append({'path': list(path), 'message': message})
    if kind == 'FlatModel':
        for rule in rules['modelRules']:
            for path, item, parent in expand(value, rule['path'].split('.')):
                if not present(item):
                    continue
                when = rule.get('when')
                if when:
                    test = read(parent, when['path'])
                    if 'equals' in when and test != when['equals']:
                        continue
                    if 'present' in when and present(test) != when['present']:
                        continue
                target = read(value, rule['target'][2:]) if rule['target'].startswith('$.') else read(parent, rule['target'])
                if rule['kind'] == 'reference':
                    referred = target.get(item, MISSING) if isinstance(target, dict) and isinstance(item, str) else MISSING
                    valid = referred is not MISSING and ('assetKinds' not in rule or isinstance(referred, dict) and referred.get('kind') in rule['assetKinds'])
                else:
                    valid = present(target) if rule['kind'] == 'requires' else not present(target)
                if not valid:
                    fail(path, f"{rule['kind']}: {rule['target']}")
        for path, dressing, _ in expand(value, ['rooms', '*', 'dressing']):
            if not isinstance(dressing, dict):
                continue
            for field in rules['dressingMetaPairs']:
                if (field in dressing) != (field in dressing['meta']):
                    fail(path + ('meta', field), 'Value and metadata must occur together')
    elif kind == 'ValidationReport':
        assert rules['reportRules'] == ['unique-checkIds', 'unique-reviewIds', 'fix-target']
        ids = [x['checkId'] for x in value['checks']]
        if len(set(ids)) != len(ids):
            fail(['checks'], 'Duplicate checkId')
        ids = [x['id'] for x in value['review']['items']]
        if len(set(ids)) != len(ids):
            fail(['review', 'items'], 'Duplicate review id')
        for i, check in enumerate(value['checks']):
            fix = check.get('fix')
            if fix and (fix['modelId'] != value['modelId'] or fix['baseRevision'] != value['revision']):
                fail(['checks', i, 'fix'], 'Fix must target this model and revision')
    elif kind == 'RevisionContext':
        assert rules['revisionRules'] == ['complete-ordered-history']
        expected_count = value['currentRevision'] - value['baseRevision']
        if expected_count < 0 or len(value['changes']) != expected_count or any(
                c['revision'] != value['baseRevision'] + i + 1 for i, c in enumerate(value['changes'])):
            fail(['changes'], 'Complete ordered revision history required')
    return errors
