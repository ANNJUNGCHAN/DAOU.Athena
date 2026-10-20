const MAX_OBSERVATION_AGE_MS = 5_000;
const MAX_PROPOSAL_LIFETIME_MS = 5_000;
const DEFAULT_MAX_ARCHIVED_RECEIPTS = 50;
const DEFAULT_MAX_ARCHIVE_BYTES = 512 * 1024;

function sameJson(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameJson(value, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && sameJson(left[key], right[key]));
}

function timestampMs(value, label) {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error(`${label} 시간이 올바르지 않습니다.`);
  return result;
}

function reasonError(reason, message) {
  const error = new Error(message);
  error.controlReason = reason;
  return error;
}

export function assertPilotRuntimeGate({
  runtime,
  summary,
  protocolVersion,
  catalogVersion,
  actionIds,
  marketMenuProfile,
}) {
  if (
    protocolVersion !== 6
    || runtime?.runtimeVersion !== "0.6.0"
    || runtime?.capabilities?.screenControl !== true
    || runtime?.capabilities?.localPlanner !== false
    || runtime?.capabilities?.laya !== false
    || runtime?.control?.catalogVersion !== catalogVersion
    || runtime?.control?.commandMode !== "bounded-korean-v3"
    || runtime?.control?.taskMode !== "bounded-compound-v1"
    || runtime?.control?.maxTaskSteps !== 12
    || runtime?.control?.planner?.kind !== "deterministic"
    || runtime?.control?.planner?.id !== "deterministic-korean-wts-v3"
    || runtime?.control?.planner?.version !== "3"
    || runtime?.control?.planner?.bundleHash !== null
    || runtime?.control?.planner?.generative !== false
    || runtime?.control?.planner?.localModelReady !== false
    || !sameJson(runtime?.control?.actions, actionIds)
    || !sameJson(runtime?.control?.market, marketMenuProfile)
  ) {
    throw new Error("로컬 실행기가 WTS 대화 작업 v6 계약과 일치하지 않습니다.");
  }
  if (!Number.isInteger(summary?.captureCount) || summary.captureCount < 1) {
    throw new Error("먼저 현재 화면 조사를 로컬에 1회 이상 저장해 주세요.");
  }
  return Object.freeze({ ready: true, catalogVersion });
}

export function assertControlIdle(coordinator) {
  if (coordinator.running()) throw new Error("WTS 명령이 진행 중에는 로컬 실행기 연결을 해제할 수 없습니다.");
}

export function prepareReceiptArchive({
  archive,
  pendingJson,
  validateControlReceipt,
  maxEntries = DEFAULT_MAX_ARCHIVED_RECEIPTS,
  maxBytes = DEFAULT_MAX_ARCHIVE_BYTES,
}) {
  let parsed;
  try { parsed = JSON.parse(pendingJson); } catch { throw new Error("보류된 영수증 JSON이 손상되었습니다."); }
  const receipt = validateControlReceipt(parsed);
  const current = archive ?? { version: 1, receipts: {} };
  if (
    current?.version !== 1
    || !current.receipts
    || typeof current.receipts !== "object"
    || Array.isArray(current.receipts)
  ) {
    throw new Error("미확인 결과 보관소 형식이 올바르지 않습니다.");
  }
  const receipts = { ...current.receipts };
  if (Object.hasOwn(receipts, receipt.id) && receipts[receipt.id] !== pendingJson) {
    throw new Error("같은 영수증 ID에 다른 내용이 이미 보관되어 있습니다.");
  }
  receipts[receipt.id] = pendingJson;
  const next = { version: 1, receipts };
  if (Object.keys(receipts).length > maxEntries) {
    throw new Error(`미확인 결과 보관소는 최대 ${maxEntries}건입니다.`);
  }
  if (new TextEncoder().encode(JSON.stringify(next)).byteLength > maxBytes) {
    throw new Error("미확인 결과 보관소가 512 KiB 제한을 초과했습니다.");
  }
  return { archive: next, receiptId: receipt.id };
}

export function assertFreshProposal({
  proposal,
  before,
  now,
  catalogVersion,
  actionIds,
}) {
  const currentMs = now();
  const observedMs = timestampMs(before.capturedAt, "화면 관찰");
  const expiresMs = timestampMs(proposal.expiresAt, "제안 만료");
  if (currentMs - observedMs < 0 || currentMs - observedMs > MAX_OBSERVATION_AGE_MS) {
    throw new Error("화면 관찰이 5초 유효 범위를 벗어났습니다.");
  }
  if (expiresMs <= currentMs || expiresMs - currentMs > MAX_PROPOSAL_LIFETIME_MS) {
    throw new Error("제안이 만료되었거나 5초 유효 범위를 초과했습니다.");
  }
  if (
    proposal.catalogVersion !== catalogVersion
    || !actionIds.includes(proposal.actionId)
    || !sameJson(proposal.observation, before)
  ) {
    throw new Error("로컬 실행기 제안이 현재 화면 또는 허용된 동작과 일치하지 않습니다.");
  }
  return proposal;
}

