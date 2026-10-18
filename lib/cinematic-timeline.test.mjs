import test from 'node:test';
import assert from 'node:assert/strict';
import {
  timelines,
  cameraAt,
  cursorAt,
  typedAt,
  agoraState,
  pallasState,
  glauxState,
} from './cinematic-timeline.ts';

test('Glaux moves from background notification to chart and confirmed demo order', () => {
  assert.equal(glauxState(2).owl, false);
  assert.equal(glauxState(4).owl, true);
  assert.equal(glauxState(8).open, false);
  assert.equal(glauxState(9).open, true);
  assert.equal(glauxState(11).chat, false);
  assert.equal(glauxState(18).chart, true);
  assert.equal(glauxState(27).ticket, false);
  assert.equal(glauxState(28).ticket, true);
  assert.equal(glauxState(31).review, false);
  assert.equal(glauxState(32).review, true);
  assert.equal(glauxState(33).submitted, false);
  assert.equal(glauxState(34).submitted, true);
});

test('six timelines start and finish with the complete app and have ordered finite camera tracks', () => {
  assert.equal(Object.keys(timelines).length, 6);
  for (const [id, t] of Object.entries(timelines)) {
    for (const track of [t.camera, t.cursor, t.beats])
      for (let i = 1; i < track.length; i++)
        assert.ok(track[i].at > track[i - 1].at, `${id} ordered`);
    assert.equal(cameraAt(id, 0).zoom, 1);
    assert.equal(cameraAt(id, t.duration - 1).zoom, 1);
    for (let s = 0; s < t.duration; s += 0.1) {
      const p = cameraAt(id, s);
      assert.ok([p.x, p.y, p.zoom].every(Number.isFinite));
      assert.ok(p.zoom >= 1 && p.zoom <= 3);
    }
  }
});
test('Agora deepens exactly one Samsung chart through trend and disclosure analysis', () => {
  assert.equal(typedAt('삼성전자 지금 주가 어때?', 0, 4, 7), '');
  assert.equal(typedAt('삼성전자 지금 주가 어때?', 7, 4, 7), '삼성전자 지금 주가 어때?');
  assert.equal(agoraState(8).thinking, true);
  assert.equal(agoraState(8).firstChart, false);
  assert.equal(agoraState(11).firstChart, true);
  assert.equal(agoraState(18.9).trendSent, false);
  assert.equal(agoraState(19).trendSent, true);
  assert.equal(agoraState(20).thinking, true);
  assert.equal(agoraState(21.4).trendAnalysis, false);
  assert.equal(agoraState(21.5).trendAnalysis, true);
  assert.equal(agoraState(42.9).disclosureSent, false);
  assert.equal(agoraState(43).disclosureSent, true);
  assert.equal(agoraState(45).thinking, true);
  assert.equal(agoraState(45.9).disclosures, false);
  assert.equal(agoraState(46).disclosures, true);
  assert.equal(agoraState(46).thinking, false);
  for (const time of [11, 23, 28, 31, 39, 47])
    assert.equal(agoraState(time).active, '삼성전자');
  assert.equal(timelines.agora.duration, 64);
  assert.equal(agoraState(37).trendAnalysis, true);
  assert.equal(agoraState(37).disclosureSent, false);
  assert.equal(agoraState(49.9).disclosureSelected, false);
  assert.equal(agoraState(50).disclosureSelected, true);
  assert.equal(agoraState(51.9).disclosureReader, false);
  assert.equal(agoraState(52).disclosureReader, true);
  const rowClick = cursorAt('agora', 50);
  assert.equal(rowClick.click, true);
  assert.equal(rowClick.x, 560);
  assert.equal(rowClick.y, 275);
  assert.equal(typedAt('지금 차트 추세로 보면 사도 될까?', 18.6, 15.8, 18.6), '지금 차트 추세로 보면 사도 될까?');
  assert.equal(typedAt('@공시 스킬 삼성전자 최근에 나온 공시들을 분석해줘', 42.5, 38, 42.5), '@공시 스킬 삼성전자 최근에 나온 공시들을 분석해줘');
});

test('Ergane frames the whole permission list and keeps save visible', () => {
  const list = cameraAt('ergane', 12);
  for (const [x, y] of [
    [319, 390],
    [1149, 570],
  ]) {
    assert.ok(Math.abs(x - list.x) * list.zoom < 800);
    assert.ok(Math.abs(y - list.y) * list.zoom < 500);
  }
  const save = cameraAt('ergane', 19),
    cursor = cursorAt('ergane', 19);
  assert.ok(Math.abs(cursor.x - save.x) * save.zoom < 800);
  assert.ok(Math.abs(cursor.y - save.y) * save.zoom < 500);
});
test('cursor travels in 320ms and settles before the existing click time', () => {
  assert.equal(cursorAt('agora', 7).x, 1300);
  assert.ok(cursorAt('agora', 7.24).x > 1300);
  assert.ok(cursorAt('agora', 7.24).x < 1550);
  assert.equal(cursorAt('agora', 7.4).x, 1550);
  assert.equal(cursorAt('agora', 7.4).click, false);
  assert.equal(cursorAt('agora', 7.5).click, true);
});
test('send clicks occur at the visible send button, both after typing finishes', () => {
  for (const [id, seconds] of [
    ['agora', [7.5, 19, 43]],
    ['metis', [20.5]],
    ['pallas', [4, 16]],
  ])
    for (const second of seconds) {
      const c = cursorAt(id, second),
        p = cameraAt(id, second);
      assert.equal(c.click, true);
      assert.equal(c.x, 1550);
      assert.equal(c.y, 918);
      assert.ok(Math.abs(c.x - p.x) * p.zoom < 800);
      assert.ok(Math.abs(c.y - p.y) * p.zoom < 500);
      assert.equal(cursorAt(id, second + 0.5).click, false);
    }
});

test('Pallas remains a backtest-only walkthrough and ends on result review', () => {
  assert.equal(pallasState(5.9).phase, 'create');
  assert.equal(pallasState(6).phase, 'code');
  assert.equal(pallasState(10).phase, 'graph');
  assert.equal(pallasState(19).phase, 'form');
  assert.equal(pallasState(20).phase, 'running');
  assert.equal(pallasState(23).phase, 'running');
  assert.equal(pallasState(24).result, true);
  assert.equal(pallasState(timelines.pallas.duration - 0.01).phase, 'result');
  assert.equal(pallasState(timelines.pallas.duration + 30).phase, 'result');
  assert.deepEqual(Object.keys(pallasState(60)).sort(), ['phase', 'result']);
  assert.equal(timelines.pallas.duration, 29);
  assert.deepEqual(timelines.pallas.camera.at(-1), {
    at: timelines.pallas.duration,
    x: 800,
    y: 500,
    zoom: 1,
  });
  assert.match(timelines.pallas.beats.at(-1).label, /백테스트 결과/);
  assert.ok(
    timelines.pallas.beats.every(
      ({ label }) => !/배포|자동 주문|주문 접수|모의매매/.test(label),
    ),
  );
  assert.equal(cursorAt('pallas', 28).click, false);
});
