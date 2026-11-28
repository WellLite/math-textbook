'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = vm.createContext({window:{}});
for (const name of ['ocean-layout', 'learning-graph', 'learning-view']) {
  vm.runInContext(readFileSync(join(__dirname, '../site', name + '.js'), 'utf8'), context);
}
const {OceanMap, LearningGraph, LearningView} = context.window;

function pathPoints(d) {
  return Array.from(d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g), m => ({x:+m[1], y:+m[2]}));
}

test('routes dock at both rings and avoid a chapter on the direct line with a local bend', () => {
  const chapters = new Map([['a',0], ['b',180], ['c',360], ['remote',1500]].map(([id,x]) =>
    [id,{x, y:0, radius:30, labelWidth:100, labelTop:38, labelBottom:56}]));
  const adjacent = {source:'a', target:'b'};
  const forward = {source:'a', target:'c'};
  const reverse = {source:'c', target:'a'};
  const paths = OceanMap.chapterRoutes([adjacent, forward, reverse], chapters);

  assert.equal(pathPoints(paths.get(adjacent)).length, 2);
  for (const edge of [forward, reverse]) {
    const points = pathPoints(paths.get(edge));
    assert.ok(points.length > 2);
    for (const [p,id] of [[points[0],edge.source], [points.at(-1),edge.target]]) {
      assert.ok(Math.abs(Math.hypot(p.x-chapters.get(id).x, p.y)-30) < .02);
    }
    assert.ok(points.some(p => Math.abs(p.y) >= 30));
    assert.ok(points.every(p => p.x >= 0 && p.x <= 360 && Math.abs(p.y) < 68));
  }
  assert.notDeepEqual(pathPoints(paths.get(forward))[0], pathPoints(paths.get(reverse)).at(-1));
});

test('both overview modes can trace supplied connections between chapters', () => {
  const atlas = JSON.parse(readFileSync(join(__dirname, '../content/map.json'), 'utf8'));
  const overview = atlas.views.find(view => view.id === 'overview');
  const layout = LearningView.layout(overview, LearningGraph.build(overview, {maxPerRow:5}), {overview:true});
  const connection = {source:overview.nodes[0].id, target:overview.nodes[1].id};
  for (const paths of [LearningView.worldRoutes(layout, .4, [connection]), OceanMap.routes(atlas, .4, [connection])]) {
    assert.equal(paths.size, 1);
    assert.ok(pathPoints(paths.get(connection)).length >= 2);
  }
});
