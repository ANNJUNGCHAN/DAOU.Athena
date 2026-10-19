import Image from 'next/image';
import { ArrowUp, ArrowUpRight, Check, Minus, X } from 'lucide-react';
import { clamp, glauxState, typedAt } from '@/lib/cinematic-timeline';
import './glaux-walkthrough.css';

const chartAsk = '삼성전자 3개월 흐름 보여줘';
const orderAsk = '삼성전자 1주 매수 준비해줘';

function Owl({ badge = false }: { badge?: boolean }) {
  return (
    <div className="gw-owl">
      <Image src="/brand/glaux.svg" alt="" width={76} height={76} unoptimized />
      {badge && <b>1</b>}
    </div>
  );
}

function Spreadsheet() {
  return (
    <div className="gw-sheet">
      <header>
        <span>분기별 운영 현황.xlsx</span>
        <span>자동 저장 켜짐</span>
      </header>
      <nav>
        파일　 홈　 삽입　 페이지 레이아웃　 수식　 데이터　 검토　 보기
      </nav>
      <div className="gw-ribbon">
        <b>붙여넣기</b>
        <span>맑은 고딕　 11</span>
        <span>가운데 맞춤</span>
        <span>조건부 서식　 표 서식　 셀 스타일</span>
      </div>
      <div className="gw-formula">
        <span>D7</span>
        <i>ƒx</i>
        <span>=SUM(D3:D6)</span>
      </div>
      <div className="gw-grid">
        <div className="gw-row gw-letters">
          {['', 'A', 'B', 'C', 'D', 'E', 'F', 'G'].map((x, i) => (
            <span key={i}>{x}</span>
          ))}
        </div>
        {Array.from({ length: 18 }, (_, i) => (
          <div className={`gw-row${i === 1 ? ' gw-table-head' : ''}`} key={i}>
            <span>{i + 1}</span>
            {Array.from({ length: 7 }, (_, j) => (
              <span
                className={i === 6 && j === 3 ? 'gw-cell-active' : ''}
                key={j}
              >
                {i === 0 && j === 0
                  ? '분기별 운영 현황'
                  : i === 1
                    ? [
                        '구분',
                        '1분기',
                        '2분기',
                        '3분기',
                        '4분기',
                        '합계',
                        '비고',
                      ][j]
                    : i > 1 && i < 6
                      ? j === 0
                        ? ['기획', '디자인', '개발', '운영'][i - 2]
                        : j < 5
                          ? String((i + 1) * 7 + j * 3)
                          : ''
                      : i === 6 && j === 0
                        ? '합계'
                        : i === 6 && j === 3
                          ? '150'
                          : ''}
              </span>
            ))}
          </div>
        ))}
      </div>
      <footer>
        ＋　 <b>운영 현황</b>　 일정 관리<span>준비　　100%</span>
      </footer>
    </div>
  );
}

