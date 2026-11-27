"""Build the student edition from the public map and chapter sources."""
import argparse
from collections import defaultdict
from functools import lru_cache
from graphlib import TopologicalSorter
from hashlib import sha256
from html import escape
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import os
import re
import shutil
import subprocess
import tempfile
from urllib.parse import quote, unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
SITE_FILES = ('index.html', 'app.js', 'style.css', 'chapter.css', 'ocean.css',
              'ocean-layout.js', 'learning-view.css', 'learning-view.js', 'learning-graph.js', 'reader.js',
              'chapter-outline.js', 'outline-graph.css', 'math-figures.js')
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


def feedback_link(review_pr, source=None):
    if not review_pr:
        return ''
    target = f'https://github.com/WellLite/math-textbook/pull/{review_pr}'
    if source is not None:
        digest = sha256(source.as_posix().encode('utf-8')).hexdigest()
        target += f'/files#diff-{digest}'
    return f'<a class="review-link" href="{target}" title="在 GitHub 给审阅稿反馈">给反馈</a>'


def edition_switch(path, adult):
    """Both versions are ordinary documents, including when JavaScript is off."""
    here = PurePosixPath('adult') / path if adult else path
    names = {True: '大朋友版', False: '小朋友版'}
    links = []
    for is_adult, name in names.items():
        if is_adult == adult:
            links.append(f'<span aria-current="page">{name}</span>')
        else:
            target = PurePosixPath('adult') / path if is_adult else path
            href = quote(os.path.relpath(target, here.parent))
            links.append(f'<a href="{href}" data-switch-edition>{name}</a>')
    return '<nav class="reader-editions" aria-label="选择教材版本">' + ''.join(links) + '</nav>'


def edition_source(path, adult):
    alternative = ROOT / 'editions' / 'adult' / path
    return alternative if adult and alternative.is_file() else ROOT / path


def lesson_text(source, adult):
    manuscript = edition_source(source, adult)
    text = manuscript.read_text(encoding='utf-8')
    if manuscript == ROOT / source:
        return text
    # An adult manuscript may link to a figure or lesson in the shared source
    # tree on GitHub. Both editions publish those paths under their own chapters/.
    shared_prefix = os.path.relpath(ROOT / 'chapters', manuscript.parent) + '/'
    published_prefix = os.path.relpath(ROOT / 'chapters', (ROOT / source).parent) + '/'
    return text.replace('](' + shared_prefix, '](' + published_prefix)


def page(title, body, root, directory=False, outline='', pending=False, feedback='', switch=''):
    reading_tools = '' if directory or pending else '<button id="large-type" type="button" aria-pressed="false" hidden>大字阅读</button>'
    page_class = 'directory' if directory else 'chapter'
    main = f'<main class="{page_class}" id="reading" tabindex="-1">{switch}{body}</main>'
    outline_assets = ''
    if outline:
        outline_assets = (f'<link rel="stylesheet" href="{root}outline-graph.css">'
                          f'<script src="{root}learning-graph.js" defer></script><script src="{root}chapter-outline.js" defer></script>')
        main = f'<div class="reading-layout">{outline}{main}</div>'
    diagrams = f'<script src="{root}math-figures.js" defer></script>' if 'id="demo-' in body else ''
    return f'''<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' https:; base-uri 'none'; form-action 'none'">
<title>{escape(title)} · 数学地图</title>
<link rel="stylesheet" href="{root}style.css"><link rel="stylesheet" href="{root}chapter.css">{outline_assets}{diagrams}<script src="{root}reader.js" defer></script>
</head>
<body class="chapter-page{' with-outline' if outline else ''}"><a class="skip-reading" href="#reading">跳到正文</a><header class="chapter-header"><a class="brand" href="{root}index.html"><span class="brand-mark" aria-hidden="true"><i></i></span>数学地图</a><nav aria-label="阅读导航">{reading_tools}<a href="{root}chapters/index.html">教材目录</a>{feedback}</nav></header>
{main}</body></html>
'''


def topic_address(world_id, node_id):
    return PurePosixPath('chapters/_topics', 'world-' + quote(world_id, safe=''),
                         'topic-' + quote(node_id, safe='') + '.html')


