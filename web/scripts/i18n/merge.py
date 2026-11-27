"""Слить тексты из f_*.py в src/messages/{ru,kk}.json (кортеж (ru, kk) → значения)."""
import json, glob, importlib.util, os
here = os.path.dirname(__file__)
root = os.path.join(here, '..', '..', 'src', 'messages')
def split(d, i):
    return {k: (v[i] if isinstance(v, tuple) else split(v, i)) for k, v in d.items()}
def deep(a, b):
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict): deep(a[k], v)
        else: a[k] = v
for lang, i in (('ru', 0), ('kk', 1)):
    p = os.path.join(root, f'{lang}.json'); data = json.load(open(p, encoding='utf-8'))
    for f in sorted(glob.glob(os.path.join(here, 'f_*.py'))):
        spec = importlib.util.spec_from_file_location('m', f); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
        for name in dir(m):
            if name.isupper(): deep(data, split(getattr(m, name), i))
    json.dump(data, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2); open(p, 'a').write('\n')
print('ok')
