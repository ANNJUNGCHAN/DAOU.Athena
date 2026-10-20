import {
  CHART_OPEN_ACTION_ID,
  CHART_PERIOD_SET_ACTION_ID,
  MARKET_MENU_TARGETS,
  MARKET_NAVIGATE_ACTION_ID,
  SITEMAP_OPEN_ACTION_ID,
} from '../../contracts/wts-foundation.mjs';

const MAX_TASK_STEPS = 12;

const SINGLE_COMMANDS = new Map([
  ['차트 열어줘', { actionId: CHART_OPEN_ACTION_ID, args: {} }],
  ['차트 열기', { actionId: CHART_OPEN_ACTION_ID, args: {} }],
  ['일봉으로', { actionId: CHART_PERIOD_SET_ACTION_ID, args: { period: 'day' } }],
  ['일봉으로 바꿔줘', { actionId: CHART_PERIOD_SET_ACTION_ID, args: { period: 'day' } }],
  ['주봉으로', { actionId: CHART_PERIOD_SET_ACTION_ID, args: { period: 'week' } }],
  ['주봉으로 바꿔줘', { actionId: CHART_PERIOD_SET_ACTION_ID, args: { period: 'week' } }],
  ['월봉으로', { actionId: CHART_PERIOD_SET_ACTION_ID, args: { period: 'month' } }],
  ['월봉으로 바꿔줘', { actionId: CHART_PERIOD_SET_ACTION_ID, args: { period: 'month' } }],
  ['년봉으로', { actionId: CHART_PERIOD_SET_ACTION_ID, args: { period: 'year' } }],
  ['년봉으로 바꿔줘', { actionId: CHART_PERIOD_SET_ACTION_ID, args: { period: 'year' } }],
]);

const CONTINUING_COMMANDS = new Map([
  ['차트 열고', { actionId: CHART_OPEN_ACTION_ID, args: {} }],
  ['일봉으로 바꾸고', { actionId: CHART_PERIOD_SET_ACTION_ID, args: { period: 'day' } }],
  ['주봉으로 바꾸고', { actionId: CHART_PERIOD_SET_ACTION_ID, args: { period: 'week' } }],
  ['월봉으로 바꾸고', { actionId: CHART_PERIOD_SET_ACTION_ID, args: { period: 'month' } }],
  ['년봉으로 바꾸고', { actionId: CHART_PERIOD_SET_ACTION_ID, args: { period: 'year' } }],
]);

const MARKET_COMMANDS = new Map(MARKET_MENU_TARGETS.map((target) => [
  `시장 메뉴 열어줘: ${target.sitemapGroup} > ${target.buttonLabel}`,
  [
    { actionId: SITEMAP_OPEN_ACTION_ID, args: { targetId: target.id } },
    { actionId: MARKET_NAVIGATE_ACTION_ID, args: { targetId: target.id } },
  ],
]));

export const TASK_COMPILER = Object.freeze({
  kind: 'deterministic',
  id: 'deterministic-korean-wts-v3',
  version: '3',
  generative: false,
  bundleHash: null,
});

export function normalizeTaskInput(text) {
  return text.trim().replace(/\s+/gu, ' ');
}

export function compileTaskInput(text) {
  const normalized = normalizeTaskInput(text);
  const pieces = normalized.split(/\s*(?:,|그리고)\s*/u);
  const compiled = [];

  for (const piece of pieces) {
    if (!piece) return null;
    const marketSteps = MARKET_COMMANDS.get(piece);
    if (marketSteps) {
      compiled.push(...marketSteps);
      continue;
    }
    let remainder = piece;
    let chained = remainder.match(
      /^(차트 열고|일봉으로 바꾸고|주봉으로 바꾸고|월봉으로 바꾸고|년봉으로 바꾸고)\s+(.+)$/u,
    );
    while (chained) {
      compiled.push(CONTINUING_COMMANDS.get(chained[1]));
      remainder = chained[2];
      chained = remainder.match(
        /^(차트 열고|일봉으로 바꾸고|주봉으로 바꾸고|월봉으로 바꾸고|년봉으로 바꾸고)\s+(.+)$/u,
      );
    }
    const command = SINGLE_COMMANDS.get(remainder);
    if (!command) return null;
    compiled.push(command);
  }

  if (compiled.length < 1 || compiled.length > MAX_TASK_STEPS) return null;
  return compiled.map(({ actionId, args }) => ({
    actionId,
    args: structuredClone(args),
  }));
}

export const CONTROL_PLANNING_CATALOG = Object.freeze([
  '차트 열어줘',
  '일봉으로',
  '주봉으로',
  '월봉으로',
  '년봉으로',
  ...MARKET_COMMANDS.keys(),
]);

export { MAX_TASK_STEPS };
