"""Throwaway, measure/727 only: the fixture folder of #727 under sys.argv[1].

docs/index.md links to every case of the step zero, one link per paragraph,
each link text a label; the targets that exist are written beside it.
"""
import os
import sys

root = sys.argv[1]
CASES = [
    ('dot-a', './a.md'),
    ('a', 'a.md'),
    ('up-c', '../b/c.md'),
    ('space', 'a%20b.md'),
    ('anchor-in', 'a.md#h'),
    ('anchor', '#h'),
    ('query', 'a.md?x=1'),
    ('rooted', '/a.md'),
    ('folder', 'sub/'),
    ('missing', 'missing.md'),
    ('pdf', 'x.pdf'),
    ('svg', 'x.svg'),
    ('unc', '\\\\\\\\host\\\\x.pdf'),
    ('slashes', '//host/x.pdf'),
    ('mixed', '/\\\\host/x.pdf'),
    ('drive', 'C:/x.pdf'),
    ('file', 'file:///x.pdf'),
]
files = {
    'docs/index.md': '# Links\n\n' + ''.join(f'[{label}]({dest})\n\n' for label, dest in CASES),
    'docs/a.md': '# A\n\nThe file a.md. [back](index.md)\n',
    'docs/a b.md': '# A B\n\nThe file with a space in its name.\n',
    'b/c.md': '# C\n\nThe file b/c.md, one folder up and across.\n',
    'docs/sub/inside.md': '# Inside\n\nA file inside the folder sub.\n',
    'docs/x.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>\n',
}
for rel, text in files.items():
    path = os.path.join(root, *rel.split('/'))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
pdf = b'%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n'
with open(os.path.join(root, 'docs', 'x.pdf'), 'wb') as f:
    f.write(pdf)
print('\n'.join(label for label, _ in CASES))
