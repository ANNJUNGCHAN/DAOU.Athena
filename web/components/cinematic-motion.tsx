'use client';

import { memo, useEffect, useRef, useState } from 'react';
import {
  Pause,
  Play,
  RotateCcw,
  ArrowUp,
  Check,
  MousePointer2,
} from 'lucide-react';
import Image from 'next/image';
import {
  agoraState,
  beatAt,
  cameraAt,
  clamp,
  cursorAt,
  timelines,
  typedAt,
} from '@/lib/cinematic-timeline';
import type { features } from '@/lib/content';
import { agoraFilings } from '@/lib/agora-filings';
import './cinematic-motion.css';
import { PallasWalkthrough } from './pallas-walkthrough';
import { GlauxWalkthrough } from './glaux-walkthrough';

type Feature = (typeof features)[number];
const asks = {
  first: '삼성전자 지금 주가 어때?',
  trend: '지금 차트 추세로 보면 사도 될까?',
  disclosures: '@공시 스킬 삼성전자 최근에 나온 공시들을 분석해줘',
  metis: '네, 삼성전자는 장기 투자 관심 종목이에요.',
};

function Chat({
  text = '',
  thinking = false,
  first = '',
  second = '',
  answer = '',
  enter = false,
}: {
  text?: string;
  thinking?: boolean;
  first?: string;
  second?: string;
  answer?: string;
  enter?: boolean;
}) {
  return (
    <div className="cm-chat">
      <div className="cm-messages">
        {first && <div className="cm-bubble">{first}</div>}
        {second && <div className="cm-bubble">{second}</div>}
        {answer && <div className="cm-answer">{answer}</div>}
      </div>
      {thinking && (
        <div className="cm-thinking">
          <span>✳</span> 답변 중… <small>자료를 살펴보고 있어요</small>
        </div>
      )}
      <div className={`cm-input${text ? ' cm-focused' : ''}`}>
        <span>{text || '무엇이든 물어보세요'}</span>
        {text && <i />}
        <b
          className={`cm-send${enter ? ' pressed' : ''}${text ? ' ready' : ''}`}
        >
          {thinking ? '■' : <ArrowUp size={17} />}
        </b>
      </div>
      <div className="cm-composer-bar">
        Claude　 기본{' '}
        <Image
          src="/brand/glaux.svg"
          alt=""
          width={21}
          height={21}
          unoptimized
        />
      </div>
    </div>
  );
}

