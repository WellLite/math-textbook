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
              'ocean-layout.js', 'learning-view.css', 'learning-view.js', 'learning-graph.js', 'reader.js')
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


def page(title, body, root, directory=False):
    reading_tools = '' if directory else '<button id="large-type" type="button" aria-pressed="false" hidden>大字阅读</button>'
    page_class = 'directory' if directory else 'chapter'
    return f'''<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' https:; base-uri 'none'; form-action 'none'">
<title>{escape(title)} · 数学地图</title>
<link rel="stylesheet" href="{root}style.css"><link rel="stylesheet" href="{root}chapter.css"><script src="{root}reader.js" defer></script>
</head>
<body class="chapter-page"><a class="skip-reading" href="#reading">跳到正文</a><header class="chapter-header"><a class="brand" href="{root}index.html"><span class="brand-mark" aria-hidden="true"><i></i></span>数学地图</a><nav aria-label="阅读导航">{reading_tools}<a href="{root}chapters/index.html">教材目录</a></nav></header>
<main class="{page_class}" id="reading">{body}</main></body></html>
'''


def chapter_directory(atlas, titles):
    jump_links = []
    sections = []
    for world in atlas['views']:
        paths = {}
        for node in sorted(world['nodes'], key=lambda node: node['level']):
            if 'chapter' in node:
                paths.setdefault(PurePosixPath(node['chapter']), node['label'])
        if not paths:
            continue
        heading = escape(world['title'])
        anchor = 'world-' + world['id']
        jump_links.append(f'<a href="#{quote(anchor, safe="")}">{heading}</a>')
        entries = []
        for path, label in paths.items():
            link = quote(path.relative_to('chapters').with_suffix('.html').as_posix())
            title = titles[path]
            topic = '' if title == label else f'<small>{escape(label)}</small>'
            entries.append(f'<li><a href="{link}">{topic}<span>{escape(title)}</span></a></li>')
        sections.append(f'<section class="directory-section"><h2 id="{escape(anchor)}">{heading}</h2>'
                        f'<ul class="chapter-directory">{"".join(entries)}</ul></section>')
    return (f'<header class="directory-heading"><div><h1>教材目录</h1><p>{len(titles)} 篇正文</p></div>'
            '<a class="resume-link" data-resume-reading hidden></a></header>'
            '<div class="directory-find" hidden><label for="find-lesson">找一篇课文</label>'
            '<input type="search" id="find-lesson" placeholder="输入知识点或题目中的词">'
            '<span id="found-lessons" role="status"></span></div>'
            '<div class="directory-layout"><nav aria-label="按板块查阅">'
            + ''.join(jump_links) + '</nav><div>' + ''.join(sections) + '</div></div>')


def related_reading(worlds, topics, source):
    """Offer available lessons connected by real outgoing learning edges."""
    links = {}
    for world_id, node_id, _ in topics:
        world = worlds[world_id]
        targets = {edge['target']: edge.get('label', '') for edge in world['edges']
                   if edge['source'] == node_id and edge['kind'] in {'route', 'prerequisite'}}
        for node in world['nodes']:
            if node['id'] in targets and node.get('chapter') and node['chapter'] != str(source):
                links.setdefault(node['chapter'], (node['label'], targets[node['id']]))
    if not links:
        return ''
    entries = []
    for path, (label, connection) in links.items():
        href = quote(os.path.relpath(PurePosixPath(path).with_suffix('.html'), source.parent))
        why = f'<small>{escape(connection)}</small>' if connection and connection != label else ''
        entries.append(f'<a href="{href}"><span>{escape(label)} <span aria-hidden="true">→</span></span>{why}</a>')
    return '<nav class="next-reading" aria-label="接着读"><h2>接着读</h2>' + ''.join(entries) + '</nav>'


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
    worlds = {view['id']: view for view in atlas['views']}
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
        world_id = topics[0][0]
        collection = escape(worlds[world_id]['title'])
        crumb = f'<a href="{root}chapters/index.html#world-{quote(world_id, safe="")}">{collection}</a>'
        topic = escape(topics[0][2])
        context = (f'<p class="reading-context">{crumb}<span aria-hidden="true">/</span>'
                   f'<span data-reading-topic>{topic}</span></p>')
        body = (f'{context}<article>{chapter}</article><footer class="reading-end">'
                + related_reading(worlds, topics, source)
                + f'<nav class="map-return" aria-label="返回导航">在地图中查看 {back}'
                  f'<a class="directory-return" href="{root}chapters/index.html#world-{quote(world_id, safe="")}">返回本板块目录</a></nav></footer>')
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(page(title, body, root), encoding='utf-8')
    index = chapter_directory(atlas, titles)
    (stage / 'chapters/index.html').write_text(page('教材目录', index, '../', directory=True), encoding='utf-8')
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
