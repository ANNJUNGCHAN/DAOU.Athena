import { ArrowUp, Check } from 'lucide-react';
import { clamp, pallasState, typedAt } from '@/lib/cinematic-timeline';
import './pallas-walkthrough.css';

const firstAsk = '20일 고점을 돌파하면 진입하는 전략을 만들어줘';
const editAsk = '손절 기준을 ATR 2배로 바꿔줘';
const nodes = [
  [
    'compute_atr()',
    '지표',
    '최근 14봉의 변동폭을 계산합니다',
    'df, n → Series',
    'L10–13',
  ],
  [
    'breakout_level()',
    '진입',
    '직전 20봉의 최고가를 찾습니다',
    'df, lookback → Series',
    'L15–17',
  ],
  [
    'should_enter()',
    '진입',
    '종가가 돌파선을 넘었는지 확인합니다',
    'df, i, atr → bool',
    'L19–24',
  ],
  [
    'position_size()',
    '수량',
    '위험 한도에 맞춰 수량을 계산합니다',
    'cash, atr → int',
    'L36–41',
  ],
  [
    'compute_atr()',
    '재사용',
    '진입 흐름의 ATR 값을 다시 사용합니다',
    'df, n → Series',
    'L10–13',
  ],
  [
    'should_exit()',
    '청산',
    'ATR 1.5배 아래로 내려오면 청산합니다',
    'df, i, entry, atr → bool',
    'L26–34',
  ],
];

function StrategyGraph({ time }: { time: number }) {
  return (
    <div className="pw-graph">
      <aside className="pw-node-rail">
        <strong>이 기법의 노드 5개</strong>
        {nodes
          .slice(0, 4)
          .concat([nodes[5]])
          .map((n) => (
            <div
              key={n[0]}
              className={
                time >= 13 && n[0] === 'should_exit()' ? 'selected' : ''
              }
            >
              {n[0]}
              <small>{n[4]}</small>
            </div>
          ))}
        <p>노드를 눌러 대화에 참조하세요.</p>
      </aside>
      <div className="pw-lanes">
        <div className="pw-lane-title">
          진입 흐름 <small>봉이 닫힐 때마다</small>
        </div>
        <div className="pw-lane-title">
          청산 흐름 <small>보유 중일 때</small>
        </div>
        <svg className="pw-edges" viewBox="0 0 580 620" fill="none">
          <path
            d="M135 92V505 M435 92V245 M135 92H435"
            stroke="#c7ccd8"
            strokeWidth="2"
            strokeDasharray="5 5"
          />
        </svg>
        {nodes.map((n, i) => (
          <div
            key={i}
            className={`pw-node ${i === 4 ? 'ghost' : ''} ${i === 5 && time >= 13 ? 'selected' : ''}`}
            style={{
              left: i < 4 ? 10 : 304,
              top: 46 + (i < 4 ? i : i - 4) * 135,
              opacity: clamp((time - 10 - i * 0.12) * 4),
            }}
          >
            <header>
              <strong>{n[0]}</strong>
              <span>{n[1]}</span>
            </header>
            <p>
              {i === 5 && time >= 17.5
                ? 'ATR 2배 아래로 내려오면 청산합니다'
                : n[2]}
            </p>
            <footer>
              <code>{n[3]}</code>
              <small>{n[4]}</small>
            </footer>
            {i === 5 && time >= 13 && (
              <em>
                {time < 17.5 ? '@참조에 추가됨' : '✓ 코드와 흐름 업데이트'}
              </em>
            )}
          </div>
        ))}
        <div className="pw-graph-note">
          코드에서 추출한 흐름 · 노드 선택 → 대화로 수정
        </div>
      </div>
    </div>
  );
}

