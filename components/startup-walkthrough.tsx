'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  LockKeyhole,
  MessageSquare,
  Network,
  Shield,
  Puzzle,
  Presentation,
  Plus,
  Search,
  ChevronUp,
  Minus,
  MousePointer2,
  Pause,
  Play,
  RotateCcw,
  X,
} from 'lucide-react';
import './startup-walkthrough.css';

const DURATION = 30;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const typed = (value: string, time: number, start: number, length: number) =>
  value.slice(0, Math.floor(clamp((time - start) / length) * value.length));
const stops = [
  [0, 67, 72],
  [0.8, 67, 72],
  [1.2, 18, 30],
  [2.1, 18, 30],
  [6.8, 70, 39],
  [8, 70, 39],
  [11.5, 70, 39],
  [12, 72, 83],
  [13.5, 72, 83],
  [14, 38, 38],
  [16.5, 38, 38],
  [17, 42, 49],
  [19.5, 42, 49],
  [20, 42, 60],
  [23, 42, 60],
  [23.5, 70, 84],
  [25, 70, 84],
  [26, 88, 88],
  [30, 88, 88],
];

function cursorAt(time: number) {
  const end = stops.findIndex((stop) => stop[0] > time);
  const a = stops[Math.max(0, end - 1)];
  const b = stops[end < 0 ? stops.length - 1 : end];
  const progress = clamp((time - a[0]) / (b[0] - a[0] || 1));
  const eased = progress * progress * (3 - 2 * progress);
  return {
    left: `${a[1] + (b[1] - a[1]) * eased}%`,
    top: `${a[2] + (b[2] - a[2]) * eased}%`,
  };
}