export function GlauxWalkthrough({ time }: { time: number }) {
  const s = glauxState(time);
  const hide = clamp((time - 2.8) / 0.55);
  const input =
    time >= 12 && time < 16
      ? typedAt(chartAsk, time, 12, 15.7)
      : time >= 23 && time < 26
        ? typedAt(orderAsk, time, 23, 25.7)
        : '';
  return (
    <div className="gw-desktop">
      <Spreadsheet />
      {time < 3.4 && (
        <div
          className="gw-main-window"
          style={{
            opacity: 1 - hide,
            transform: `translate(${hide * 330}px,${hide * 550}px) scale(${1 - hide * 0.8})`,
          }}
        >
          <div className="gw-window-title">
            <span>ATHENA</span>
            <div>
              <Minus size={18} />
              <span>□</span>
              <X size={18} />
            </div>
          </div>
          <Image
            src="/screens/agora.png"
            alt=""
            width={1600}
            height={1000}
            unoptimized
          />
        </div>
      )}
      {s.owl && !s.open && (
        <div className={`gw-collapsed${s.notification ? ' gw-arrived' : ''}`}>
          <Owl badge={s.notification} />
        </div>
      )}
      {s.open && (
        <div className={`gw-panel${s.chat ? ' gw-panel-chat' : ''}`}>
          <header className="gw-panel-head">
            <Owl />
            <span>알림 오브 {s.chat ? '미니 대화' : '알림'}</span>
            <X size={16} />
          </header>
          <div className="gw-body">
            {!s.chat ? (
              <>
                <small>알림 · 설정한 가격 도달</small>
                <p>삼성전자가 관심 가격에 도달했어요.</p>
                <div className="gw-alert-facts">
                  <span>알림 시점 가격</span>
                  <b>72,000원</b>
                </div>
                <small>설명용 알림 · 현재 시세가 아닙니다</small>
                <div className="gw-talk">
                  이 알림으로 대화하기 <ArrowUpRight size={14} />
                </div>
              </>
            ) : (
              <>
                <div className="gw-context">
                  삼성전자 가격 알림에서 이어진 대화
                </div>
                {time >= 16 && (
                  <p className="gw-question">
                    {time >= 26 ? orderAsk : chartAsk}
                  </p>
                )}
                {time >= 16 && time < 18 && (
                  <p className="gw-thinking">
                    가격 흐름을 확인하고 있어요<span>···</span>
                  </p>
                )}
                {s.chart && (
                  <>
                    <p className="gw-answer">
                      작은 창에서도 가격 흐름을 확인하세요.
                    </p>
                    <div className="gw-mini-card">
                      <header>
                        <b>삼성전자 005930</b>
                        <small>일봉 · 3M</small>
                      </header>
                      <div className="gw-price">
                        72,000 <span>+1.20%</span>
                      </div>
                      <svg viewBox="0 0 336 116" className="gw-chart">
                        <path
                          d="M0 101 L20 96 L40 100 L60 83 L80 88 L100 73 L120 78 L140 62 L160 66 L180 48 L200 54 L220 36 L240 41 L260 25 L280 32 L300 15 L320 20 L336 7"
                          pathLength="1"
                          fill="none"
                          stroke="#b75870"
                          strokeWidth="2.5"
                          strokeDasharray="1"
                          strokeDashoffset={1 - clamp((time - 18) / 2.2)}
                        />
                      </svg>
                      <div className="gw-chart-dates">
                        <span>3개월 전</span>
                        <span>알림 시점</span>
                      </div>
                      <footer>설명용 데이터 · 전체 차트는 대화창에서</footer>
                    </div>
                  </>
                )}
                {time >= 26 && time < 28 && (
                  <p className="gw-thinking">
                    주문 내용을 정리하고 있어요<span>···</span>
                  </p>
                )}
                {s.ticket && (
                  <>
                    <p className="gw-answer">주문 내용을 먼저 확인해 주세요.</p>
                    <div className="gw-mini-card gw-ticket">
                      <header>
                        <b>주문 티켓</b>
                        <small>
                          {s.submitted
                            ? '모의 접수'
                            : s.review
                              ? '최종 확인'
                              : '검토 대기'}
                        </small>
                      </header>
                      <dl>
                        <div>
                          <dt>종목</dt>
                          <dd>삼성전자</dd>
                        </div>
                        <div>
                          <dt>주문</dt>
                          <dd>매수 · 시장가</dd>
                        </div>
                        <div>
                          <dt>수량</dt>
                          <dd>1주</dd>
                        </div>
                        <div>
                          <dt>계좌</dt>
                          <dd>모의 계좌</dd>
                        </div>
                      </dl>
                      <div className="gw-review">
                        {s.submitted ? (
                          <>
                            <Check size={14} /> 모의 주문 접수 완료
                          </>
                        ) : s.review ? (
                          '확인하고 주문 실행'
                        ) : (
                          '주문 내용 검토'
                        )}
                      </div>
                      <footer>시연용 티켓 · 주문 전송 없음</footer>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
          {s.chat && (
            <div className="gw-composer">
              <div className="gw-input">
                <span>
                  {input || '무엇이든 물어보세요'}
                  {input && <i />}
                </span>
                <ArrowUp size={16} />
              </div>
              <div className="gw-strip">
                <i />
                <span>CLAUDE</span>
                <small>감시 2</small>
                <b>대화창으로 가기</b>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="gw-desktop-caption">
        업무 화면 예시 · 알림 오브 미니 대화 시연
      </div>
    </div>
  );
}