function Result({ time }: { time: number }) {
  const progress = clamp((time - 24) / 2.2);
  return (
    <div className="pw-result pw-enter">
      <div className="pw-section-title">
        백테스트 결과 <span>설명용 데이터</span>
      </div>
      <div className="pw-metrics">
        {[
          ['총수익률', '+12.4%'],
          ['최대 낙폭', '−8.2%'],
          ['승률', '46.2%'],
          ['거래 수', '26건'],
        ].map(([label, value]) => (
          <div key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="pw-chart">
        <header>
          자산 곡선 <small>전략　·　매수 후 보유</small>
        </header>
        <svg viewBox="0 0 780 270" fill="none">
          <path
            d="M10 50H770 M10 105H770 M10 160H770 M10 215H770"
            stroke="#edf0f5"
          />
          <path
            d="M10 210L60 218L100 194L150 202L200 157L240 171L300 138L350 180L395 163L450 113L500 127L560 90L610 105L660 67L715 81L770 42"
            stroke="#6a62b2"
            strokeWidth="3"
            pathLength="1"
            strokeDasharray="1"
            strokeDashoffset={1 - progress}
          />
          <path
            d="M10 210L90 219L175 181L270 194L365 207L470 172L570 161L665 152L770 138"
            stroke="#b6becd"
            strokeWidth="2"
            pathLength="1"
            strokeDasharray="1"
            strokeDashoffset={1 - progress}
          />
        </svg>
        <footer>
          2023.01 <span>2025.12</span>
        </footer>
      </div>
      <div className="pw-trades">
        <header>
          체결 내역 <small>종가 신호 · 다음 봉 시가 체결</small>
        </header>
        {[
          ['삼성전자', '매수', '2025.09.02'],
          ['삼성전자', '매도', '2025.09.19'],
        ].map((r, i) => (
          <div key={i}>
            <span>{r[0]}</span>
            <b>{r[1]}</b>
            <span>{r[2]}</span>
            <small>설명용 체결</small>
          </div>
        ))}
      </div>
      <div className="pw-footnote">
        수수료·슬리피지 반영 예시 · 실제 성과를 의미하지 않습니다
      </div>
    </div>
  );
}

export function PallasWalkthrough({ time }: { time: number }) {
  const s = pallasState(time);
  const text =
    time < 4
      ? typedAt(firstAsk, time, 0.7, 3.8)
      : time >= 13.5 && time < 16
        ? typedAt(editAsk, time, 13.5, 15.8)
        : '';
  const answer =
    time < 4
      ? ''
      : time < 6
        ? '청산 기준은 어떻게 정할까요?'
        : time < 10
          ? '진입·청산·수량 규칙을 만들고 검사하고 있어요.'
          : time < 13
            ? '함수별 노드에서 전략의 흐름을 확인해보세요.'
            : time < 16
              ? '선택한 노드가 대화에 연결됐어요.'
              : time < 17.5
                ? '손절 기준을 수정하고 다시 검사하고 있어요.'
                : time < 18
                  ? '손절 기준을 수정하고 다시 검사했어요.'
                  : time < 24
                    ? '기간과 비용 가정을 확인한 뒤 백테스트를 실행합니다.'
                    : '결과와 체결 내역을 함께 살펴보세요.';
  return (
    <>
      <div className="cm-technique pw-workspace">
        <div className="pw-breadcrumb">
          ‹ 기법 홈 <span>내 전략 / 20일 돌파 전략</span>
          <b>시연 · 모의 데이터</b>
        </div>
        <div className="cm-technique-header">
          20일 돌파 전략 <small>{time < 17.5 ? 'v1' : 'v2'} · 삼성전자</small>
        </div>
        <div className="pw-main-tabs">
          <b className={!s.result ? 'active' : ''}>기법</b>
          <b className={s.result ? 'active' : ''}>결과</b>
          <b>이력</b>
          <b>최적화</b>
        </div>
        {!s.result && (
          <div className="cm-technique-tabs">
            <b className={s.phase === 'code' ? 'active' : ''}>코드</b>
            <b className={s.phase === 'graph' ? 'active' : ''}>노드·흐름</b>
            <b
              className={
                s.phase === 'form' || s.phase === 'running' ? 'active' : ''
              }
            >
              폼
            </b>
          </div>
        )}
        {s.phase === 'create' && (
          <div className="pw-create">
            <span>나만의 퀀트 전략</span>
            <h3>어떤 전략을 만들까요?</h3>
            <p>아이디어를 말하면 코드와 흐름으로 구체화합니다.</p>
            {time >= 4 && (
              <div className="pw-choice">
                <strong>청산 기준을 선택해주세요</strong>
                <div>
                  <b className={time >= 5.3 ? 'selected' : ''}>ATR 기준 손절</b>
                  <b>이동평균 이탈</b>
                </div>
              </div>
            )}
          </div>
        )}
        {s.phase === 'code' && (
          <div className="pw-code pw-enter">
            <header>
              breakout.py <small>코드 생성 → 자동 검사</small>
            </header>
            <pre>
              {typedAt(
                'def signals(df, p):\n    atr = compute_atr(df, p["atr_period"])\n    level = breakout_level(df, p["lookback"])\n\n    entry = should_enter(df, level, atr)\n    exit = should_exit(df, atr, p["stop_atr"])\n    size = position_size(p["cash"], atr)\n\n    return {"entry": entry, "exit": exit, "size": size}',
                time,
                6,
                8.4,
              )}
            </pre>
            <div className="pw-checks">
              {['문법', '계약', '시험 실행', '룩어헤드', '워밍업'].map(
                (v, i) => (
                  <span
                    key={v}
                    style={{ opacity: clamp((time - 8 - i * 0.17) * 5) }}
                  >
                    <Check size={14} />
                    {v}
                  </span>
                ),
              )}
            </div>
          </div>
        )}
        {s.phase === 'graph' && <StrategyGraph time={time} />}
        {(s.phase === 'form' || s.phase === 'running') && (
          <div className="pw-form pw-enter">
            <div className="pw-section-title">
              백테스트 설정 <span>보유 데이터 사용</span>
            </div>
            <div className="pw-fields">
              {[
                ['종목', '삼성전자 · 005930'],
                ['기간', '2023.01.02 — 2025.12.30'],
                ['초기 자금', '10,000,000원'],
                ['수수료 / 슬리피지', '0.015% / 0.05%'],
                ['돌파 기간', '20봉'],
                ['손절 기준', 'ATR × 2.0'],
              ].map(([k, v]) => (
                <div key={k}>
                  <small>{k}</small>
                  <strong>{v}</strong>
                </div>
              ))}
            </div>
            <div className="pw-run-button">
              {s.phase === 'running' ? '백테스트 실행 중…' : '백테스트 실행'}
            </div>
            {s.phase === 'running' && (
              <div className="pw-running">
                <span style={{ width: `${clamp((time - 20) / 4) * 100}%` }} />
                <p>데이터 확인 → 신호 계산 → 체결 시뮬레이션</p>
                <strong>{Math.floor(clamp((time - 20) / 4) * 100)}%</strong>
              </div>
            )}
            <div className="pw-footnote">
              설명용 데이터 · 종가 신호 / 다음 봉 시가 체결
            </div>
          </div>
        )}
        {s.result && <Result time={time} />}
      </div>
      <div className="cm-chat pw-chat">
        <div className="cm-messages">
          {time >= 4 && <div className="cm-bubble">{firstAsk}</div>}
          {time >= 16 && (
            <div className="cm-bubble">@should_exit {editAsk}</div>
          )}
          {answer && <div className="cm-answer">{answer}</div>}
          {time >= 4 && time < 6 && (
            <div className="pw-chat-choice">
              ATR 기준 손절　/　이동평균 이탈
            </div>
          )}
        </div>
        {((time >= 6 && time < 10) || s.phase === 'running') && (
          <div className="cm-thinking">
            ✳{' '}
            {s.phase === 'running' ? '백테스트 계산 중…' : '전략 생성·검사 중…'}
          </div>
        )}
        {time >= 13 && time < 16 && (
          <div className="pw-reference">@should_exit</div>
        )}
        <div className={`cm-input${text ? ' cm-focused' : ''}`}>
          <span>{text || '무엇이든 물어보세요'}</span>
          {text && <i />}
          <b
            className={`cm-send${text ? ' ready' : ''}${(time >= 4 && time < 4.4) || (time >= 16 && time < 16.4) ? ' pressed' : ''}`}
          >
            <ArrowUp size={17} />
          </b>
        </div>
        <div className="cm-composer-bar">Claude　 기본</div>
      </div>
    </>
  );
}
