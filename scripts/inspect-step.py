import yaml
import os

path = r'E:\Xiongwq\RobotChat\zotero-smart-import\.github\workflows\release.yml'

with open(path, encoding='utf-8') as f:
    data = yaml.safe_load(f)

steps = data['jobs']['release']['steps']
for i, s in enumerate(steps):
    name = s.get('name', '(unnamed)')
    if 'update.json' in name:
        print('=== step %d: %s ===' % (i + 1, name))
        run = s['run']
        print('--- run 脚本原文 ---')
        print(repr(run[:400]))
        print()
        print('--- 可读形式 ---')
        for lineno, line in enumerate(run.split('\n'), 1):
            print('%3d | %s' % (lineno, line))
        print()
        # 检查关键点
        print('--- 检查 ---')
        print('含 CRLF:', '\r' in run)
        print('含 heredoc 开始:', '<<EOF' in run)
        print('含 heredoc 结束:', '\nEOF' in run or run.endswith('EOF'))
        # 找 EOF 结束位置
        lines = run.split('\n')
        print('总行数:', len(lines))
        print('最后 3 行:', [repr(x) for x in lines[-3:]])
