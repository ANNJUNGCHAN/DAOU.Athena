export type SceneId =
  | 'agora'
  | 'metis'
  | 'aegis'
  | 'ergane'
  | 'pallas'
  | 'glaux';
export type Pose = { x: number; y: number; zoom: number };
type CameraKey = Pose & { at: number };
type CursorKey = { at: number; x: number; y: number; click?: boolean };
type Beat = { at: number; label: string };
type Timeline = {
  duration: number;
  camera: CameraKey[];
  cursor: CursorKey[];
  beats: Beat[];
};
const wide = (at: number): CameraKey => ({ at, x: 800, y: 500, zoom: 1 });
const key = (at: number, x: number, y: number, zoom: number): CameraKey => ({
  at,
  x,
  y,
  zoom,
});
const pointer = (
  at: number,
  x: number,
  y: number,
  click = false,
): CursorKey => ({ at, x, y, click });

export function glauxState(time: number) {
  return {
    owl: time >= 3.4,
    notification: time >= 6,
    open: time >= 9,
    chat: time >= 12,
    chart: time >= 18 && time < 28,
    ticket: time >= 28,
    review: time >= 32,
    submitted: time >= 34,
  };
}

export function pallasState(time: number) {
  const phase =
    time < 6
      ? 'create'
      : time < 10
        ? 'code'
        : time < 18
          ? 'graph'
          : time < 20
            ? 'form'
            : time < 24
              ? 'running'
              : 'result';
  return {
    phase,
    result: phase === 'result',
  };
}

