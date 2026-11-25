"""Build the student edition from the public map and chapter sources."""
import argparse
from collections import defaultdict
from graphlib import TopologicalSorter
from html import escape
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import os
import shutil
import subprocess
import tempfile
from urllib.parse import quote, unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
SITE_FILES = ('index.html', 'app.js', 'style.css', 'chapter.css', 'ocean.css',
              'ocean-layout.js', 'learning-view.css', 'learning-view.js', 'learning-graph.js')
RELATIONS = {'prerequisite', 'perspective', 'route'}
MARKER = '.math-textbook-build'


def unique(items, label):
    seen = set()
    for item in items:
        if not isinstance(item, str) or not item or item in seen:
            raise ValueError(f'{label} 名称为空或重复：{item!r}')
        seen.add(item)
    return seen


def chapter_sources(atlas):
    """Check references and collect a chapter's routes back into the map."""
    views = atlas['views']
    world_ids = unique((v['id'] for v in views), '板块')
    nodes = {v['id']: unique((n['id'] for n in v['nodes']), v['id']) for v in views}
    overview = next(v for v in views if v['id'] == 'overview')
    if unique((n['target'] for n in overview['nodes']), '总览板块') != world_ids - {'overview'}:
        raise ValueError('板块目录与总览不一致')
    dependencies = TopologicalSorter()
    chapters = defaultdict(list)

    def check_endpoint(world, node):
        if node not in nodes.get(world, ()):
            raise ValueError(f'未知知识点 {world}/{node}')
        return world, node

    def connection(kind, source, target):
        if kind not in RELATIONS or source == target:
            raise ValueError(f'无效联系 {source} → {target} ({kind})')
        if kind == 'prerequisite':
            dependencies.add(target, source)

    for view in views:
        world = view['id']
        if not view['title'].strip():
            raise ValueError(f'{world} 缺少标题')
        for node in view['nodes']:
            if not node['label'].strip() or type(node['level']) is not int or node['level'] < 0:
                raise ValueError(f'{world}/{node["id"]} 缺少有效的名称或层级')
            if 'chapter' in node:
                path = PurePosixPath(node['chapter'])
                if path.parts[:1] != ('chapters',) or '..' in path.parts or path.suffix != '.md':
                    raise ValueError(f'无效章节路径 {path}')
                chapters[path].append((world, node['id'], node['label']))
        for edge in view['edges']:
            connection(edge['kind'], check_endpoint(world, edge['source']), check_endpoint(world, edge['target']))
    for edge in atlas.get('crossEdges', []):
        source, target = edge['source'], edge['target']
        connection(edge['kind'], check_endpoint(source['view'], source['node']),
                   check_endpoint(target['view'], target['node']))
    dependencies.prepare()
    references = [step for route in atlas.get('olympiadReading', {}).values() for step in route['steps']]
    checklist = atlas.get('olympiadChecklist', {})
    references.extend(step for group in checklist.get('groups', {}).values() for step in group)
    references.extend(checklist.get('shortlist', []))
    for step in references:
        check_endpoint(step['world'], step['node'])
    return chapters


def page(title, body, root):
    return f'''<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self' https:; base-uri 'none'; form-action 'none'">
<title>{escape(title)} · 数学地图</title>
<link rel="stylesheet" href="{root}style.css"><link rel="stylesheet" href="{root}chapter.css">
</head>
<body class="chapter-page"><header class="chapter-header"><a class="brand" href="{root}index.html"><span class="brand-mark" aria-hidden="true"><i></i></span>数学地图</a><a href="{root}chapters/index.html">教材目录</a></header>
<main class="chapter">{body}</main></body></html>
'''


def chapter_directory(atlas, titles):
    jump_links = []
    sections = []
    for world in atlas['views']:
        paths = dict.fromkeys(PurePosixPath(node['chapter'])
                              for node in sorted(world['nodes'], key=lambda node: node['level'])
                              if 'chapter' in node)
        if not paths:
            continue
        heading = escape(world['title'])
        anchor = 'world-' + world['id']
        jump_links.append(f'<a href="#{quote(anchor, safe="")}">{heading}</a>')
        entries = []
        for path in paths:
            link = quote(path.relative_to('chapters').with_suffix('.html').as_posix())
            entries.append(f'<li><a href="{link}">{escape(titles[path])}</a></li>')
        sections.append(f'<section><h2 id="{escape(anchor)}">{heading}</h2>'
                        f'<ul class="chapter-directory">{"".join(entries)}</ul></section>')
    return ('<h1>教材正文</h1><nav aria-label="按板块查阅">'
            + ' · '.join(jump_links) + '</nav>' + ''.join(sections))


