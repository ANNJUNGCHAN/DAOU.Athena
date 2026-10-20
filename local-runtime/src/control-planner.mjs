import { randomUUID } from 'node:crypto';

import {
  CHART_OPEN_ACTION_ID,
  CHART_PERIOD_SET_ACTION_ID,
  CONTROL_CATALOG_VERSION,
  MARKET_MENU_TARGETS,
  MARKET_NAVIGATE_ACTION_ID,
  SITEMAP_OPEN_ACTION_ID,
} from '../../contracts/wts-foundation.mjs';

import { HostError } from './errors.mjs';

const OBSERVATION_MAX_AGE_MS = 5_000;
const PROPOSAL_LIFETIME_MS = 5_000;

const COMMANDS = new Map([
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

const PERIOD_LABELS = Object.freeze({
  day: '일봉',
  week: '주봉',
  month: '월봉',
  year: '년봉',
});
const MARKET_TARGET_IDS = new Set(MARKET_MENU_TARGETS.map((target) => target.id));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function normalizeControlCommand(command) {
  return command.trim().replace(/\s+/gu, ' ');
}

function terminal(status, message) {
  return { status, message, proposal: null };
}

export class ControlPlanner {
  constructor({ now = Date.now, createId = randomUUID } = {}) {
    this.now = now;
    this.createId = createId;
    this.proposals = new Map();
    this.receiptsByProposal = new Map();
  }

  plan(command, observation) {
    const parsed = COMMANDS.get(normalizeControlCommand(command));
    if (!parsed) {
      return terminal('unsupported', '이 파일럿은 차트 열기와 일봉·주봉·월봉·년봉 전환만 지원합니다.');
    }

    return this.planAction(parsed.actionId, parsed.args, observation);
  }

  planAction(actionId, args, observation) {
    const parsed = { actionId, args: clone(args) };
    if (
      ![CHART_OPEN_ACTION_ID, CHART_PERIOD_SET_ACTION_ID,
        SITEMAP_OPEN_ACTION_ID, MARKET_NAVIGATE_ACTION_ID].includes(parsed.actionId) ||
      (parsed.actionId === CHART_OPEN_ACTION_ID && Object.keys(parsed.args).length !== 0) ||
      (parsed.actionId === CHART_PERIOD_SET_ACTION_ID &&
        (Object.keys(parsed.args).length !== 1 || !Object.hasOwn(PERIOD_LABELS, parsed.args.period))) ||
      ([SITEMAP_OPEN_ACTION_ID, MARKET_NAVIGATE_ACTION_ID].includes(parsed.actionId) &&
        (Object.keys(parsed.args).length !== 1 || !MARKET_TARGET_IDS.has(parsed.args.targetId)))
    ) {
      return terminal('unsupported', '이 파일럿은 차트 열기와 일봉·주봉·월봉·년봉 전환만 지원합니다.');
    }

    const now = this.now();
    const observedAt = Date.parse(observation.capturedAt);
    if (!Number.isFinite(observedAt) || observedAt > now || now - observedAt > OBSERVATION_MAX_AGE_MS) {
      return terminal('blocked', '현재 WTS 화면을 다시 확인한 뒤 명령을 실행해 주세요.');
    }

    const state = observation.state;
    if (state.blocked) {
      return terminal('blocked', '열린 대화상자를 닫고 WTS 기본 화면에서 다시 시도해 주세요.');
    }

    if (parsed.actionId === SITEMAP_OPEN_ACTION_ID) {
      if (state.stateKind !== 'market-navigation' || state.targetId !== parsed.args.targetId) {
        return terminal('blocked', '요청한 시장 메뉴를 현재 화면에서 정확히 확인할 수 없습니다.');
      }
      if (!state.sitemapVisible && state.activeTargetId === parsed.args.targetId) {
        return terminal('satisfied', '요청한 시장 메뉴가 이미 열려 있습니다.');
      }
      if (state.sitemapVisible && state.targetAvailable === true) {
        return terminal('satisfied', '사이트맵에서 요청한 시장 메뉴를 확인했습니다.');
      }
      if (state.sitemapVisible) {
        return terminal('blocked', '사이트맵에서 요청한 시장 메뉴를 유일하게 확인할 수 없습니다.');
      }
      if (state.screenId !== 'main-market-navigation' || state.sitemapOpenEnabled !== true) {
        return terminal('blocked', '현재 화면에서 사이트맵 버튼을 정확히 확인할 수 없습니다.');
      }
    } else if (parsed.actionId === MARKET_NAVIGATE_ACTION_ID) {
      if (state.stateKind !== 'market-navigation' || state.targetId !== parsed.args.targetId) {
        return terminal('blocked', '요청한 시장 메뉴를 현재 화면에서 정확히 확인할 수 없습니다.');
      }
      if (!state.sitemapVisible && state.activeTargetId === parsed.args.targetId) {
        return terminal('satisfied', '요청한 시장 메뉴가 이미 열려 있습니다.');
      }
      if (!state.sitemapVisible || state.targetAvailable !== true) {
        return terminal('blocked', '사이트맵에서 요청한 시장 메뉴를 먼저 확인해 주세요.');
      }
    } else if (parsed.actionId === CHART_OPEN_ACTION_ID) {
      if (state.screenId === 'main-chart' && state.activeTab === 'chart') {
        return terminal('satisfied', '이미 차트 화면이 열려 있습니다.');
      }
      if (
        state.screenId !== 'main-other' ||
        state.activeTab === 'unknown' ||
        state.chartOpenEnabled !== true
      ) {
        return terminal('blocked', '현재 화면과 종목을 확실히 식별할 수 없어 차트를 열지 않았습니다.');
      }
    } else {
      if (state.screenId !== 'main-chart' || state.activeTab !== 'chart') {
        return terminal('blocked', '먼저 차트 화면을 열어 주세요.');
      }
      if (state.periodEnabled !== true) {
        return terminal('blocked', '현재 차트의 기간 버튼을 확실히 식별할 수 없습니다.');
      }
      if (state.period === parsed.args.period) {
        return terminal(
          'satisfied',
          `이미 ${PERIOD_LABELS[parsed.args.period]} 차트입니다.`,
        );
      }
    }

    const proposal = {
      id: this.createId(),
      catalogVersion: CONTROL_CATALOG_VERSION,
      observation: clone(observation),
      actionId: parsed.actionId,
      args: clone(parsed.args),
      expiresAt: new Date(now + PROPOSAL_LIFETIME_MS).toISOString(),
    };
    this.proposals.set(proposal.id, proposal);
    return {
      status: 'proposed',
      message: parsed.actionId === CHART_OPEN_ACTION_ID
        ? '현재 종목의 차트 화면을 여는 동작을 제안했습니다.'
        : parsed.actionId === CHART_PERIOD_SET_ACTION_ID
          ? `${PERIOD_LABELS[parsed.args.period]}으로 전환하는 동작을 제안했습니다.`
          : parsed.actionId === SITEMAP_OPEN_ACTION_ID
            ? '요청한 시장 메뉴를 확인하기 위해 사이트맵 열기를 제안했습니다.'
            : '사이트맵에서 요청한 시장 메뉴 이동을 제안했습니다.',
      proposal: clone(proposal),
    };
  }

  assertReceiptBinding(receipt) {
    const proposal = this.proposals.get(receipt.proposalId);
    if (!proposal) {
      throw new HostError(
        'PROPOSAL_NOT_ACTIVE',
        'Receipt does not belong to a proposal issued by this native process.',
      );
    }
    if (
      receipt.catalogVersion !== proposal.catalogVersion ||
      receipt.actionId !== proposal.actionId ||
      !sameJson(receipt.args, proposal.args) ||
      !sameJson(receipt.before, proposal.observation)
    ) {
      throw new HostError('RECEIPT_PROPOSAL_MISMATCH', 'Receipt does not match its issued proposal.');
    }
    const existingReceipt = this.receiptsByProposal.get(proposal.id);
    if (existingReceipt && !sameJson(existingReceipt, receipt)) {
      throw new HostError(
        'PROPOSAL_ALREADY_COMPLETED',
        'Proposal already has a different execution receipt.',
      );
    }
  }

  rememberReceipt(receipt) {
    this.receiptsByProposal.set(receipt.proposalId, clone(receipt));
  }
}