export const timelines: Record<SceneId, Timeline> = {
  agora: {
    duration: 64,
    camera: [
      wide(0), wide(1.5), key(3.3, 1380, 870, 2.8),
      key(7.5, 1380, 870, 2.8), key(9, 1380, 760, 2.6),
      key(10, 1380, 760, 2.6), wide(12), wide(14),
      key(15.5, 1380, 870, 2.8), key(19, 1380, 870, 2.8),
      key(20, 1380, 760, 2.6), wide(23),
      key(25, 1380, 340, 2.2), key(29, 1380, 340, 2.2),
      key(31, 1380, 550, 2.2), key(37, 1380, 550, 2.2),
      key(38, 1380, 870, 2.8), key(43, 1380, 870, 2.8),
      key(46, 740, 440, 1.5), key(50, 740, 440, 1.5),
      key(52, 740, 600, 1.5), key(60, 740, 600, 1.5),
      wide(62), wide(64),
    ],
    cursor: [
      pointer(0, 840, 580), pointer(2.7, 1300, 914),
      pointer(3.2, 1300, 914, true), pointer(6.7, 1300, 914),
      pointer(7.5, 1550, 918, true), pointer(8.1, 1550, 918),
      pointer(12, 800, 500), pointer(15.4, 1290, 914, true),
      pointer(18.1, 1290, 914), pointer(19, 1550, 918, true),
      pointer(19.6, 1550, 918), pointer(25, 1520, 740),
      pointer(38, 1290, 914, true), pointer(42.5, 1290, 914),
      pointer(43, 1550, 918, true), pointer(43.5, 1550, 918),
      pointer(47, 950, 440), pointer(50, 560, 275, true),
      pointer(50.5, 560, 275), pointer(54, 650, 600),
      pointer(59, 1030, 700), pointer(63, 1110, 800),
    ],
    beats: [
      { at: 0, label: '대화에서 시작하기' },
      { at: 3, label: '삼성전자 지금 주가 어때?' },
      { at: 7.5, label: '전송 버튼 클릭' },
      { at: 8, label: '답변 중…' },
      { at: 10.5, label: '삼성전자 캔들 차트 · 설명용 데이터' },
      { at: 15, label: '차트 추세를 보고 이어서 질문' },
      { at: 19, label: '매수 판단에 필요한 조건 살펴보기' },
      { at: 21.5, label: '상승 흐름과 조정 위험을 함께 · 예시 분석' },
      { at: 38, label: '최근 공시 분석을 대화로 요청' },
      { at: 43, label: '공시 내용을 살펴보는 흐름' },
      { at: 46, label: '공시 표에서 확인할 자료 찾기' },
      { at: 50, label: '실적 발표 행을 눌러 원문 열기' },
      { at: 52, label: '공시 원문을 읽고 분석과 연결하기' },
      { at: 62, label: '차트에서 공시까지, 이어지는 투자 질문' },
    ],
  },
  metis: {
    duration: 30,
    camera: [
      wide(0),
      wide(2),
      key(4, 850, 670, 2.1),
      key(9, 850, 670, 2.1),
      key(12, 1380, 755, 2.6),
      key(20, 1380, 755, 2.6),
      key(23, 840, 600, 1.8),
      wide(26),
      wide(30),
    ],
    cursor: [
      pointer(0, 1150, 600),
      pointer(5, 930, 746, true),
      pointer(11, 1240, 737),
      pointer(15, 1300, 913, true),
      pointer(20.5, 1550, 918, true),
      pointer(22, 923, 746),
      pointer(27, 1100, 800),
    ],
    beats: [
      { at: 0, label: '투자 관심사의 연결 지도' },
      { at: 4, label: '삼성전자 노드 살펴보기' },
      { at: 9, label: '근거와 관계를 따라가기' },
      { at: 12, label: '확인이 필요한 연결' },
      { at: 16, label: '내 생각을 직접 확인' },
      { at: 22, label: '확인한 관계를 다시 보기' },
      { at: 26, label: '나의 투자 맥락이 담긴 그래프' },
    ],
  },
  aegis: {
    duration: 30,
    camera: [
      wide(0),
      wide(2),
      key(4, 475, 280, 2.2),
      key(7, 850, 390, 2.1),
      key(11, 850, 390, 2.1),
      key(13, 885, 510, 2.4),
      key(18, 885, 565, 2.4),
      key(22, 1380, 650, 2.2),
      wide(26),
      wide(30),
    ],
    cursor: [
      pointer(0, 850, 700),
      pointer(5, 467, 280, true),
      pointer(10, 936, 426),
      pointer(15, 882, 508),
      pointer(19, 1090, 608, true),
      pointer(25, 1260, 670),
    ],
    beats: [
      { at: 0, label: '내가 정한 루틴 확인' },
      { at: 4, label: '반도체 주요 뉴스 살펴보기' },
      { at: 8, label: '조건과 확인 주기 읽기' },
      { at: 13, label: '언제, 왜 실행됐는지 확인' },
      { at: 19, label: '채팅에서 관련 작업 열기' },
      { at: 26, label: '루틴과 근거를 한눈에' },
    ],
  },
  ergane: {
    duration: 30,
    camera: [
      wide(0),
      wide(2),
      key(4, 940, 170, 1.65),
      key(5, 940, 170, 1.65),
      key(7, 735, 435, 1.35),
      key(9, 735, 450, 1.65),
      key(14.5, 735, 450, 1.65),
      key(17, 850, 560, 1.65),
      key(21, 850, 560, 1.65),
      wide(25),
      wide(30),
    ],
    cursor: [
      pointer(0, 860, 700),
      pointer(5, 1100, 143, true),
      pointer(10, 1020, 419, true),
      pointer(14, 1020, 479, true),
      pointer(19, 1107, 624, true),
      pointer(26, 1150, 760),
    ],
    beats: [
      { at: 0, label: '작업 공간에 연결된 도구' },
      { at: 4, label: '공시 도구의 권한 열기' },
      { at: 8, label: '필요한 기능만 선택' },
      { at: 14, label: '허용할 기능 검토' },
      { at: 19, label: '선택 저장 · 승인 초안 준비' },
      { at: 25, label: '권한은 승인 카드에서 확정' },
    ],
  },
  pallas: {
    duration: 29,
    camera: [
      wide(0),
      key(1, 1380, 865, 2.5),
      key(4, 1380, 865, 2.5),
      key(5, 740, 540, 1.6),
      key(8, 740, 500, 1.5),
      wide(10),
      key(12, 860, 520, 1.7),
      key(13, 965, 515, 2),
      key(14, 1380, 865, 2.5),
      key(16, 1380, 865, 2.5),
      key(17.5, 965, 515, 2),
      key(19, 750, 570, 1.5),
      key(20, 1070, 702, 2),
      key(22, 820, 700, 1.6),
      key(25, 750, 470, 1.5),
      wide(28),
      wide(29),
    ],
    cursor: [
      pointer(0, 820, 650),
      pointer(0.7, 1300, 914, true),
      pointer(4, 1550, 918, true),
      pointer(5.3, 442, 642, true),
      pointer(10, 421, 220, true),
      pointer(13, 965, 500, true),
      pointer(13.5, 1300, 914, true),
      pointer(16, 1550, 918, true),
      pointer(18, 495, 220, true),
      pointer(20, 1070, 702, true),
      pointer(24, 382, 165, true),
    ],
    beats: [
      { at: 0, label: '대화로 나만의 퀀트 전략 만들기' },
      { at: 4, label: '질문에 답하며 전략 구체화' },
      { at: 6, label: '코드 생성 · 자동 검사' },
      { at: 10, label: '진입·청산을 함수별 흐름으로 확인' },
      { at: 13, label: '노드를 선택해 대화로 수정' },
      { at: 18, label: '기간과 비용 가정 확인' },
      { at: 20, label: '백테스트 · 체결 시뮬레이션' },
      { at: 24, label: '자산 곡선과 체결 내역 확인' },
      { at: 28, label: '가정과 백테스트 결과를 함께 검토' },
    ],
  },
  glaux: {
    duration: 40,
    camera: [
      wide(0),
      key(2, 1370, 150, 1.8),
      wide(4),
      wide(5),
      key(7, 1468, 858, 2.8),
      key(9, 1310, 760, 2.1),
      key(11, 1310, 760, 2.1),
      key(13, 1310, 865, 2.7),
      key(16, 1310, 865, 2.7),
      key(19, 1310, 610, 2.2),
      key(22, 1310, 610, 2.2),
      key(24, 1310, 865, 2.7),
      key(26, 1310, 865, 2.7),
      key(29, 1310, 610, 2.2),
      key(32, 1310, 712, 2.2),
      key(34, 1310, 712, 2.2),
      key(36, 1310, 610, 2.2),
      wide(38),
      wide(40),
    ],
    cursor: [
      pointer(0, 870, 600),
      pointer(2.8, 1386, 88, true),
      pointer(5, 620, 470),
      pointer(9, 1468, 858, true),
      pointer(12, 1310, 864, true),
      pointer(12.5, 1280, 856, true),
      pointer(16, 1481, 857, true),
      pointer(21, 1310, 580),
      pointer(23, 1280, 856, true),
      pointer(26, 1481, 857, true),
      pointer(32, 1310, 712, true),
      pointer(34, 1310, 712, true),
      pointer(38, 970, 740),
    ],
    beats: [
      { at: 0, label: 'ATHENA 창을 내려두고' },
      { at: 4, label: '엑셀 작업 중에도 곁에 있는 알림 오브' },
      { at: 6, label: '작은 알림에서 시작되는 대화' },
      { at: 9, label: '알림을 눌러 내용 확인' },
      { at: 12, label: '그 자리에서 차트 물어보기' },
      { at: 18, label: '미니 카드로 가격 흐름 확인' },
      { at: 23, label: '대화로 주문 준비' },
      { at: 28, label: '종목·수량·계좌를 한눈에 검토' },
      { at: 32, label: '주문 내용을 확인하고 직접 실행' },
      { at: 34, label: '미니 창에서 주문 결과까지 · 모의 시연' },
      { at: 38, label: '작은 창으로 이어가는 나의 투자' },
    ],
  },
};