def reader_paths(worlds):
    """Keep published chapter URLs and give every point a place in its own outline."""
    paths = {}
    used = set()
    for world in worlds:
        world['overviewPage'] = f'chapters/overviews/{quote(quote(world["id"], safe=""), safe="")}.html'
        for node in world['nodes']:
            world_key, node_key = (quote(key, safe='') for key in (world['id'], node['id']))
            if node.get('chapter'):
                path = PurePosixPath(node['chapter']).with_suffix('.html')
                if path in used:
                    path = path.with_name(f'{path.stem}.outline-{world_key}.{node_key}.html')
            else:
                path = topic_address(world['id'], node['id'])
            if path in used or path == PurePosixPath('chapters/index.html'):
                raise ValueError(f'阅读页面路径冲突：{path}')
            paths[world['id'], node['id']] = path
            node['readingPage'] = quote(path.as_posix())
            used.add(path)
    return paths


def chapter_outline(world, current, path, paths, map_href):
    front = quote(os.path.relpath(unquote(world['overviewPage']), path.parent))
    current_front = ' aria-current="page"' if current is None else ''
    rows = []
    for node in sorted(world['nodes'], key=lambda item: item['level']):
        href = quote(os.path.relpath(paths[world['id'], node['id']], path.parent))
        active = ' aria-current="page"' if node['id'] == current else ''
        pending = '' if node.get('chapter') else ' class="outline-pending"'
        label = escape(node['label'])
        rows.append(f'<li data-topic="{escape(node["id"])}" data-level="{node["level"]}"{pending}>'
                    f'<a href="{href}"{active}><span class="outline-label">{label}</span></a></li>')
    edges = json.dumps(world['edges'], ensure_ascii=False, separators=(',', ':')).replace('<', r'\u003c')
    return ('<aside class="outline-panel" aria-label="章节导航">'
            '<button type="button" class="outline-toggle" aria-controls="chapter-outline" aria-expanded="false" hidden>本章脉络</button>'
            f'<nav id="chapter-outline" aria-label="本章脉络"><h2>{escape(world["title"])}</h2>'
            f'<a class="outline-intro" href="{front}"{current_front} title="本章概览"><span class="outline-label">本章概览</span></a>'
            f'<ol class="outline-topics">{"".join(rows)}</ol>'
            f'<a class="outline-map-link" href="{map_href}">完整关系图</a>'
            f'<script type="application/json" class="outline-edges">{edges}</script></nav></aside>')


