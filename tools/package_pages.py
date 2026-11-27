"""Pack the built review site for the Pages dashboard, preserving legacy lesson URLs."""
import argparse
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import unquote
from zipfile import ZIP_DEFLATED, ZipFile

from build import MARKER, ROOT, SITE_FILES, topic_address


def collect(site):
    if not (site / MARKER).is_file():
        raise ValueError('请选择 build.py 生成的教材目录')
    files, redirects = set(), {}
    figures = {p.relative_to(ROOT) for p in (ROOT / 'chapters').rglob('*')
               if p.suffix.lower() in {'.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp'}}
    for prefix in (Path(), Path('adult')):
        files.update(prefix / p for p in [*SITE_FILES, *figures, 'chapters/index.html', 'content/map.json'])
        atlas = json.loads((site / prefix / 'content/map.json').read_text())
        for world in atlas['views']:
            if world['id'] == 'overview':
                continue
            files.add(prefix / unquote(world['overviewPage']))
            for node in world['nodes']:
                lesson = Path(unquote(node['readingPage']))
                files.add(prefix / lesson)
                alias = topic_address(world['id'], node['id'])
                if not prefix.parts and alias != lesson and (site / alias).is_file():
                    redirects[Path(alias)] = '/' + node['readingPage'].removesuffix('.html')
    built = {p.relative_to(site) for p in site.rglob('*') if p.is_file()}
    expected = files | set(redirects) | {Path(MARKER), Path('.nojekyll')}
    if built != expected:
        raise ValueError(f'构建目录与教材目录不符：{sorted(built ^ expected)[:6]}')
    rules = [f'/{source} {target} 301' for path, target in sorted(redirects.items())
             for source in (path.as_posix(), path.with_suffix('').as_posix())]
    if len(rules) > 2000 or len(files) + 1 > 1000:
        raise ValueError('文件或跳转数量超出 Pages 网页上传限制')
    return files, '\n'.join(rules) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('site', type=Path)
    parser.add_argument('zip', type=Path, nargs='?', help='省略时仅核对')
    args = parser.parse_args()
    files, rules = collect(args.site)
    if args.zip:
        with NamedTemporaryFile(dir=args.zip.parent, suffix='.zip', delete=False) as tmp:
            staging = Path(tmp.name)
        try:
            with ZipFile(staging, 'w', ZIP_DEFLATED) as archive:
                for path in sorted(files):
                    archive.write(args.site / path, path.as_posix())
                archive.writestr('_redirects', rules)
            with ZipFile(staging) as archive:
                if archive.testzip() is not None:
                    raise ValueError('压缩包校验失败')
            os.replace(staging, args.zip)
        finally:
            staging.unlink(missing_ok=True)
    print(f'{len(files)+1} 个公开文件（含旧书签的 {len(rules.splitlines())} 条跳转）')


if __name__ == '__main__':
    main()