class ChapterLinks(HTMLParser):
    def __init__(self, document, site):
        super().__init__()
        self.document, self.site = document, site

    def handle_starttag(self, tag, attrs):
        attribute = 'href' if tag == 'a' else 'src' if tag == 'img' else None
        target = dict(attrs).get(attribute)
        if not target:
            return
        link = urlsplit(target)
        if link.scheme or link.netloc or not link.path:
            return
        relative = unquote(link.path)
        dest = (self.document.parent / relative).resolve()
        if relative.startswith('/') or self.site not in dest.parents or not dest.is_file():
            raise ValueError(f'{self.document.name} 中的链接无法打开：{target}')


def build(stage):
    atlas_path = ROOT / 'content/map.json'
    atlas = json.loads(atlas_path.read_text(encoding='utf-8'))
    chapters = chapter_sources(atlas)
    sources = {PurePosixPath(p.relative_to(ROOT).as_posix()) for p in (ROOT / 'chapters').rglob('*.md')}
    if sources != chapters.keys():
        mismatch = ', '.join(str(p) for p in sorted(sources.symmetric_difference(chapters)))
        raise ValueError(f'章节文件与地图的 chapter 引用不一致：{mismatch}')
    for name in SITE_FILES:
        shutil.copyfile(ROOT / 'site' / name, stage / name)
    (stage / 'content').mkdir()
    shutil.copyfile(atlas_path, stage / 'content/map.json')
    (stage / 'chapters').mkdir()
    for image in (ROOT / 'chapters').rglob('*'):
        if image.is_symlink():
            raise ValueError(f'教材正文或插图不能引用符号链接：{image.relative_to(ROOT)}')
        if image.is_file() and image.suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'}:
            destination = stage / image.relative_to(ROOT)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(image, destination)

    if not shutil.which('pandoc'):
        raise RuntimeError('请先安装 Pandoc 并确认 pandoc 命令在 PATH 中。')
    titles = {}
    for source, topics in chapters.items():
        text = (ROOT / source).read_text(encoding='utf-8')
        first = next((line for line in text.splitlines() if line.strip()), '')
        if not first.startswith('# '):
            raise ValueError(f'{source} 请用一级标题开篇')
        title = first[2:].strip()
        titles[source] = title
        filename = source.with_suffix('.html')
        output = stage / filename
        root = '../' * (len(filename.parts) - 1)
        chapter = subprocess.run(
            ['pandoc', '--from=gfm+tex_math_dollars', '--to=html5', '--mathml', '--wrap=none',
             '--fail-if-warnings', '--lua-filter', str(ROOT / 'tools/chapter-links.lua')],
            input=text, text=True, encoding='utf-8',
            stdout=subprocess.PIPE, check=True,
        ).stdout
        back = ''.join(f'<a href="{root}index.html#topic/{quote(w, safe="")}/{quote(n, safe="")}">'
                       f'{escape(label)}</a>' for w, n, label in topics)
        body = f'<article>{chapter}</article><nav class="map-return" aria-label="知识地图">地图中的知识点 {back}</nav>'
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(page(title, body, root), encoding='utf-8')
    index = chapter_directory(atlas, titles)
    (stage / 'chapters/index.html').write_text(page('教材正文', index, '../'), encoding='utf-8')
    for document in (stage / 'chapters').rglob('*.html'):
        ChapterLinks(document, stage).feed(document.read_text(encoding='utf-8'))
    (stage / '.nojekyll').touch()
    (stage / MARKER).touch()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '_site')
    dest = parser.parse_args().output.resolve()
    if dest.exists() and (not dest.is_dir() or (any(dest.iterdir()) and not (dest / MARKER).is_file())):
        parser.error('输出目录已有其他文件，请选择空目录。')
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=dest.parent) as temporary:
        stage = Path(temporary) / 'site'
        stage.mkdir()
        build(stage)
        previous = Path(temporary) / 'previous'
        if dest.exists():
            os.replace(dest, previous)
        try:
            os.replace(stage, dest)
        except OSError:
            if previous.exists():
                os.replace(previous, dest)
            raise
    print(f'学生站已生成到 {dest}')


if __name__ == '__main__':
    main()