def chapter_directory(atlas, titles):
    jump_links = []
    sections = []
    for world in atlas['views']:
        if world['id'] == 'overview':
            continue
        paths = {}
        for node in sorted(world['nodes'], key=lambda node: node['level']):
            if 'chapter' in node:
                paths.setdefault(PurePosixPath(node['chapter']), node['label'])
        heading = escape(world['title'])
        anchor = 'world-' + world['id']
        jump_links.append(f'<a href="#{quote(anchor, safe="")}">{heading}</a>')
        overview_href = escape(world['overviewPage'].removeprefix('chapters/'))
        entries = [f'<li><a href="{overview_href}"><span>本章概览</span></a></li>']
        for path, label in paths.items():
            link = quote(path.relative_to('chapters').with_suffix('.html').as_posix())
            title = titles[path]
            topic = '' if title == label else f'<small>{escape(label)}</small>'
            entries.append(f'<li><a href="{link}">{topic}<span>{escape(title)}</span></a></li>')
        sections.append(f'<section class="directory-section"><h2 id="{escape(anchor)}">{heading}</h2>'
                        f'<ul class="chapter-directory">{"".join(entries)}</ul></section>')
    return (f'<header class="directory-heading"><div><h1>教材目录</h1><p>{len(sections)} 篇章首概览 · {len(titles)} 篇小节正文</p></div>'
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


@lru_cache(maxsize=None)
def render_markdown(text, *, overview=False):
    return subprocess.run(
        ['pandoc', '--from=gfm+tex_math_dollars', '--to=html5', '--mathml', '--wrap=none',
         '--fail-if-warnings', *(['--metadata=chapter-overview:true'] if overview else []),
         '--lua-filter', str(ROOT / 'tools/chapter-links.lua')],
        input=text, text=True, encoding='utf-8', stdout=subprocess.PIPE, check=True,
    ).stdout


def write_overview(stage, world, paths, review_pr, adult):
    source = edition_source(PurePosixPath('overviews', quote(world['id'], safe='') + '.md'), adult)
    path = PurePosixPath(unquote(world['overviewPage']))
    nodes = {n['id']: n for n in world['nodes']}
    text = source.read_text(encoding='utf-8')
    intro, separator, glossary = text.partition('\n## 本章定义\n')
    if not intro.startswith('# ') or not separator or not glossary.strip():
        raise ValueError(f'{source.name} 需要章首导读和本章定义')

    def topic_link(match):
        node = match[1]
        if node not in nodes:
            raise ValueError(f'{source.name} 引用了未知知识点 {node}')
        return '](' + quote(os.path.relpath(paths[world['id'], node], path.parent)) + ')'

    intro_html, glossary_html = (render_markdown(re.sub(r'\]\(topic:([^\s)]+)\)', topic_link, section), overview=True)
                                 for section in (intro, glossary))
    glossary_html = glossary_html.replace('</strong>　', '</strong> ')
    glossary_html = ''.join(f'<section class="definition-group">{part}</section>' if part.startswith('<h3') else part
                            for part in re.split(r'(?=<h3\b)', glossary_html))
    root = '../../'
    title = world['title'] + ' · 本章概览'
    map_href = root + 'index.html'
    starts = sorted(nodes.values(), key=lambda n: n['level'])
    available = sum(bool(n.get('chapter')) for n in starts)
    status = ''
    if available < len(starts):
        status = f'{len(starts)} 个知识点中，{available} 篇小节正文可读' if available else '本章各节正文待写'
        status = f'<p class="overview-status">{status}</p>'
    start_link = ''
    if starts:
        opening = next((n for n in starts if n.get('chapter')), starts[0])
        href = quote(os.path.relpath(paths[world['id'], opening['id']], path.parent))
        verb = '读正文' if opening.get('chapter') else '看知识点'
        start_link = f'<a href="{href}">{verb} · {escape(opening["label"])} →</a>'
        map_href += f'#topic/{quote(world["id"], safe="")}/{quote(starts[0]["id"], safe="")}'
    outline = chapter_outline(world, None, path, paths, map_href)
    body = (f'<p class="reading-context" data-reading-topic>{escape(title)}</p><article class="chapter-overview">{intro_html}'
            f'{status}<nav class="overview-actions" aria-label="本章阅读">{start_link}<a href="#definitions">查本章定义 ↓</a></nav>'
            '<h2 id="definitions">本章定义</h2><div class="definition-find" hidden>'
            '<label for="find-definition">查定义</label><input type="search" id="find-definition" placeholder="输入术语">'
            '<span role="status"></span></div>' + glossary_html + '</article>')
    output = stage / path
    output.parent.mkdir(parents=True, exist_ok=True)
    feedback = feedback_link(review_pr, source.relative_to(ROOT))
    output.write_text(page(title, body, root, outline=outline, feedback=feedback, switch=edition_switch(path, adult)), encoding='utf-8')


def build_edition(stage, review_pr, adult):
    atlas_path = ROOT / 'content/map.json'
    atlas = json.loads(atlas_path.read_text(encoding='utf-8'))
    chapters = chapter_sources(atlas)
    sources = {PurePosixPath(p.relative_to(ROOT).as_posix()) for p in (ROOT / 'chapters').rglob('*.md')}
    if sources != chapters.keys():
        mismatch = ', '.join(str(p) for p in sorted(sources.symmetric_difference(chapters)))
        raise ValueError(f'章节文件与地图的 chapter 引用不一致：{mismatch}')
    for name in SITE_FILES:
        shutil.copyfile(ROOT / 'site' / name, stage / name)
    home = stage / 'index.html'
    home_html = home.read_text(encoding='utf-8').replace('<!-- review-feedback -->', feedback_link(review_pr))
    home_html = home_html.replace('<!-- edition-switch -->', edition_switch(PurePosixPath('index.html'), adult))
    name = '大朋友版' if adult else '小朋友版'
    home.write_text(home_html.replace('数学地图 · 学生视图', '数学地图 · ' + name), encoding='utf-8')
    worlds = {world['id']: world for world in atlas['views'] if world['id'] != 'overview'}
    paths = reader_paths(worlds.values())
    occupied_paths = set(paths.values())
    (stage / 'content').mkdir()
    (stage / 'content/map.json').write_text(json.dumps(atlas, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
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
    articles = {}
    for source in chapters:
        text = lesson_text(source, adult)
        first = next((line for line in text.splitlines() if line.strip()), '')
        if not first.startswith('# '):
            raise ValueError(f'{source} 请用一级标题开篇')
        title = first[2:].strip()
        titles[source] = title
        markup = render_markdown(text)
        for figure in ('matrix-composition', 'cyclic-angles', 'successor-walk', 'vector-addition',
                       'quantifier-balls', 'quantifier-roots'):
            anchor = 'quantifiers' if figure.startswith('quantifier-') else figure
            markup = re.sub(r'<figure>(?=\s*<img src="[^"]*/' + figure + r'\.svg")',
                            f'<figure id="demo-{anchor}">', markup)
        articles[source] = markup
    for world_id, world in worlds.items():
        write_overview(stage, world, paths, review_pr, adult)
        for node in world['nodes']:
            path = paths[world_id, node['id']]
            output = stage / path
            root = '../' * (len(path.parts) - 1)
            map_href = f'{root}index.html#topic/{quote(world_id, safe="")}/{quote(node["id"], safe="")}'
            outline = chapter_outline(world, node['id'], path, paths, map_href)
            label = escape(node['label'])
            source = PurePosixPath(node['chapter']) if node.get('chapter') else None
            if source:
                title = titles[source]
                # A bookmark to a topic created before its lesson was written still opens it.
                bookmark = topic_address(world_id, node['id'])
                if not adult and bookmark != path and bookmark not in occupied_paths:
                    href = escape(quote(os.path.relpath(path, bookmark.parent)), quote=True)
                    alias = stage / bookmark
                    alias.parent.mkdir(parents=True, exist_ok=True)
                    alias.write_text(f'<!doctype html><html lang="zh-CN"><meta charset="utf-8">'
                                     f'<title>{label}</title><meta http-equiv="refresh" content="0;url={href}">'
                                     f'<link rel="canonical" href="{href}"><a href="{href}">阅读{label}</a></html>',
                                     encoding='utf-8')
                body = (f'<p class="reading-context" data-reading-topic>{label}</p><article>{articles[source]}</article>'
                        '<footer class="reading-end">' + related_reading(worlds, chapters[source], source)
                        + f'<nav class="map-return" aria-label="返回导航"><a href="{map_href}">在地图中查看「{label}」</a>'
                          f'<a href="{root}chapters/index.html#world-{quote(world_id, safe="")}">返回本板块目录</a></nav></footer>')
            else:
                title = node['label']
                description = f'<p>{escape(node["description"])}</p>' if node.get('description') else ''
                body = (f'<article class="topic-pending"><h1>{label}</h1>{description}<p>本节正文尚未写成。</p></article>'
                        f'<footer class="reading-end"><nav class="map-return" aria-label="返回导航">'
                        f'<a href="{map_href}">查看「{label}」的知识联系</a></nav></footer>')
            output.parent.mkdir(parents=True, exist_ok=True)
            feedback = feedback_link(review_pr, edition_source(source, adult).relative_to(ROOT) if source else None)
            output.write_text(page(title, body, root, outline=outline, pending=not node.get('chapter'), feedback=feedback, switch=edition_switch(path, adult)), encoding='utf-8')
    index = chapter_directory(atlas, titles)
    (stage / 'chapters/index.html').write_text(page('教材目录', index, '../', directory=True, feedback=feedback_link(review_pr), switch=edition_switch(PurePosixPath('chapters/index.html'), adult)), encoding='utf-8')
    # Browsers can retain yesterday's map scripts or data when a reader reopens the book.
    assets = {name: sha256((stage / name).read_bytes()).hexdigest()[:12]
              for name in (*SITE_FILES, 'content/map.json') if not name.endswith('.html')}
    asset_ref = re.compile(r'((?:<script src|<link rel="stylesheet" href|data-map-source)="(?:\.\./)*)([^"]+)(")')
    for document in stage.rglob('*.html'):
        markup = document.read_text(encoding='utf-8')
        markup = asset_ref.sub(lambda m: f'{m[1]}{m[2]}?v={assets[m[2]]}{m[3]}', markup)
        document.write_text(markup, encoding='utf-8')


def build(stage, review_pr=None):
    for path in (ROOT / 'editions/adult').rglob('*.md'):
        relative = path.relative_to(ROOT / 'editions/adult')
        if relative.parts[0] not in ('chapters', 'overviews') or not (ROOT / relative).is_file():
            raise ValueError(f'大朋友版稿件缺少对应章节：{relative}')
    build_edition(stage, review_pr, adult=False)
    (stage / 'adult').mkdir()
    build_edition(stage / 'adult', review_pr, adult=True)
    for document in stage.rglob('*.html'):
        ChapterLinks(document, stage).feed(document.read_text(encoding='utf-8'))
    (stage / '.nojekyll').touch()
    (stage / MARKER).touch()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '_site')
    parser.add_argument('--review-pr', type=int, metavar='NUMBER', help='在审阅站显示进入指定 GitHub PR 的反馈链接')
    args = parser.parse_args()
    if args.review_pr is not None and args.review_pr < 1:
        parser.error('审阅 PR 编号应当为正整数。')
    dest = args.output.resolve()
    if dest.exists() and (not dest.is_dir() or (any(dest.iterdir()) and not (dest / MARKER).is_file())):
        parser.error('输出目录已有其他文件，请选择空目录。')
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=dest.parent) as temporary:
        stage = Path(temporary) / 'site'
        stage.mkdir()
        build(stage, args.review_pr)
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
