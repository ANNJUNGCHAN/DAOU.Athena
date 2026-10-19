/* Exact pure DOM builders extracted from app/canvas.js; no app runtime. */
(()=>{'use strict';
const gridEmptyEl=document.getElementById('gridEmpty');
function buildChatIllustration() {
  const wrap = document.createElement('div');
  wrap.className = 'canvas-empty-art';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '120');
  svg.setAttribute('height', '72');
  svg.setAttribute('viewBox', '0 0 120 72');
  const mk = (tag, attrs) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  // 큰 말풍선(질문) — 윤곽선 + 왼쪽 아래 꼬리
  svg.appendChild(mk('path', {
    d: 'M18 8 H74 Q84 8 84 18 V32 Q84 42 74 42 H36 L26 52 V42 H18 Q8 42 8 32 V18 Q8 8 18 8 Z',
    fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', opacity: '0.35',
  }));
  // 입력 중 점 셋 — 가운데 점이 진하다(그래프 삽화의 허브 노드와 같은 강세)
  svg.appendChild(mk('circle', { cx: '34', cy: '25', r: '3', fill: 'currentColor', opacity: '0.3' }));
  svg.appendChild(mk('circle', { cx: '46', cy: '25', r: '3.5', fill: 'currentColor', opacity: '0.55' }));
  svg.appendChild(mk('circle', { cx: '58', cy: '25', r: '3', fill: 'currentColor', opacity: '0.3' }));
  // 작은 답변 말풍선 — 오른쪽 아래, 옅게
  svg.appendChild(mk('path', {
    d: 'M78 44 H104 Q112 44 112 51 V57 Q112 64 104 64 H90 L84 70 V64 H78 Q70 64 70 57 V51 Q70 44 78 44 Z',
    fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', opacity: '0.28',
  }));
  wrap.appendChild(svg);
  return wrap;
}


function buildEmptyCanvasSkeleton() {
  if (!gridEmptyEl) return;
  gridEmptyEl.replaceChildren();
  // 대화 모드 — 상징 삽화 + 회전 문구(보드 46 v3, 2026-08-27 3차 피드백).
  // 문구는 applyEmptyCopy가 시간대·성향 풀에서 채운다.
  const chatBox = document.createElement('div');
  chatBox.className = 'canvas-empty canvas-empty-chat';
  chatBox.appendChild(buildChatIllustration());
  const chatCopy = document.createElement('div');
  chatCopy.className = 'canvas-empty-copy';
  const chatTitle = document.createElement('div');
  chatTitle.className = 'canvas-empty-title';
  const chatSub = document.createElement('div');
  chatSub.className = 'canvas-empty-sub';
  chatCopy.append(chatTitle, chatSub);
  chatBox.appendChild(chatCopy);
  // 그래프 모드 변형은 여기 없다 — 성향 축적 히어로(Paper COS-0)는 요약 표가
  // 0건일 때 그 자리에 선다(lib/graph-mode/summary-table.js renderGrowthHero).
  // 이 상자는 #mosaic 안에 있어 그래프 모드에서는 통째로 숨는다(US-007).
  gridEmptyEl.append(chatBox);
}
buildEmptyCanvasSkeleton();


const copy=window.AthenaLib.EmptyCanvas.pickEmptyCopy({seed:0});
gridEmptyEl.querySelector('.canvas-empty-title').textContent=copy.title;
gridEmptyEl.querySelector('.canvas-empty-sub').textContent=copy.sub;
gridEmptyEl.hidden=false;
const empty=document.createElement('div');empty.className='sidebar-section-label';empty.textContent='대화 이력 없음';document.getElementById('sidebarList').append(empty);
document.getElementById('sidebarModeTotal').textContent='0개 대화';
document.getElementById('modelBtn').textContent='Claude';document.getElementById('effortBtn').textContent='기본';
window.AthenaLib.GlauMascot.render(document.querySelector('.glau-composer'),'idle');
document.fonts.ready.then(()=>{document.documentElement.dataset.ready='true'});
})();