export function controlPostconditionMet(
  actionId,
  args,
  observation,
  expectedInstrumentToken,
  chartOpenActionId,
  periodSetActionId,
  sitemapOpenActionId,
  marketNavigateActionId,
) {
  if (observation.state.instrumentToken !== expectedInstrumentToken) return false;
  if (actionId === chartOpenActionId) {
    return observation.state.screenId === "main-chart" && observation.state.activeTab === "chart";
  }
  if (actionId === periodSetActionId) {
    return observation.state.screenId === "main-chart"
      && observation.state.activeTab === "chart"
      && observation.state.period === args.period;
  }
  if (actionId === sitemapOpenActionId) {
    return observation.state.stateKind === "market-navigation"
      && observation.state.targetId === args.targetId
      && observation.state.blocked === false
      && observation.state.sitemapVisible === true
      && observation.state.targetAvailable === true;
  }
  if (actionId === marketNavigateActionId) {
    return observation.state.stateKind === "market-navigation"
      && observation.state.targetId === args.targetId
      && observation.state.blocked === false
      && observation.state.sitemapVisible === false
      && observation.state.activeTargetId === args.targetId;
  }
  return false;
}

export function createControlCoordinator({
  now = Date.now,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  createId = () => crypto.randomUUID(),
  request,
  observeCurrent,
  executeOnce,
  observeSameDocument,
  loadPendingReceipt,
  savePendingReceipt,
  clearPendingReceipt,
  archivePendingReceipt,
  validateControlObservation,
  validateControlProposal,
  validateControlReceipt,
  catalogVersion,
  actionIds,
  chartOpenActionId,
  periodSetActionId,
  sitemapOpenActionId,
  marketNavigateActionId,
  postconditionTimeoutMs = 1_500,
  marketPostconditionTimeoutMs = 3_000,
  pollIntervalMs = 100,
}) {
  let inFlight = null;
  let activeRun = null;

  async function recordReceipt(receipt) {
    const exact = validateControlReceipt(receipt);
    const exactJson = JSON.stringify(exact);
    try {
      const response = await request("control.receipt.record", { receipt: exact });
      if (!response.ok) throw new Error(response.error.message);
      await clearPendingReceipt(exactJson);
      return response.result;
    } catch (error) {
      await savePendingReceipt(exactJson);
      throw new Error(`동작은 반복하지 않습니다. 동일한 결과 영수증만 다시 저장해 주세요: ${error.message}`);
    }
  }

  function makeReceipt({ proposal, before, after, status, reason }) {
    return validateControlReceipt({
      id: createId(),
      proposalId: proposal.id,
      catalogVersion,
      actionId: proposal.actionId,
      args: proposal.args,
      before,
      after,
      status,
      reason,
      completedAt: new Date(now()).toISOString(),
    });
  }

  async function run(command, runState) {
    if (await loadPendingReceipt()) {
      throw new Error("저장하지 못한 동작 결과가 있습니다. 영수증 저장 재시도 또는 미확인 결과 보관 후 다시 실행해 주세요.");
    }
    {
      const before = validateControlObservation(await observeCurrent());
      const planResponse = await request("control.plan", { command, observation: before });
      if (!planResponse.ok) throw new Error(planResponse.error.message);
      const plan = planResponse.result;
      if (plan.status !== "proposed") return { ...plan, receipt: null };

      const proposal = assertFreshProposal({
        proposal: validateControlProposal(plan.proposal),
        before,
        now,
        catalogVersion,
        actionIds,
      });
      if (runState.cancelRequested) {
        const receipt = makeReceipt({ proposal, before, after: null, status: "cancelled", reason: "CANCELLED" });
        await recordReceipt(receipt);
        return { status: "cancelled", message: "사용자가 실행 전에 취소했습니다.", proposal, receipt };
      }

      runState.actionStarted = true;
      let execution;
      try {
        execution = await executeOnce(proposal);
      } catch (error) {
        const reason = error?.controlReason === "DOCUMENT_CHANGED" ? "DOCUMENT_CHANGED" : "EXECUTION_ERROR";
        const status = error?.actionMayHaveRun === true ? "unverified" : "blocked";
        const receipt = makeReceipt({ proposal, before, after: null, status, reason });
        await recordReceipt(receipt);
        return {
          status,
          message: error?.actionMayHaveRun === true
            ? `${error.message} 클릭은 자동 재시도하지 않습니다.`
            : error.message,
          proposal,
          receipt,
        };
      }

      const immediate = validateControlObservation(execution.observation);
      if (execution.reason === "PRECONDITION_CHANGED" || execution.acted !== true) {
        const reason = execution.reason === "PRECONDITION_CHANGED" ? "PRECONDITION_CHANGED" : "EXECUTION_ERROR";
        const status = reason === "PRECONDITION_CHANGED" ? "blocked" : "unverified";
        const receipt = makeReceipt({ proposal, before, after: immediate, status, reason });
        await recordReceipt(receipt);
        return {
          status,
          message: reason === "PRECONDITION_CHANGED"
            ? "실행 직전 화면 상태가 바뀌어 클릭하지 않았습니다."
            : "실행 중 오류가 발생했습니다. 클릭은 자동 재시도하지 않습니다.",
          proposal,
          receipt,
        };
      }

      const instrumentToken = before.state.instrumentToken;
      if (immediate.state.instrumentToken !== instrumentToken) {
        const receipt = makeReceipt({
          proposal,
          before,
          after: immediate,
          status: "unverified",
          reason: "PRECONDITION_CHANGED",
        });
        await recordReceipt(receipt);
        return {
          status: "unverified",
          message: "클릭 후 종목이 바뀌어 결과를 성공으로 확인하지 않았습니다. 클릭은 자동 재시도하지 않습니다.",
          proposal,
          receipt,
        };
      }

      let after = immediate;
      const marketAction = [sitemapOpenActionId, marketNavigateActionId].includes(proposal.actionId);
      const deadline = now() + (marketAction ? marketPostconditionTimeoutMs : postconditionTimeoutMs);
      while (!controlPostconditionMet(
        proposal.actionId,
        proposal.args,
        after,
        instrumentToken,
        chartOpenActionId,
        periodSetActionId,
        sitemapOpenActionId,
        marketNavigateActionId,
      )) {
        if (now() >= deadline) break;
        await wait(pollIntervalMs);
        try {
          after = validateControlObservation(await observeSameDocument(proposal.observation.source));
        } catch (error) {
          const reason = error?.controlReason === "DOCUMENT_CHANGED" ? "DOCUMENT_CHANGED" : "EXECUTION_ERROR";
          const receipt = makeReceipt({ proposal, before, after: null, status: "unverified", reason });
          await recordReceipt(receipt);
          return { status: "unverified", message: error.message, proposal, receipt };
        }
        if (after.state.instrumentToken !== instrumentToken) {
          const receipt = makeReceipt({
            proposal,
            before,
            after,
            status: "unverified",
            reason: "PRECONDITION_CHANGED",
          });
          await recordReceipt(receipt);
          return {
            status: "unverified",
            message: "확인 중 종목이 바뀌어 결과를 성공으로 확인하지 않았습니다. 클릭은 자동 재시도하지 않습니다.",
            proposal,
            receipt,
          };
        }
      }

      const verified = controlPostconditionMet(
        proposal.actionId,
        proposal.args,
        after,
        instrumentToken,
        chartOpenActionId,
        periodSetActionId,
        sitemapOpenActionId,
        marketNavigateActionId,
      );
      const receipt = makeReceipt({
        proposal,
        before,
        after,
        status: verified ? "verified" : "unverified",
        reason: verified ? "POSTCONDITION_MET" : "POSTCONDITION_TIMEOUT",
      });
      await recordReceipt(receipt);
      return {
        status: receipt.status,
        message: verified ? "화면 변화를 확인했습니다." : "클릭은 한 번만 실행했지만 화면 변화를 확인하지 못했습니다.",
        proposal,
        receipt,
      };
    }
  }

  function startMaintenance(task) {
    if (inFlight) return Promise.reject(new Error("다른 WTS 요청이 진행 중입니다."));
    const operation = Promise.resolve().then(task);
    inFlight = operation.finally(() => { inFlight = null; });
    return inFlight;
  }

  return {
    execute(command) {
      if (!inFlight) {
        const runState = { cancelRequested: false, actionStarted: false };
        activeRun = runState;
        const operation = Promise.resolve().then(() => run(command, runState));
        inFlight = operation.finally(() => {
          inFlight = null;
          activeRun = null;
        });
      }
      return inFlight;
    },
    cancel() {
      if (!activeRun || activeRun.actionStarted) return false;
      activeRun.cancelRequested = true;
      return true;
    },
    retryReceipt() {
      return startMaintenance(async () => {
      const pendingJson = await loadPendingReceipt();
      if (!pendingJson) throw new Error("다시 저장할 영수증이 없습니다.");
      return recordReceipt(JSON.parse(pendingJson));
      });
    },
    archiveReceipt() {
      return startMaintenance(async () => {
        const pendingJson = await loadPendingReceipt();
        if (!pendingJson) throw new Error("보관할 미확인 결과가 없습니다.");
        return archivePendingReceipt(pendingJson);
      });
    },
    async hasPendingReceipt() {
      return Boolean(await loadPendingReceipt());
    },
    running() {
      return Boolean(inFlight);
    },
  };
}

export { reasonError };
