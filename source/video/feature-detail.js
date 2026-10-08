/*
 * V22: deterministic, source-based UI reconstruction, not a backend session.
 * Read-only sources: app/lib/plugin-{canvas,catalog}.js; homepage product-page-copy,
 * ergane/aegis examples and lib/agora-filings.ts (fixed 2026-09-10 snapshot).
 * Registration and permissions stop at review/draft. No message or routine is sent.
 */
(function () {
  'use strict';
  const supported = new Set(['plugin-invest', 'plugin-service', 'plugin-call',
    'alert-personal', 'alert-automation', 'alert-watch']);
  const clamp = n => Math.max(0, Math.min(1, n));
  const snippet = '{\n  "mcpServers": {\n    "fetch": { "command": "uvx",\n      "args": ["mcp-server-fetch"] }\n  }\n}';

  window.renderFeatureDetail = function (f, u, h) {
    if (!supported.has(f.id)) return null;
    const { btn, bubble, frame, esc } = h;
    const duration = f.range[1] - f.range[0];
    const p = clamp(u / duration);
    const typed = (s, a = 0, b = .31) => s.slice(0, Math.floor(s.length * clamp((p - a) / (b - a))));
    const small = (s, style = '') => `<div class="muted" style="font-size:21px;line-height:1.45;${style}">${s}</div>`;
    const pill = (s, on = false) => `<span class="pill ${on ? 'on' : ''}" style="font-size:20px;padding:8px 12px">${s}</span>`;
    const item = (id, title, sub, selected = false, tail = '', compact = false) => `<div id="${id}" class="item ${selected ? 'selected' : ''}" style="font-size:25px;padding:${compact ? '10px 15px' : '16px 19px'};margin-bottom:${compact ? '8px' : '12px'}"><div style="display:flex;align-items:center;justify-content:space-between;gap:15px"><span>${title}</span>${tail}</div>${sub ? small(sub, `margin-top:${compact ? '3px' : '7px'}`) : ''}</div>`;
    const toggle = (id, label, on, detail = '') => `<div class="row" style="justify-content:space-between;margin:5px 0;padding:7px 0;border-bottom:1px solid #e6e8ed"><div style="font-size:24px">${label}${detail ? small(detail, 'font-size:18px;margin-top:3px') : ''}</div><button id="${id}" class="switch ${on ? 'on' : ''}" style="border:0;flex-shrink:0" aria-label="${esc(label)}" aria-pressed="${on}"></button></div>`;
    const fld = (label, value, id) => `<label style="display:block;font-size:21px;color:#5b6270">${label}<input id="${id}" readonly value="${esc(value)}" style="display:block;width:100%;margin-top:9px;border:1px solid #d9dde5;border-radius:13px;background:#fafbfc;color:#14171d;font:25px Daki;padding:15px 17px"></label>`;
    const tabs = active => `<div class="row" style="gap:9px;margin:0 0 22px">${['작업', '알람', '라이브', '제안'].map(x => pill(x, x === active)).join('')}</div>`;
    const pluginTabs = active => `<div class="row" style="margin:0 0 20px">${['설치됨', '추천', '관리'].map(x => pill(x, x === active)).join('')}</div>`;
    let main = '', chat = '', input = '', menu = '', target = 'prompt';
    let op = p >= .31, res = p >= .64, entered = false, clickAt = .31;

    if (f.id === 'plugin-invest') {
      // The snippet is pasted once, not rapidly typed as a long question.
      const pasted = p >= .22;
      op = p >= .48; res = p >= .60; clickAt = .48;
      target = p < .22 ? 'plugin-snippet' : 'plugin-register-proposal';
      main = frame('플러그인', pluginTabs('설치됨') +
        `<div style="display:grid;grid-template-columns:1fr 1.12fr;gap:20px">` +
        `<div>${item('stock-tool', '한국 주식 시세', '종목 검색 · 시세 · 시총 · 배당', false, pill('권한'), true)}` +
        `<div class="receipt" style="margin-top:0;padding:15px"><h2 style="font-size:25px;margin:0 0 5px">권한 초안</h2>${small('승인 카드로 확정합니다')}` +
        toggle('stock-search', '종목 검색', true, 'search_stock_code') +
        toggle('stock-price', '현재가 조회', true, 'get_stock_price_by_code') +
        toggle('stock-dividend', '배당 상위 조회', false, 'get_dividend_yield_stocks') +
        `<div class="row" style="justify-content:space-between;margin:9px 0 0">${small('허용 2 / 6')}${btn('permission-save', '선택 저장')}</div></div>` +
        `</div><section class="receipt" style="margin-top:0;padding:18px;background:#fff"><h2 style="font-size:28px;margin-bottom:12px">서버 직접 등록</h2>` +
        small('Claude 설정 형식의 서버 한 개를 붙여넣습니다.') +
        `<textarea id="plugin-snippet" readonly aria-label="서버 스니펫" class="code" style="resize:none;width:100%;height:204px;padding:14px;margin:12px 0;font-size:19px;line-height:1.45;border:1px solid ${pasted ? '#ee137b' : '#d9dde5'}">${pasted ? esc(snippet) : ''}</textarea>` +
        `<div class="notice" style="font-size:20px;padding:12px">등록만으로는 실행되지 않습니다.</div>` +
        `<div class="actions" style="margin-top:12px">${btn('plugin-register-proposal', '등록 제안', pasted)}</div></section></div>`);
      chat = `<div class="chips">${pill('도구 연결')}</div>${small('공시·리서치 원문을 읽는 도구를 추가합니다.', 'margin-bottom:20px')}`;
      if (op) chat += `<div class="receipt" style="margin-top:0"><div class="row" style="margin-top:0;font-size:22px"><b>직접 등록</b>${pill('제안 대기', true)}</div><h2 style="margin-bottom:13px">웹 문서 읽기</h2><div class="code" style="font-size:19px;padding:16px;line-height:1.45">uvx mcp-server-fetch</div>${small('등록 후에도 켜기와 권한 변경을 검토합니다.', 'margin-top:15px')}<div class="actions">${btn('registration-reject', '거부')}${btn('registration-approve', '승인', true)}</div></div>`;
      else chat += `<div class="notice">서버 설정을 붙여넣고<br>등록 제안을 검토하세요.</div>`;
    }

    if (f.id === 'plugin-service') {
      op = p >= .28; res = p >= .63; clickAt = .28;
      const submitted = p >= .57;
      target = 'service-discord'; entered = submitted;
      input = submitted ? '' : typed('결과 보내줘', .29, .55);
      main = frame('플러그인', pluginTabs('관리') +
        `<div style="display:grid;grid-template-columns:.77fr 1.23fr;gap:22px"><div>` +
        item('service-discord', 'Discord', '분석 결과를 대화 채널로', op, pill('연동')) +
        item('service-telegram', 'Telegram', '메신저에서 확인') +
        item('service-slack', 'Slack', '팀의 업무 공간으로') +
        `<div class="notice" style="font-size:20px">연결과 사용 권한은<br>등록된 서버에서 관리합니다.</div></div>` +
        `<section class="receipt" style="margin:0;padding:23px;min-height:505px"><div class="row" style="margin-top:0;font-size:23px;justify-content:space-between"><b>Discord</b>${pill(res ? '전송 문안' : '서비스 연동')}</div>` +
        `${op ? `<div class="chips">${pill('@discord', true)}</div><h2 style="font-size:29px;line-height:1.4;margin:24px 0">삼성전자 공시 분석</h2>` : `<div style="height:110px"></div>`}` +
        `${res ? `<div class="item" style="font-size:24px;line-height:1.6;padding:20px;background:#f8f9fb">반기보고서 · 사업과 재무<br><br>자기주식 취득 · 실행 계획<br><br>주주환원 · 이후 결정 확인</div>${small('공시 분석을 메신저에서도 이어서 확인', 'margin-top:20px')}` : `<div class="notice">분석 결과가 이어질<br>서비스를 선택합니다.</div>`}` +
        `</section></div>`);
      chat = `<div class="chips">${pill('삼성전자 공시')}</div>`;
      if (op) chat += `<div class="chips">${pill('@discord', true)}</div>`;
      if (submitted) chat += bubble('결과 보내줘', true);
      if (res) chat += `<div class="notice" style="margin-top:18px">전송 문안 준비<br><span style="font-size:19px">홈페이지의 서비스 연동 시연 예시</span></div>`;
    }

    if (f.id === 'plugin-call') {
      const selected = p >= .23, submitted = p >= .50;
      op = selected; res = p >= .64; entered = submitted;
      target = selected ? 'prompt' : 'mention-dart'; clickAt = selected ? .50 : .23;
      input = submitted ? '' : selected ? typed('최근 공시 찾아줘', .23, .49) : '@';
      menu = !selected ? `<div class="menu"><h3>호출할 플러그인</h3>${btn('mention-dart', '@dart-disclosure', true)}${small('기존에 승인된 공시 도구')}</div>` : '';
      const rows = [
        ['2026.08.14', '반기보고서 (제58기)', '사업·재무 현황'],
        ['2026.08.21', '자기주식 취득 결정', '임직원 주식보상 계획'],
        ['2026.08.21', '주주환원 규모·실행 계획', '향후 결정 일정'],
      ];
      main = frame('플러그인', pluginTabs('설치됨') +
        item('dart-tool', 'dart-disclosure', '기존 승인된 도구 · 공시 조회', selected, pill('@ 호출', selected)) +
        `<div class="receipt" style="padding:23px;min-height:470px"><div class="row" style="margin-top:0;justify-content:space-between;font-size:27px"><b>삼성전자 공시</b>${pill(res ? '조회 자료' : '공시 목록')}</div>` +
        `${res ? `<table class="table" style="font-size:23px"><thead><tr><th>일자</th><th>문서</th><th>내용</th></tr></thead><tbody>${rows.map((r, i) => `<tr id="filing-${i}">${r.map(x => `<td style="padding:18px 10px">${x}</td>`).join('')}</tr>`).join('')}</tbody></table>${small('2026.09.10 확인 · 홈페이지에 수록된 공식 문서', 'margin-top:23px')}` : `<div class="notice" style="margin-top:30px">@로 사용할 도구를 지정하면<br>같은 대화에서 자료를 가져옵니다.</div>`}` + `</div>`);
      chat = selected ? `<div class="chips">${pill('@dart-disclosure', true)}</div>` : '';
      if (submitted) chat += bubble('최근 공시 찾아줘', true);
      if (res) chat += `<div class="receipt" style="font-size:23px;line-height:1.55">공식 자료 세 건을 모았어요.<br><br>반기보고서의 실적과<br>이후 공시의 계획을<br>구분해 읽어보세요.</div>`;
    }

    if (f.id === 'alert-personal') {
      op = p >= .31; res = p >= .56; clickAt = .31; target = 'personal-proposal';
      main = frame('알림', tabs('제안') +
        `<div class="notice" style="margin-bottom:12px;padding:12px 18px"><b style="color:#14171d">최근의 관심</b><div class="row" style="margin-bottom:0;gap:8px">${pill('반도체 대형주')}${pill('배당 방어')}${pill('단기 회전')}</div></div>` +
        `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">` + item('personal-proposal', '장 마감 후 손익 요약 루틴', '최근 관심과 대화에서 발견한 제안', op, pill('제안', true)) +
        item('personal-dividend', '배당주 뉴스 아침 감시', '자주 살펴본 주제에서 이어서') + `</div>` +
        `<div class="receipt" style="min-height:205px;padding:18px;margin-top:8px">${op ? `<h2 style="font-size:28px;margin-bottom:10px">왜 이 알림을 제안했나요?</h2><div style="font-size:26px;line-height:1.4">최근 관심 종목과<br>장 마감 후 이어진 대화를 참고했어요.</div>${res ? `<div class="actions">${btn('personal-hold', '보류')}${btn('personal-routine', '루틴으로', true)}</div>` : ''}` : `<h2 style="font-size:28px">내 관심과 연결된 변화</h2>${small('알림을 열어 제안의 근거를 확인합니다.')}`}</div>`);
      chat = `<div class="chips">${pill('관심 기반 제안')}</div>${small('내가 살펴본 종목과 대화를 함께 참고합니다.', 'margin-bottom:22px')}`;
      if (op) chat += bubble('이 제안의 근거를 보여줘', true);
      if (res) chat += `<div class="receipt" style="font-size:24px;line-height:1.55"><b>관심 · 대화 · 자료</b><div style="margin-top:20px">일봉 차트<br>DART 재무제표<br>관련 뉴스</div></div>`;
    }

    if (f.id === 'alert-automation') {
      op = p >= .35; res = p >= .64; entered = op; clickAt = .35; target = 'prompt';
      input = op ? '' : typed('아침 7시반 브리핑');
      main = frame('알림', tabs('작업') +
        item('routine-existing', '장 마감 후 손익 요약 루틴', '앞서 살펴본 제안 · 검토 대기', false, pill('제안')) +
        `<section class="receipt" style="margin-top:16px;padding:25px"><div class="row" style="margin:0 0 24px;justify-content:space-between;font-size:29px"><b>평일 아침 브리핑</b>${pill('설정 초안', true)}</div>` +
        `<div style="display:grid;grid-template-columns:1fr 1fr;gap:23px 20px">` +
        fld('모드', op ? '예약' : '', 'routine-mode') +
        fld('일정', op ? '평일 · 07:30' : '', 'routine-schedule') +
        fld('소스', p >= .49 ? '시계 · 캘린더' : '', 'routine-source') +
        fld('폴링', p >= .49 ? '300초' : '', 'routine-poll') +
        `</div><div style="margin-top:24px">${fld('작업', res ? '뉴스 · 공시 · 개장 브리핑' : '', 'routine-task')}</div>` +
        `<div class="actions" style="margin-top:25px">${btn('routine-chat', '채팅에서 고치기')}${btn('routine-save', '저장', res)}</div></section>`);
      chat = `<div class="chips">${pill('새 자동화')}</div>`;
      if (op) chat += bubble('아침 7시반 브리핑', true);
      if (res) chat += `<div class="receipt" style="font-size:25px;line-height:1.6">평일 07:30에<br>살펴볼 작업을 준비했어요.<div class="notice" style="margin-top:20px;font-size:21px">일정과 자료를 검토한 뒤<br>저장하세요.</div></div>`;
    }

    if (f.id === 'alert-watch') {
      op = p >= .34; res = p >= .62; clickAt = .34; target = 'watch-source-news';
      main = frame('알림', tabs('작업') +
        `<div class="row" style="justify-content:space-between;margin:0 0 16px;font-size:28px"><b>평일 아침 브리핑</b>${pill('정보원 선택', true)}</div>` +
        `<div style="display:grid;grid-template-columns:1.1fr .9fr;gap:22px"><section class="receipt" style="margin:0;padding:18px"><h2 style="font-size:28px;margin-bottom:15px">함께 살펴볼 정보</h2>` +
        item('watch-source-price', '현재가 · 실시간 체결가', 'Kiwoom REST · 내장 API', true, '<span class="switch on"></span>', true) +
        item('watch-source-dart', '공시 · 재무제표', '등록된 MCP 플러그인', true, '<span class="switch on"></span>', true) +
        item('watch-source-news', '관련 뉴스', '등록된 MCP 플러그인', op, `<span class="switch ${op ? 'on' : ''}"></span>`, true) +
        `<div class="notice" style="font-size:21px;margin-top:10px;padding:12px">내장 시세와 플러그인 정보원을<br>함께 검토합니다.</div></section>` +
        `<section class="receipt" style="margin:0;padding:23px"><h2 style="font-size:28px">감시 설정</h2>${fld('종목', '삼성전자 · 005930', 'watch-symbol')}<div id="watch-schedule" style="margin-top:23px;font-size:25px;line-height:1.5">${small('일정')}평일 · 07:30</div><div style="margin-top:25px;font-size:22px;color:#5b6270">선택한 정보원</div><div class="row" style="gap:8px;flex-wrap:wrap;margin-top:13px">${pill('시세')}${pill('공시')}${op ? pill('뉴스', true) : ''}</div>${res ? `<div class="actions" style="margin-top:24px">${btn('watch-review', '설정 검토', true)}</div>` : ''}</section></div>`);
      chat = `<div class="chips">${pill('통합 감시')}</div>${bubble('시세와 뉴스도 함께', true)}`;
      if (op) chat += `<div class="receipt" style="font-size:24px;line-height:1.6">현재가 · 공시 · 뉴스<div class="row" style="flex-wrap:wrap;margin-top:20px">${pill('REST')}${pill('MCP')}</div></div>`;
      if (res) chat += `<div class="notice" style="margin-top:19px;font-size:22px">선택한 정보원을<br>설정에 모았어요.</div>`;
    }

    return { main, chat, input, menu, target, p, op, res, entered, clickAt };
  };
})();