export function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}
function interpolate<T extends { at: number; x: number; y: number }>(
  keys: T[],
  time: number,
) {
  let left = keys[0],
    right = keys[keys.length - 1];
  for (let i = 1; i < keys.length; i++) {
    if (time < keys[i].at) {
      left = keys[i - 1];
      right = keys[i];
      break;
    }
    left = keys[i];
  }
  const raw = clamp((time - left.at) / (right.at - left.at || 1));
  const ease = raw * raw * (3 - 2 * raw);
  return {
    left,
    right,
    ease,
    x: left.x + (right.x - left.x) * ease,
    y: left.y + (right.y - left.y) * ease,
  };
}
export function cameraAt(id: SceneId, time: number): Pose {
  const v = interpolate(timelines[id].camera, time);
  return {
    x: v.x,
    y: v.y,
    zoom: v.left.zoom + (v.right.zoom - v.left.zoom) * v.ease,
  };
}
export function cursorAt(id: SceneId, time: number) {
  const v = interpolate(timelines[id].cursor, time);
  const gap = v.right.at - v.left.at;
  const travel = Math.min(0.32, gap);
  const arrival = v.right.at - Math.min(0.1, (gap - travel) / 2);
  const progress = clamp((time - arrival + travel) / (travel || 1));
  const ease = progress * progress * (3 - 2 * progress);
  return {
    x: v.left.x + (v.right.x - v.left.x) * ease,
    y: v.left.y + (v.right.y - v.left.y) * ease,
    click: timelines[id].cursor.some(
      (k) => k.click && time >= k.at && time < k.at + 0.45,
    ),
  };
}
export function beatAt(id: SceneId, time: number) {
  return (
    timelines[id].beats.filter((b) => b.at <= time).at(-1)?.label ||
    timelines[id].beats[0].label
  );
}
export function typedAt(
  text: string,
  time: number,
  start: number,
  end: number,
) {
  return text.slice(
    0,
    Math.floor(text.length * clamp((time - start) / (end - start))),
  );
}
export function agoraState(time: number) {
  return {
    firstSent: time >= 7.5,
    firstChart: time >= 10.5,
    trendSent: time >= 19,
    trendAnalysis: time >= 21.5,
    disclosureSent: time >= 43,
    disclosures: time >= 46,
    disclosureSelected: time >= 50,
    disclosureReader: time >= 52,
    active: '삼성전자',
    thinking: (time >= 7.5 && time < 10.5) || (time >= 19 && time < 21.5) || (time >= 43 && time < 46),
  };
}
