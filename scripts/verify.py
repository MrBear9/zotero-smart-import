import zipfile, json, os, sys

p = r'E:\Xiongwq\RobotChat\zotero-smart-import\dist\smartimport-1.0.0.xpi'
z = zipfile.ZipFile(p)

print('=== 包内结构 ===')
for n in z.namelist():
    print('  %s  (%d B)' % (n, z.getinfo(n).file_size))

print()
print('=== zip 完整性 ===', 'OK' if z.testzip() is None else 'BAD')

m = json.loads(z.read('manifest.json'))
print()
print('=== manifest ===')
print(json.dumps(m, ensure_ascii=False, indent=2))

zot = m.get('applications', {}).get('zotero', {})
print()
print('=== 必需字段 ===')
for k in ('id', 'update_url', 'strict_max_version'):
    val = zot.get(k)
    status = 'OK' if val else 'MISSING'
    print('  %-20s %-8s %s' % (k, status, val or ''))

print()
print('=== 图标 ===')
for sz, path in m.get('icons', {}).items():
    status = 'OK' if path in z.namelist() else 'MISSING'
    print('  %-4s %-8s %s' % (sz, status, path))

bs = z.read('bootstrap.js').decode('utf-8')
print()
print('=== bootstrap 检查 ===')
for kw in ['this.install', 'this.uninstall', 'this.startup', 'this.shutdown',
           'Zotero.Notifier', 'MenuManager', 'findDuplicateGroups']:
    status = 'OK' if kw in bs else 'MISSING'
    print('  %-25s %s' % (kw, status))

has_import = any(line.strip().startswith('import ') for line in bs.split('\n'))
print('  残留 import: %s' % ('YES-PROBLEM' if has_import else 'NO-OK'))