export function StartupWalkthrough() {
  const root = useRef<HTMLElement>(null);
  const clock = useRef(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => {
      setReduced(media.matches);
      if (media.matches) {
        clock.current = DURATION;
        setTime(DURATION);
        setPlaying(false);
      }
    };
    motion();
    media.addEventListener('change', motion);
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.25 },
    );
    if (root.current) observer.observe(root.current);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', motion);
    };
  }, []);

  useEffect(() => {
    if (!visible || !playing || reduced) return;
    let frame = 0;
    let previous = 0;
    const tick = (now: number) => {
      if (!document.hidden && previous) {
        clock.current = Math.min(
          DURATION,
          clock.current + Math.min((now - previous) / 1000, 0.1),
        );
        setTime(clock.current);
      }
      previous = now;
      if (clock.current < DURATION) frame = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [visible, playing, reduced]);

  const restart = () => {
    clock.current = 0;
    setTime(0);
    setPlaying(true);
  };
  const stage =
    time < 2
      ? 'desktop'
      : time < 6.5
        ? 'boot'
        : time < 13.5
          ? 'cli'
          : time < 26
            ? 'account'
            : 'main';
  const connected = time >= 10.8;
  const clicked = [1.3, 1.6, 8, 12.4, 14.2, 17.2, 20.2, 23.8].some(
    (at) => time >= at && time < at + 0.24,
  );
  const caption =
    stage === 'desktop'
      ? '바탕화면에서 ATHENA를 엽니다'
      : stage === 'boot'
        ? 'ATHENA가 시작을 준비합니다'
        : stage === 'cli'
          ? '사용할 AI 계정을 연결합니다'
          : stage === 'account'
            ? '키움 모의투자 계좌를 연결합니다'
            : '이제 ATHENA와 대화를 시작하세요';

  return (
    <figure
      className="sw-demo"
      ref={root}
      aria-label="ATHENA 시작 과정 애니메이션"
    >
      <div className={`sw-stage sw-${stage}`}>
        <div
          className="sw-camera"
          style={{
            transform: `scale(${stage === 'cli' || stage === 'account' ? 1.025 : 1})`,
          }}
          aria-hidden="true"
        >
          <div className="sw-wallpaper" />
          <div
            className={`sw-desktop-icon${time >= 1.3 ? ' sw-selected' : ''}`}
          >
            <div>
              <Image
                src="/brand/athena.png"
                alt=""
                width={600}
                height={150}
                unoptimized
              />
            </div>
            <span>ATHENA</span>
          </div>
          <div className="sw-taskbar">
            <span>⊞</span>
            <span>검색</span>
            <i />
            <span>가　 ◷</span>
          </div>
          {stage !== 'desktop' && (
            <div
              className={`sw-window${stage === 'main' ? ' sw-window-main' : ''}`}
            >
              <div className="sw-titlebar">
                <span>ATHENA</span>
                <div>
                  <Minus size={13} />
                  <span>□</span>
                  <X size={13} />
                </div>
              </div>
              {stage === 'boot' && (
                <div className="sw-boot-content">
                  <div className="sw-boot-word">
                    {typed('ATHENA', time, 2.5, 1.8)}
                    <i />
                  </div>
                </div>
              )}
              {(stage === 'cli' || stage === 'account') && (
                <div className="sw-onboarding">
                  <div className="sw-onb-head">
                    <span>{stage === 'cli' ? '2' : '3'} / 3</span>
                    <h3>
                      {stage === 'cli'
                        ? '사용할 CLI를 연결합니다'
                        : '증권 계좌를 연결합니다'}
                    </h3>
                    <p>
                      {stage === 'cli'
                        ? 'Athena는 자체 API 키를 사용하지 않습니다. 로그인한 계정으로 CLI를 제어합니다.'
                        : '키움 모의투자 계좌를 연결합니다. 앱키는 이 컴퓨터의 자격증명 저장소에만 저장됩니다.'}
                    </p>
                  </div>
                  {stage === 'cli' ? (
                    <div className="sw-cli-body">
                      {['Claude', 'Grok', 'Codex'].map((name, index) => (
                        <div
                          className={`sw-provider${index === 0 && time >= 8 ? ' sw-provider-selected' : ''}`}
                          key={name}
                        >
                          <span
                            className={`sw-provider-symbol sw-symbol-${index}`}
                          >
                            {['✳', '𝕏', '›_'][index]}
                          </span>
                          <div>
                            <b>{name}</b>
                            <small>
                              {index === 0 && connected
                                ? '연결된 계정 · 활성'
                                : 'CLI 계정'}
                            </small>
                          </div>
                          <span
                            className={`sw-connect${index === 0 && connected ? ' sw-connected' : ''}`}
                          >
                            {index === 0 && connected ? (
                              <>
                                <Check size={14} /> 연결됨
                              </>
                            ) : index === 0 && time >= 8 ? (
                              '로그인 중…'
                            ) : (
                              '연결'
                            )}
                          </span>
                        </div>
                      ))}
                      <p className="sw-hint">
                        연결을 누르면 CLI 로그인 명령이 새 터미널에서
                        실행됩니다.
                      </p>
                      {time >= 8 && !connected && (
                        <div className="sw-login">
                          <span>›_ Claude CLI</span>
                          <p>
                            열린 터미널에서 로그인을 완료하세요
                            <span className="sw-dot"> ●</span>
                          </p>
                        </div>
                      )}
                      {connected && (
                        <div className="sw-login sw-login-done">
                          <Check size={16} /> 계정 연결을 확인했습니다.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="sw-account-body">
                      <div
                        className={`sw-field${time >= 14 && time < 17 ? ' sw-field-focused' : ''}`}
                      >
                        <div className="sw-field-label">
                          별칭 <small>선택</small>
                        </div>
                        <div>
                          {typed('모의-1', time, 14.4, 1.2) || (
                            <span>모의-1</span>
                          )}
                        </div>
                      </div>
                      <div
                        className={`sw-field${time >= 17 && time < 20 ? ' sw-field-focused' : ''}`}
                      >
                        <div className="sw-field-label">APP KEY</div>
                        <div>
                          {time >= 17.6 ? (
                            <>
                              <b>••••••••••••</b>
                              <small>붙여넣음</small>
                            </>
                          ) : (
                            <span>앱키를 붙여넣으세요</span>
                          )}
                        </div>
                      </div>
                      <div
                        className={`sw-field${time >= 20 && time < 23.5 ? ' sw-field-focused' : ''}`}
                      >
                        <div className="sw-field-label">SECRET KEY</div>
                        <div>
                          {time >= 20.6 ? (
                            <>
                              <b>••••••••••••</b>
                              <small>붙여넣음</small>
                            </>
                          ) : (
                            <span>시크릿 키를 붙여넣으세요</span>
                          )}
                        </div>
                      </div>
                      <div className="sw-save">
                        <LockKeyhole size={15} />
                        <p>
                          <b>이 컴퓨터에 안전하게 저장</b>
                          <span>Windows 자격증명 저장소에 암호화됩니다.</span>
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="sw-onb-foot">
                    <span className="sw-steps">
                      ● ● <i>{stage === 'cli' ? '○' : '●'}</i>
                    </span>
                    <span
                      className={`sw-next${(stage === 'cli' && !connected) || (stage === 'account' && time < 20.6) ? ' sw-disabled' : ''}`}
                    >
                      {stage === 'cli'
                        ? '계속'
                        : time >= 25
                          ? '검증 완료'
                          : time >= 23.8
                            ? '검증 중…'
                            : '검증 후 시작'}
                      {time >= 25 ? (
                        <Check size={15} />
                      ) : (
                        <ArrowRight size={15} />
                      )}
                    </span>
                  </div>
                </div>
              )}
              {stage === 'main' && (
                <div className="sw-empty-agora">
                  <aside className="sw-agora-sidebar">
                    <div className="sw-agora-actions"><span><Plus />새 대화</span><span><Search />대화 검색</span></div>
                    <small className="sw-agora-mode-caption">이력 · 모드</small>
                    <div className="sw-agora-modes">
                      {[['대화', MessageSquare], ['그래프', Network], ['알림', Shield], ['플러그인', Puzzle], ['전략', Presentation]].map(([name, Icon], i) => {
                        const ModeIcon = Icon as typeof MessageSquare;
                        return <span key={name as string} className={i === 0 ? 'sw-agora-selected' : ''}><ModeIcon />{name as string}</span>;
                      })}
                    </div>
                    <div className="sw-agora-history">대화 이력 없음</div>
                    <div className="sw-agora-account"><i /><span>모의-1</span><ChevronUp /></div>
                  </aside>
                  <div className="sw-agora-canvas">
                    <svg className="sw-agora-illustration" viewBox="0 0 120 72" fill="none">
                      <path d="M18 8 H74 Q84 8 84 18 V32 Q84 42 74 42 H36 L26 52 V42 H18 Q8 42 8 32 V18 Q8 8 18 8 Z" stroke="currentColor" strokeWidth="1.5" opacity=".35" />
                      <circle cx="34" cy="25" r="3" fill="currentColor" opacity=".3" /><circle cx="46" cy="25" r="3.5" fill="currentColor" opacity=".55" /><circle cx="58" cy="25" r="3" fill="currentColor" opacity=".3" />
                      <path d="M78 44 H104 Q112 44 112 51 V57 Q112 64 104 64 H90 L84 70 V64 H78 Q70 64 70 57 V51 Q70 44 78 44 Z" stroke="currentColor" strokeWidth="1.5" opacity=".28" />
                    </svg>
                    <strong>무엇이든 물어보세요</strong>
                    <p>질문하면 답변 카드가 이 자리에 쌓입니다.</p>
                  </div>
                  <div className="sw-agora-chat">
                    <div className="sw-agora-welcome"><span>새 대화</span><p>종목·재무·공시를 물어보면<br />답이 캔버스에 카드로 쌓입니다</p></div>
                    <div className="sw-agora-input-stack">
                      <div className="sw-agora-composer">무엇이든 물어보세요</div>
                      <div className="sw-agora-model"><span>Claude</span><span>기본</span><Image src="/brand/glaux.svg" alt="" width={22} height={22} unoptimized /></div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {!reduced && time < 28 && (
            <div
              className={`sw-cursor${clicked ? ' sw-click' : ''}`}
              style={cursorAt(time)}
            >
              <MousePointer2 size={28} fill="white" strokeWidth={1.8} />
              <i />
            </div>
          )}
        </div>
      </div>
      <div className="cm-controls">
          <span className="cm-beat">{caption}</span>
          <button
            type="button"
            disabled={reduced}
            onClick={() =>
              time >= DURATION ? restart() : setPlaying(!playing)
            }
            aria-label={playing ? '시작 영상 일시정지' : '시작 영상 재생'}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            type="button"
            disabled={reduced}
            onClick={restart}
            aria-label="시작 영상 다시 보기"
          >
            <RotateCcw size={16} />
          </button>
          <span className="cm-time">{Math.floor(time).toString().padStart(2, '0')} / 30</span>
      </div>
      <div className="cm-progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${time / DURATION})` }} />
      </div>
      <p className="sw-accessible">
        ATHENA 실행, 시작 준비, Claude·Grok·Codex 중 사용할 CLI 계정 연결, 키움
        모의투자 계좌의 별칭과 APP KEY·SECRET KEY 등록, 검증 후 메인 화면 진입을
        보여주는 예시입니다. 입력값과 연결 상태는 시연용입니다.
      </p>
    </figure>
  );
}
