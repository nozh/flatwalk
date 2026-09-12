import json
from pathlib import Path
from jsonschema import Draft202012Validator
from validate_contract import validate, SCHEMAS

for schema in SCHEMAS.glob('*.schema.json'):
    Draft202012Validator.check_schema(json.loads(schema.read_text()))
cases = json.loads((Path(__file__).resolve().parents[1] / 'test/corpus.json').read_text())
for case in cases:
    errors = validate(case['kind'], case['value'])
    assert (not errors) == case['valid'], (case['name'], errors)
print(f'Python: {len(cases)} shared cases passed; 4 JSON Schemas valid')

for value in [float('nan'), float('inf'), -float('inf')]:
    assert validate('Patch', {'ops': [{'value': value}]})
print('Python: nonfinite JSON numbers rejected')