const Candles = memo(function Candles({ variant }: { variant: number }) {
  const bars = Array.from({ length: 64 }, (_, i) => {
    const close = 280 - i * 2.2 - Math.sin(i * 0.31 + variant) * 37;
    const open = close + Math.sin(i * 2.7 + variant) * 19;
    return {
      x: 22 + i * 11.2,
      open,
      close,
      high: Math.min(open, close) - 7 - (i % 4) * 2,
      low: Math.max(open, close) + 9 + (i % 3) * 2,
      volume: 12 + ((i * 19) % 59),
    };
  });
  return (
    <svg width="800" height="500" viewBox="0 0 800 500" fill="none">
      <g stroke="#e9ecf2">
        {[70, 140, 210, 280, 350, 420].map((y) => (
          <path key={y} d={`M12 ${y}H764`} />
        ))}
        {[60, 180, 300, 420, 540, 660].map((x) => (
          <path key={x} d={`M${x} 20V460`} />
        ))}
      </g>
      <g>
        {bars.map((b, i) => (
          <g
            key={i}
            fill={b.close < b.open ? '#ef767e' : '#79a8e8'}
            stroke={b.close < b.open ? '#ef767e' : '#79a8e8'}
          >
            <path d={`M${b.x} ${b.high}V${b.low}`} strokeWidth="1" />
            <rect
              x={b.x - 3.3}
              y={Math.min(b.open, b.close)}
              width="6.6"
              height={Math.max(2, Math.abs(b.open - b.close))}
            />
            <rect
              x={b.x - 3.3}
              y={465 - b.volume}
              width="6.6"
              height={b.volume}
              opacity=".4"
              stroke="none"
            />
          </g>
        ))}
      </g>
      <path
        d={bars
          .map(
            (b, i) =>
              `${i ? 'L' : 'M'}${b.x} ${305 - i * 1.8 - Math.sin(i * 0.12 + variant) * 9}`,
          )
          .join(' ')}
        stroke="#989bd1"
        strokeWidth="1.1"
      />
      <path
        d={bars
          .map((b, i) => `${i ? 'L' : 'M'}${b.x} ${326 - i * 1.55}`)
          .join(' ')}
        stroke="#6d75b0"
        strokeWidth="1"
      />
      <g fill="#939dad" fontSize="12">
        <text x="55" y="494">
          4월
        </text>
        <text x="290" y="494">
          5월
        </text>
        <text x="545" y="494">
          6월
        </text>
      </g>
    </svg>
  );
});
function ChartCard({ name, progress }: { name: string; progress: number }) {
  return (
    <div className="cm-chart-card">
      <div className="cm-chart-title">
        일봉 — {name}
        <span>설명용 데이터　×</span>
      </div>
      <div className="cm-chart-tools">
        <strong>일</strong> 주　월　년 <span>▤　⌁　수정주가　⛶</span>
      </div>
      <div className="cm-chart-source">데모 차트 · 실제 시세가 아닙니다</div>
      <div className="cm-chart-legend">
        ● MA5　● MA10　● MA20　● MA60　● MA120
      </div>
      <div
        className="cm-candles"
        style={{ clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)` }}
      >
        <Candles variant={name === '삼성전자' ? 0 : 3} />
      </div>
    </div>
  );
}

function AgoraPrompt({ text }: { text: string }) {
  const mention = '@공시 스킬';
  return text.startsWith('@') ? <><span className="cm-agora-mention">{text.slice(0, mention.length)}</span>{text.slice(mention.length)}</> : <>{text}</>;
}

function AgoraChat({ time, text }: { time: number; text: string }) {
  const s = agoraState(time);
  const logRef = useRef<HTMLDivElement>(null);
  const stage = s.disclosures ? 6 : s.disclosureSent ? 5 : s.trendAnalysis ? 4 : s.trendSent ? 3 : s.firstChart ? 2 : s.firstSent ? 1 : 0;
  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const answer = log.lastElementChild as HTMLElement | null;
    const end = Math.max(0, log.scrollHeight - log.clientHeight);
    const start = answer ? Math.min(end, Math.max(0, answer.offsetTop - 80)) : 0;
    log.scrollTo({ top: stage === 4 ? start + (end - start) * clamp((time - 32) / 4) : end, behavior: 'instant' });
  }, [stage, time]);
  return (
    <div className="cm-chat cm-agora-chat">
      <div className="cm-agora-log" ref={logRef}>
        {s.firstSent && <div className="cm-bubble">{asks.first}</div>}
        {s.firstChart && <div className="cm-answer">삼성전자 일봉 차트를 열었어요. 지금 보이는 차트는 설명용 합성 데이터예요. 현재 주가와 등락률은 실제 시세를 확인해야 해요.</div>}
        {s.trendSent && <div className="cm-bubble">{asks.trend}</div>}
        {s.trendAnalysis && <div className="cm-answer cm-agora-trend-answer">
          <p>예시 차트는 전반적으로 상승하지만, 지금 매수해도 된다고 단정할 수는 없어요. 세 가지를 함께 살펴봐요.</p>
          <p><strong>1. 추세</strong><br />저점과 고점이 전반적으로 높아지는 모습이에요. 중간 조정도 있으므로, 최근 저점을 지키며 상승 흐름을 이어가는지 확인해요.</p>
          <p><strong>2. 거래량</strong><br />고점을 넘을 때 거래량도 늘어나는지 살펴봐요. 거래량 확인 없이 가격 상승만으로 매수세가 강하다고 판단하기는 어려워요.</p>
          <p><strong>3. 진입 조건과 주의점</strong><br />단기 상승을 따라 바로 매수하기보다, 조정 시 지지 여부와 진입 조건을 정해요. 투자 기간과 감수할 손실 한도도 먼저 확인해야 해요.</p>
          <p className="cm-agora-source-note">합성 차트 해설입니다. 실제 매수 판단에는 최신 가격·거래량과 공시 확인이 필요해요.</p>
        </div>}
        {s.disclosureSent && <div className="cm-bubble"><AgoraPrompt text={asks.disclosures} /></div>}
        {s.disclosures && <div className="cm-answer">{agoraFilings.analysis.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}<p className="cm-agora-source-note">공개 공시 기준: {agoraFilings.asOf} · 재구성 시연</p></div>}
      </div>
      {s.thinking && <div className="cm-thinking"><span>✳</span> 답변 중… <small>자료를 살펴보고 있어요</small></div>}
      <div className={`cm-input${text ? ' cm-focused' : ''}`}><span><AgoraPrompt text={text || '무엇이든 물어보세요'} /></span>{text && <i />}<b className={`cm-send${[7.5, 19, 43].some((at) => time >= at && time < at + .4) ? ' pressed' : ''}${text ? ' ready' : ''}`}>{s.thinking ? '■' : <ArrowUp size={17} />}</b></div>
      <div className="cm-composer-bar">Claude　 기본 <Image src="/brand/glaux.svg" alt="" width={21} height={21} unoptimized /></div>
    </div>
  );
}

function Agora({ time }: { time: number }) {
  const s = agoraState(time);
  const filing = agoraFilings.filings[0];
  const text = time < 7.5
    ? typedAt(asks.first, time, 4, 7)
    : time >= 15 && time < 19
      ? typedAt(asks.trend, time, 15.8, 18.6)
      : time >= 38 && time < 43
        ? typedAt(asks.disclosures, time, 38, 42.5)
        : '';
  return (
    <>
      <div className="cm-canvas-clear">
        {!s.firstChart && <div className="cm-empty"><span>나의 작업 공간</span><small>질문한 자료가 캔버스에 모입니다.</small></div>}
        {s.firstChart && !s.disclosures && <><div className="cm-chart-tabs"><span className="selected">삼성전자 <small>×</small></span></div><ChartCard name="삼성전자" progress={clamp((time - 10.5) / 3.2)} /></>}
        {s.disclosures && <div className="cm-agora-disclosures">
          <section className="cm-agora-data-card">
            <header><strong>삼성전자 · 확인한 공시</strong><span>{agoraFilings.asOf} 기준　×</span></header>
            <div className="cm-agora-card-body"><table className="cm-agora-filings-table"><thead><tr><th>공시명</th><th>유형</th><th>공시일</th><th>핵심 내용</th></tr></thead><tbody>{agoraFilings.filings.map((item, index) => <tr key={item.sourceUrl} className={index === 0 && s.disclosureSelected ? 'selected' : ''}><td>{item.title}</td><td>{item.type}</td><td>{item.date}<small>{item.dateLabel}</small></td><td>{item.summary}</td></tr>)}</tbody></table><p className="cm-agora-source-note">삼성전자 공식 IR에서 확인 · 전체 최신 목록 아님 · ¹ 영문 제목 번역</p></div>
          </section>
          {s.disclosureReader && filing && <section className="cm-agora-data-card cm-agora-reader"><header><strong>{filing.title}</strong><span>공시 원문　×</span></header><div className="cm-agora-card-body"><div className="cm-agora-reader-meta">{filing.highlights}</div><h3>{filing.excerptHeading}</h3>{filing.readerFacts && <table className="cm-agora-reader-facts"><tbody>{filing.readerFacts.map((fact) => <tr key={fact.label}><th>{fact.label}</th><td>{fact.value}</td></tr>)}</tbody></table>}{filing.excerpt.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}<p className="cm-agora-source-note">{filing.dateLabel} {filing.date} · 원문 발췌</p><span className="cm-agora-source-note">삼성전자 공식 IR 원문</span></div></section>}
        </div>}
      </div>
      <AgoraChat time={time} text={text} />
    </>
  );
}

function Metis({ time }: { time: number }) {
  return (
    <>
      {time >= 7 && time < 12 && (
        <div className="cm-node-evidence">
          <strong>삼성전자</strong>
          <span>연결된 관심사 · 반도체</span>
          <small>관계의 근거와 시점을 함께 확인합니다.</small>
        </div>
      )}
      {time >= 12 && time < 21 && (
        <div className="cm-question">
          <small>확인이 필요한 것</small>
          <strong>삼성전자를 장기 투자 관심 종목으로 이해해도 될까요?</strong>
          <span>대화에서 추론한 연결 · 확인이 필요해요</span>
          <div className="cm-question-choices">
            <b>맞다</b>
            <b>아니다</b>
            <b>건너뛰기</b>
          </div>
        </div>
      )}
      <Chat
        text={time < 20.5 ? typedAt(asks.metis, time, 16, 20) : ''}
        first={time >= 20.5 ? asks.metis : ''}
        thinking={time >= 20.5 && time < 22.5}
        answer={
          time >= 22.5
            ? '확인한 내용을 바탕으로 관계를 다시 살펴볼 수 있어요.'
            : ''
        }
        enter={time >= 20.2 && time < 21}
      />
      {time >= 22.5 && (
        <svg className="cm-relation" width="1600" height="1000">
          <path
            d="M928 746 Q1020 650 981 516"
            fill="none"
            stroke="#ed91ba"
            strokeWidth="3"
          />
        </svg>
      )}
    </>
  );
}

function Aegis({ time }: { time: number }) {
  return (
    <>
      {time >= 19 && (
        <Chat
          first="반도체 주요 뉴스 살펴보기"
          answer="최근 실행 이력을 열었어요. 오늘 07:30에 생성된 브리핑과 실행 이유를 함께 살펴보세요."
        />
      )}
    </>
  );
}

function Ergane({ time }: { time: number }) {
  return (
    <>
      {time >= 5 && time < 25 && (
        <div className="cm-permission-page">
          <div className="cm-permission-header">
            <strong>company-disclosures</strong>
            <span>
              설치됨　 기능 3　 허용 {time >= 14 ? 2 : time >= 10 ? 1 : 0}
            </span>
          </div>
          <p>기능 허용은 company-disclosures 플러그인에만 적용됩니다.</p>
          <h3>권한 초안</h3>
          <small>승인 카드로 확정합니다</small>
          <div className="cm-permission-rows">
            {[
              '공시 목록 살펴보기',
              '공시 원문 읽기',
              '관심 기업 자료 찾기',
            ].map((label, i) => (
              <div key={label}>
                <span>{label}</span>
                <i
                  className={
                    (i === 0 && time >= 10) || (i === 1 && time >= 14)
                      ? 'checked'
                      : ''
                  }
                >
                  {((i === 0 && time >= 10) || (i === 1 && time >= 14)) && (
                    <Check size={16} />
                  )}
                </i>
              </div>
            ))}
          </div>
          <div className="cm-permission-footer">
            <span>허용 {time >= 14 ? 2 : time >= 10 ? 1 : 0} / 3</span>
            <span>선택한 기능만 노출됩니다</span>
            <b>플러그인으로</b>
            <b className="pink">선택 저장</b>
          </div>
          {time >= 19 && (
            <div className="cm-draft-result">
              <Check size={18} /> 권한 초안을 저장했어요. 승인 카드에서
              확정하세요.
            </div>
          )}
        </div>
      )}
      {time >= 19 && (
        <Chat answer="선택한 기능의 권한 초안을 준비했어요. 변경 내용을 검토한 뒤 승인해 주세요." />
      )}
    </>
  );
}

const contents = {
  agora: Agora,
  metis: Metis,
  aegis: Aegis,
  ergane: Ergane,
  pallas: PallasWalkthrough,
  glaux: GlauxWalkthrough,
};
// The image studio renders the same UI frames as the existing walkthrough.
export { contents as featureScenes, Chat as WalkthroughChat };
export function FeatureMotion({ feature }: { feature: Feature }) {
  const id = feature.slug;
  const timeline = timelines[id];
  const host = useRef<HTMLDivElement>(null);
  const camera = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<HTMLDivElement>(null);
  const elapsed = useRef(0);
  const reset = useRef(0);
  const [time, setTime] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let inView = false;
    const sync = () => setVisible(inView && !document.hidden);
    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        sync();
      },
      { threshold: 0.15 },
    );
    observer.observe(element);
    document.addEventListener('visibilitychange', sync);
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReduced(media.matches);
    motion();
    media.addEventListener('change', motion);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
      media.removeEventListener('change', motion);
    };
  }, []);
  useEffect(() => {
    let frame = 0;
    let previous = 0;
    let published = -1;
    const paint = (t: number) => {
      const p = cameraAt(id, t);
      if (camera.current) {
        // Resize the SVG viewport so text is rasterized at the displayed size.
        // Scaling a pre-composited layer makes the enlarged UI look soft.
        camera.current.style.width = `${p.zoom * 100}%`;
        camera.current.style.height = `${p.zoom * 100}%`;
        camera.current.style.left = `${50 - (p.zoom * p.x) / 16}%`;
        camera.current.style.top = `${50 - (p.zoom * p.y) / 10}%`;
      }
      const cursor = cursorAt(id, t);
      if (pointerRef.current) {
        pointerRef.current.style.left = `${cursor.x / 16}%`;
        pointerRef.current.style.top = `${cursor.y / 10}%`;
        pointerRef.current.dataset.click = String(cursor.click);
      }
    };
    if (reduced) {
      elapsed.current = 0;
      paint(timeline.duration - 1);
      return;
    }
    paint(elapsed.current);
    if (paused || !visible) return;
    const tick = (now: number) => {
      if (reset.current) {
        elapsed.current = 0;
        reset.current = 0;
      }
      if (previous)
        elapsed.current =
          (elapsed.current + Math.min(now - previous, 100) / 1000) %
          timeline.duration;
      previous = now;
      paint(elapsed.current);
      if (now - published >= 70) {
        setTime(elapsed.current);
        published = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [id, paused, visible, reduced, timeline.duration]);
  const Scene = contents[id];
  const displayTime = reduced ? timeline.duration - 1 : time;
  const background = id === 'glaux' ? 'aegis' : id;
  const restart = () => {
    elapsed.current = 0;
    reset.current = 1;
    setTime(0);
    setPaused(false);
  };
  return (
    <figure className="cm-figure">
      <div
        className={`cm-film cm-film-${id}${reduced ? ' cm-reduced' : ''}${paused || !visible ? ' cm-paused' : ''}`}
        ref={host}
      >
        <div className="cm-stage">
          <div ref={camera} className="cm-camera">
            <svg
              className="cm-app-frame"
              viewBox="0 0 1600 1000"
              aria-hidden="true"
            >
              <image
                href={`/screens/${background}.png`}
                width="1600"
                height="1000"
              />
              <foreignObject width="1600" height="1000">
                <div className="cm-app-overlay">
                  <Scene time={displayTime} />
                </div>
              </foreignObject>
            </svg>
            <div ref={pointerRef} className="cm-pointer" aria-hidden="true">
              <MousePointer2
                size={28}
                fill="#242833"
                stroke="white"
                strokeWidth={1.5}
              />
              <span />
            </div>
          </div>
        </div>
        <div className="cm-controls">
          <span className="cm-beat">{beatAt(id, displayTime)}</span>
          {!reduced && (
            <>
              <button
                type="button"
                onClick={() => setPaused((v) => !v)}
                aria-pressed={paused}
                aria-label={`${feature.name} 시연 ${paused ? '재생' : '일시정지'}`}
              >
                {paused ? <Play size={16} /> : <Pause size={16} />}
              </button>
              <button
                type="button"
                onClick={restart}
                aria-label={`${feature.name} 시연 처음부터`}
              >
                <RotateCcw size={16} />
              </button>
            </>
          )}
          <span className="cm-time">
            {Math.floor(displayTime).toString().padStart(2, '0')} /{' '}
            {timeline.duration}
          </span>
        </div>
        <div className="cm-progress" aria-hidden="true">
          <span
            style={{
              transform: `scaleX(${displayTime / timeline.duration})`,
            }}
          />
        </div>
      </div>
    </figure>
  );
}
