'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');

// Packaged logs retain event names, never arbitrary error text, account labels,
// paths, model output, or request identifiers from the legacy debug messages.
const SAFE_EVENTS = [
  ['module loaded,', 'module loaded'],
  ['requestSingleInstanceLock 실패', 'single instance lock unavailable'],
  ['second-instance 감지', 'second instance received'],
  ['window-all-closed fired', 'all windows closed'],
  ['createWindows start', 'window creation started'],
  ['warmup created,', 'warmup created'],
  ['warmup ready-to-show fired', 'warmup ready'],
  ['bootWin + WCO shellWin created', 'shell created'],
  ['boot + shell ready-to-show fired', 'shell ready'],
  ['boot -> WCO shell handoff complete', 'shell handoff complete'],
  ['ensureTray at createWindows failed:', 'tray creation failed'],
  ['ensureTray: 트레이 아이콘 생성', 'tray created'],
  ['ensureBackend: 소유 백엔드가 예기치 않게 종료됨', 'backend exited unexpectedly; restart requested'],
  ['백엔드 종료 실패:', 'backend shutdown failed'],
  ['세션 스토어 열기 실패', 'session store open failed'],
  ['세션 저장 실패', 'session save failed'],
  ['대화 이력 SQLite 준비 실패', 'chat history database preparation failed'],
  ['차트 표시 확인 실패', 'chart paint acknowledgement failed'],
  ['저장된 차트 표시 확인 실패', 'saved chart paint acknowledgement failed'],
  ['CLI 계정 상태 갱신 실패', 'CLI account status refresh failed'],
  ['백그라운드 시작 작업 오류:', 'background startup failed'],
];
const BOOT_EVENT = /^부팅 작업 (mcp-env|account-token|provider-warm|backend|stock-index|brain-ingestion|chat-history-flush|graph-projection|alarm-bootstrap|routine-feed|canvas-feed|fixture-readiness|background-loops) → (pending|running|retrying|succeeded|failed|disabled)(?: — |$)/;

function safeEvent(message) {
  const task = BOOT_EVENT.exec(message);
  if (task) return `boot ${task[1]} ${task[2]}`;
  return SAFE_EVENTS.find(([prefix]) => message.startsWith(prefix))?.[1] || null;
}

function createDiagnosticLog({ userDataPath, detailed = false, maxBytes = 1024 * 1024 }) {
  return (message) => {
    try {
      const text = detailed ? String(message) : safeEvent(String(message));
      if (!text) return;
      const file = path.join(userDataPath(), 'logs', 'main-debug.log');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // Bound even a single oversized debug message before checking rotation.
      const line = Buffer.from(`${new Date().toISOString()} ${text.replace(/[\r\n]/g, ' ')}`);
      const prefix = line.subarray(0, Math.min(8192, maxBytes) - 1);
      const record = Buffer.from(`${new StringDecoder('utf8').write(prefix)}\n`);
      if (fs.existsSync(file) && fs.statSync(file).size + record.length > maxBytes) {
        const backup = `${file}.1`;
        if (fs.existsSync(backup)) fs.unlinkSync(backup);
        fs.renameSync(file, backup);
      }
      fs.appendFileSync(file, record);
    } catch { /* Diagnostics must never interrupt startup, shutdown, or a user turn. */ }
  };
}

module.exports = { createDiagnosticLog };
