import re
import sys
import unittest
from pathlib import Path, PurePosixPath

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from annotation_anchors import mark_blocks, page_attribute


def anchors(markup, **options):
    return re.findall(r'data-note-anchor="([^"]+)"', mark_blocks(markup, **options))


class AnnotationAnchors(unittest.TestCase):
    def test_move_and_inline_format(self):
        first = anchors('<p>为什么要定义加法？</p><p>再添一个。</p>')
        edited = '<p>新问题。</p>\n<p>再添一个。</p><p>为什么要<strong>定义</strong>加法？</p>'
        self.assertEqual(anchors(edited)[1:], first[::-1])

    def test_an_equation_is_a_single_target(self):
        math = '<math><semantics><mi>x</mi><annotation encoding="application/x-tex">x</annotation></semantics></math>'
        markup = '<div class="equation-block"><p>' + math + '</p></div>'
        self.assertEqual(len(anchors(markup)), 1)
        self.assertEqual(anchors(markup), anchors(markup.replace('<mi>x</mi>', '<mrow><mi>x</mi></mrow>')))
        self.assertEqual(re.sub(r' data-note-anchor="[^"]+"', '', mark_blocks(markup)), markup)

    def test_rewritten_definition_and_duplicate_passages(self):
        before = '<ul><li><strong>后继</strong> 原来的定义</li></ul>'
        self.assertEqual(anchors(before, definitions=True),
                         anchors(before.replace('原来的定义', '改写后的定义'), definitions=True))
        first, second = anchors('<p>同一句。</p><p>同一句。</p>')
        self.assertEqual(second, first + '-2')

    def test_edition_identity(self):
        path = PurePosixPath('chapters/numbers/add.md')
        self.assertIn('"adult/chapters/numbers/add"', page_attribute(path, True))
        self.assertIn('"kids/chapters/numbers/add"', page_attribute(path, False))
