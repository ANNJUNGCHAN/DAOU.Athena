import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const axisModuleUrl = new URL('./lightweight-charts-axis.mjs', import.meta.url);
const upstreamModuleUrl = new URL('../node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.mjs', import.meta.url);

async function importTimeAxisWidget(url) {
  const source = await readFile(url, 'utf8');
  const augmented = `${source}\nexport { Jn as ActualTimeAxisWidget };\n`;
  return import(`data:text/javascript;base64,${Buffer.from(augmented).toString('base64')}`);
}

function drawTimeLabels(prototype, marks, drawName) {
  const rows = [];
  const labelWidth = (label) => (label.endsWith('년') ? 40 : 20);
  const context = {
    font: '',
    measureText(label) {
      return { width: labelWidth(label) };
    },
    fillText(label, x, y) {
      rows.push({
        label,
        x,
        y,
        font: this.font,
        left: x - labelWidth(label) / 2,
        right: x + labelWidth(label) / 2,
      });
    },
  };
  const widget = Object.create(prototype);
  Object.assign(widget, {
    Gv: {
      Qt: () => ({ Bt: () => ({ Ll: () => marks, N: () => ({ borderVisible: false, ticksVisible: false }) }) }),
      N: () => ({ timeScale: { allowBoldLabels: true } }),
    },
    Pu: { maxTickMarkWeight: (rowsToMeasure) => Math.max(...rowsToMeasure.map((mark) => mark.weight)) },
    Gw: () => ({ S: 1, C: 5, A: 3, P: 12 }),
    H: () => '#333',
    ym: () => '12px sans-serif',
    ig: () => 'bold 12px sans-serif',
    rm: { Ii: (canvas, label) => canvas.measureText(label).width },
    nm: { width: 100, height: 28 },
  });
  prototype[drawName].call(widget, {
    useMediaCoordinateSpace(callback) {
      callback({ context });
    },
    useBitmapCoordinateSpace() {
      throw new Error('Unexpected grid paint');
    },
  });
  return rows;
}

test('chart card loads the repository-owned date-axis module', async () => {
  const chartCard = await readFile(new URL('./chart-card.js', import.meta.url), 'utf8');
  assert.equal((chartCard.match(/\.\/lightweight-charts-axis\.mjs/g) || []).length, 1);
  assert.equal(chartCard.includes('../node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.mjs'), false);
});

test('date-axis variant aligns edge glyphs and preserves interior labels', async () => {
  const [upstream, candidate] = await Promise.all([
    importTimeAxisWidget(upstreamModuleUrl),
    importTimeAxisWidget(axisModuleUrl),
  ]);
  const marks = [
    { label: '2019년', coord: 0, weight: 70, needAlignCoordinate: false },
    { label: '10월', coord: 99, weight: 50, needAlignCoordinate: false },
    { label: '2021년', coord: 50, weight: 70, needAlignCoordinate: false },
    { label: '7월', coord: 30, weight: 50, needAlignCoordinate: false },
  ];
  const drawName = Object.entries(Object.getOwnPropertyDescriptors(upstream.ActualTimeAxisWidget.prototype))
    .find(([key, descriptor]) => key !== 'constructor'
      && typeof descriptor.value === 'function'
      && (descriptor.value.toString().match(/needAlignCoordinate/g) || []).length === 2)?.[0];
  assert.equal(drawName, 'Bm');
  const baseline = drawTimeLabels(upstream.ActualTimeAxisWidget.prototype, marks, drawName);
  const result = drawTimeLabels(candidate.ActualTimeAxisWidget.prototype, marks, drawName);
  const outside = (rows) => rows.filter((row) => row.left < -0.5 || row.right > 100.5);

  assert.equal(upstream.version(), '5.2.1');
  assert.equal(candidate.version(), upstream.version());
  assert.equal(
    candidate.ActualTimeAxisWidget.prototype.tg.toString(),
    upstream.ActualTimeAxisWidget.prototype.tg.toString(),
  );
  assert.equal(outside(baseline).length, 2);
  assert.equal(outside(result).length, 0);
  assert.deepEqual(
    result.map(({ label, y, font }) => ({ label, y, font })),
    baseline.map(({ label, y, font }) => ({ label, y, font })),
  );
  for (const label of ['2021년', '7월']) {
    assert.equal(result.find((row) => row.label === label).x, baseline.find((row) => row.label === label).x);
  }

  const alreadyAligned = marks.map((mark) => ({ ...mark, needAlignCoordinate: true }));
  assert.deepEqual(
    drawTimeLabels(candidate.ActualTimeAxisWidget.prototype, alreadyAligned, drawName),
    drawTimeLabels(upstream.ActualTimeAxisWidget.prototype, alreadyAligned, drawName),
  );
});
