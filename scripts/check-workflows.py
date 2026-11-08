import yaml
import sys
import os

base = r'E:\Xiongwq\RobotChat\zotero-smart-import\.github\workflows'

for name in os.listdir(base):
    if not name.endswith(('.yml', '.yaml')):
        continue
    path = os.path.join(base, name)
    print('=== %s ===' % name)
    try:
        with open(path, encoding='utf-8') as f:
            data = yaml.safe_load(f)
        print('  解析: OK')
        print('  keys:', list(data.keys()))

        # 检查 on
        on = data.get('on') or data.get(True)
        print('  on:', on)

        jobs = data.get('jobs', {})
        print('  jobs:', list(jobs.keys()))

        for jn, job in jobs.items():
            steps = job.get('steps', [])
            print('    [%s] %d steps, runs-on=%s' % (jn, len(steps), job.get('runs-on')))
            for i, s in enumerate(steps):
                label = s.get('name') or s.get('uses') or '(unnamed)'
                print('      %d. %s' % (i + 1, label))
    except Exception as e:
        print('  解析失败:', e)
        sys.exit(1)
    print()
