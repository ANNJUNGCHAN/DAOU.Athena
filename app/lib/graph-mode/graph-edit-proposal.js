// IIFE 스코프 격리(2026-08-18 렌더러 격리) — brain-questions.js와 같은 패턴.
(function () {

// 그래프 편집 제안(2026-09-03) — 모델이 "이 관계를 이렇게 고칠까요"를 카드로 묻고,
// **사람이 누르면** 그 답이 그래프에 반영된다.
//
// **왜 모델이 직접 쓰지 않나.** brain_tools.py가 티어 설계를 못박아 뒀다: 모델이
// 그래프에 직접 쓸 수 있으면 대화 티어가 자기 주장을 결정적 사실처럼 밀어 넣는 길이
// 생긴다. 사용자가 2026-09-03에 "모델은 제안, 확정은 사람"을 골랐고, 이 파일이
// 그 경계다 — 모델이 카드를 스스로 누를 방법은 없다.
//
// **누르면 무엇이 도나(같은 날 후속).** 처음에는 답변 문장이 채팅으로 나가 추출
// 경로를 탔다. 그런데 반영이 다음 수집 배치까지 밀리고 모델은 그 문장을 새 요청으로
// 읽어 같은 카드를 반복했다(실측 제보). 지금은 id가 갖춰진 add·remove만 전용 API로
// 바로 반영한다. 불확실성 수준을 보존할 수 없는 change는 카드 자체를 만들지 않는다.
//
// **왜 되물을 것들 카드와 같은 모양인가.** 사람이 답해야 하는 일이 화면에 두 종류
// 생기는데(불확실한 관계 확인 / 모델의 편집 제안) 모양이 다르면 "무엇을 누르는
// 것인지"를 매번 새로 배워야 한다. 선택지 문구와 키 힌트까지 brain-questions.js와
// 같은 것을 쓴다 — 그래서 CSS도 .question-card* 그대로다(새 유리 층을 만들지 않는다).
//
// 이 파일은 순수 함수만 둔다(DOM 없음) — 문구가 코드에 굳어야 화면을 고칠 때 흔들리지
// 않고, node --test로 잴 수 있다.

// 관계 이름 한글 라벨은 controller.js RELATION_LABELS가 진실이라 **주입받는다**
// (brain-questions.js가 같은 이유로 주입받는 것과 같다 — 복사하면 한쪽만 고치는
// 실수가 나고, 반대로 이 leaf가 controller를 의존하면 층이 뒤집힌다).

// 백엔드 graph_view_tools._EDIT_OPS와 같은 셋. 어긋나면 화면이 못 그리는 제안이 온다.
// change는 제외한다. 현재 직접 쓰기 API는 관계를 무조건 확정 상태로 만들기 때문에
// 불확실성 수준을 보존한 수정이 불가능하다. 의미를 잃는 수정 카드는 띄우지 않는다.
const OPS = Object.freeze({
  add: { label: '추가', verb: '맞아' },
  remove: { label: '삭제', verb: '아니야' },
});

function isOp(op) {
  return Object.prototype.hasOwnProperty.call(OPS, String(op || ''));
}

// 봉투(main.js가 보낸 athena:graph-chat-action의 edit_proposal)를 화면이 쓸 형태로.
// 못 쓸 제안은 null이다 — 무엇을 어떻게 고칠지 모르는 카드를 띄우면 사람이 답할 수
// 없다. 백엔드도 같은 것을 막지만(graph_view_tools) 여기서 다시 본다: 화면은 봉투가
// 어디서 왔는지 모르는 채로 그려야 한다.
function normalizeProposal(message, relationLabels) {
  if (!message || typeof message !== 'object') return null;
  if (!isOp(message.op)) return null;
  const dict = relationLabels && typeof relationLabels === 'object' ? relationLabels : {};
  const object = String(message.object == null ? '' : message.object).trim();
  const relation = String(message.relation == null ? '' : message.relation).trim();
  if (!object || !relation) return null;
  const subject = String(message.subject == null ? '' : message.subject).trim();
  const relationId = message.relationId ? String(message.relationId).trim() || null : null;
  const subjectId = message.subjectId ? String(message.subjectId).trim() || null : null;
  const objectId = message.objectId ? String(message.objectId).trim() || null : null;
  if (message.op === 'remove' && !relationId) return null;
  if (message.op === 'add' && (!subjectId || !objectId)) return null;
  return {
    op: String(message.op),
    opLabel: OPS[String(message.op)].label,
    // 주체가 없으면 투자자 프로필이 주체다(성향 관계) — 성향 신호 표가 "내가"를
    // 아예 적지 않는 것과 같은 규칙이라, 화면에도 적지 않는다.
    subject,
    subjectImplicit: !subject,
    object,
    relation,
    relationText: dict[relation] || relation,
    // 적용은 채팅 재해석을 거치지 않고 id로 직접 반영한다. id가 없으면 위에서
    // 제안을 버린다 — 가짜 사용자 발화를 만들어 추출기로 우회하지 않는다.
    relationId,
    subjectId,
    objectId,
    reason: message.reason ? String(message.reason).trim() || null : null,
  };
}

// 카드 제목 — 무엇을 어떻게 하자는 것인지 한 줄로. 사람이 이것만 읽고 판단한다.
function proposalTitle(item) {
  if (!item) return '';
  const target = item.subjectImplicit
    ? `"${item.object}" · '${item.relationText}'`
    : `"${item.subject}" → "${item.object}" · '${item.relationText}'`;
  if (item.op === 'remove') return `${target} 연결을 지울까요?`;
  if (item.op === 'add') return `${target} 연결을 추가할까요?`;
  return '';
}

// 카드 부제 — 왜 그렇게 하자는 것인지. 근거가 없으면 그 절을 붙이지 않는다(§0:
// 근거 없이 "고치자"고만 하면 사람이 무엇을 판단해야 하는지 알 수 없다).
function proposalContext(item) {
  if (!item) return '';
  return item.reason ? `${item.opLabel} 제안 — ${item.reason}` : `${item.opLabel} 제안`;
}

// 선택 → 실제 mutation. 거절·건너뛰기는 현재 상태를 그대로 두며 어떤 발화나 쓰기도
// 만들지 않는다. 적용도 id가 갖춰진 직접 API만 사용한다.
function proposalMutation(item, choice) {
  if (!item || choice !== 'apply') return null;
  if (item.op === 'remove' && item.relationId) {
    return { type: 'remove', payload: { relationId: item.relationId } };
  }
  if (item.op === 'add' && item.subjectId && item.objectId) {
    return {
      type: 'add',
      payload: {
        subjectId: item.subjectId,
        objectId: item.objectId,
        kind: item.relation,
        rationale: item.reason,
      },
    };
  }
  return null;
}

// 선택지 3종. 되물을 것들 카드(brain-questions.js CHOICES)와 **같은 키 힌트**를 쓴다 —
// 사람이 두 카드에서 다른 손가락을 쓰게 하면 안 된다. 라벨만 다르다: 여기서는
// 참·거짓을 확정하는 것이 아니라 제안을 받아들이거나 물리는 것이다.
const CHOICES = Object.freeze({
  apply: { label: '적용', hint: 'Ctrl Enter' },
  reject: { label: '아니다', hint: null },
  skip: { label: '건너뛰기', hint: 'Esc' },
});

const __exports = {
  OPS, isOp, normalizeProposal, proposalTitle, proposalContext, proposalMutation, CHOICES,
};

// UMD 각주(2026-08-18 렌더러 격리) — brain-questions.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.GraphEditProposal = __exports;
}

})();
