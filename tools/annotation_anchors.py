"""Attach review threads to manuscript blocks without changing their HTML content."""
from collections import Counter
from hashlib import sha256
from html import unescape
from html.parser import HTMLParser
import re


class ReviewBlocks(HTMLParser):
    void = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
            'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self, html, definitions):
        super().__init__()
        self.html = html
        self.definitions = definitions
        self.lines = [0, *(m.end() for m in re.finditer('\n', html))]
        self.depth = 0
        self.block = None
        self.repeats = Counter()
        self.insertions = []

    def source_position(self):
        line, column = self.getpos()
        return self.lines[line - 1] + column

    def handle_starttag(self, tag, attrs):
        if tag in self.void:
            return
        self.depth += 1
        if self.block is not None:
            return
        classes = dict(attrs).get('class', '').split()
        if tag in {'p', 'li', 'pre', 'figure'} or (tag == 'div' and
                {'equation-block', 'table-scroll'}.intersection(classes)):
            self.block = self.depth, tag, self.source_position(), len(self.get_starttag_text())

    def handle_endtag(self, tag):
        if tag in self.void:
            return
        if self.block and self.block[0] == self.depth:
            _, kind, start, opening = self.block
            body = self.html[start + opening:self.source_position()]
            # A named definition or an illustration can keep its thread through a rewrite.
            term = re.match(r'\s*(?:<p>)?<strong>(.*?)</strong>', body, re.S) if self.definitions else None
            image = re.search(r'<img\b[^>]*?\bsrc="([^"]+)"', body) if kind == 'figure' else None
            if term:
                body = term[1]
            elif image:
                body = image[1]
            # Prefer the author’s TeX to a renderer-specific presentation tree.
            body = re.sub(r'<math\b[^>]*>.*?<annotation encoding="application/x-tex">(.*?)</annotation>.*?</math>',
                          r'\1', body, flags=re.S)
            text = ' '.join(unescape(re.sub(r'<[^>]+>', '', body)).split())
            if text:
                digest = sha256((kind + '\n' + text).encode()).hexdigest()[:16]
                self.repeats[digest] += 1
                suffix = '' if self.repeats[digest] == 1 else '-' + str(self.repeats[digest])
                self.insertions.append((start + opening - 1, f' data-note-anchor="n-{digest}{suffix}"'))
            self.block = None
        self.depth -= 1


def mark_blocks(html, *, definitions=False):
    parser = ReviewBlocks(html, definitions)
    parser.feed(html)
    parser.close()
    parts = []
    previous = 0
    for position, attribute in parser.insertions:
        parts.extend((html[previous:position], attribute))
        previous = position
    return ''.join(parts) + html[previous:]


def page_attribute(path, adult):
    edition = 'adult' if adult else 'kids'
    return f' data-note-page="{edition}/{path.with_suffix("").as_posix()}"'
