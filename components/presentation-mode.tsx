'use client';

import Image from 'next/image';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Presentation,
  RotateCcw,
  X,
} from 'lucide-react';
import { AthenaIntro } from '@/components/athena-intro';
import { ParticleField } from '@/components/particle-field';
import {
  PresentationFeatureCapability,
  PresentationFeatureCompanions,
  PresentationFeatureVideo,
} from '@/components/presentation-feature';
import { PresentationTechSlide } from '@/components/presentation-tech';
import { PresentationPrint } from '@/components/presentation-print';
import { TypedWordmark } from '@/components/typed-wordmark';
import { features } from '@/lib/content';
import { productPageCopy } from '@/lib/product-page-copy';
import {
  formatPresentationTime,
  movePresentationSlide,
  PRESENTATION_DURATION,
  presentationSlides,
} from '@/lib/presentation';
import './presentation-mode.css';

const speakerNotes: Record<string, string> = {
  opening:
    'ATHENA가 해결하려는 출발점은 더 많은 정보를 보여주는 것이 아니라, 투자 판단을 가리던 안개를 걷어내는 것입니다.',
  promise:
    '사용자는 화면 번호나 메뉴를 외우는 대신 궁금한 것을 묻습니다. 질문, 분석, 검증이 한 작업 공간에서 이어지는 경험을 소개합니다.',
  'tech-tool-selection-1':
    '질문의 핵심어를 정리하고 도구 후보를 찾는 과정을 홈페이지 기술 도해와 함께 설명합니다.',
  'tech-tool-selection-2':
    '현재 v018 정책은 거절 라벨을 제외한 최고 점수 후보를 선택하고, 실행 전에는 입력 조건과 제공자 상태를 별도로 검증하는 과정을 설명합니다.',
  'tech-investment-memory-1':
    '대화에서 추출한 관심과 체결·보유에서 확인한 사실을 서로 다른 출처로 기록하는 구조를 설명합니다.',
  'tech-investment-memory-2':
    'Entity Resolution으로 같은 의미의 기억을 연결하고, 투자 사실과 명시적 연결을 보호해 위험한 병합을 막는 과정을 설명합니다.',
  'tech-graph-retrieval-1':
    'ID를 우선 사용하고 FTS5 후보를 최대 5개로 제한해 관련 대상을 찾는 과정을 설명합니다.',
  'tech-graph-retrieval-2':
    'Greedy Modularity로 연결이 촘촘한 노드를 군집으로 묶고, 표시 순서와 재사용 가능한 이름을 통해 그래프 탐색을 일관되게 유지하는 과정을 설명합니다.',
  closing:
    'ATHENA는 궁금한 것을 묻는 순간부터 분석하고 검증하는 과정까지 연결합니다. 투자의 다음 장을 한 문장으로 시작합니다.',
};

function speakerNoteFor(slide: (typeof presentationSlides)[number]) {
  const note = speakerNotes[slide.id];
  if (note) return note;
  const feature = features.find((item) => item.slug === slide.featureSlug);
  if (feature && slide.kind === 'feature-video')
    return `${feature.name} 기능 미리보기를 짚은 뒤, 영상 재생 버튼으로 홈페이지에 등록된 기능 영상을 함께 봅니다.`;
  const copy = slide.featureSlug
    ? productPageCopy[slide.featureSlug]
    : undefined;
  const capability =
    slide.capabilityIndex !== undefined
      ? copy?.mainFeatures[slide.capabilityIndex]
      : undefined;
  if (feature && capability && slide.kind === 'feature-capability')
    return `${feature.name}의 주요 기능인 ${capability.title}을 소개합니다. ${capability.description}`;
  if (
    feature &&
    copy?.subfeatures?.length &&
    slide.kind === 'feature-companions'
  )
    return `${feature.name}와 함께 쓰는 기능을 소개합니다. ${copy.subfeatures
      .map((item) => `${item.title}: ${item.description}`)
      .join(' ')}`;
  return '';
}

function OpeningSlide({ printMode = false }: { printMode?: boolean }) {
  return (
    <div className="pm-opening">
      {printMode ? (
        <Image
          className="pm-print-wordmark"
          src="/brand/athena.png"
          alt="ATHENA"
          width={440}
          height={132}
          unoptimized
        />
      ) : (
        <>
          <ParticleField />
          <TypedWordmark />
        </>
      )}
      <h1>
        투자의 시야를 가리던
        <br />
        안개를 걷어내다.
      </h1>
      <p className="pm-lead">정보 너머의 맥락이 보이도록.</p>
    </div>
  );
}

function PromiseSlide() {
  return (
    <div className="pm-promise">
      <p className="pm-eyebrow">키움증권이 만드는 AI 투자 워크스페이스</p>
      <h2>
        투자의 다음 장을,
        <br />한 문장으로 열다.
      </h2>
      <p>
        궁금한 것을 묻고, 떠오른 생각을 적어보세요.
        <br />
        ATHENA와 함께 분석하고 검증하는 새로운 투자 방식.
      </p>
      <div className="pm-mode-line" aria-label="ATHENA의 여섯 기능">
        {features.map((feature, index) => (
          <span key={feature.slug}>
            <b>{String(index + 1).padStart(2, '0')}</b>
            {feature.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function ClosingSlide() {
  return (
    <div className="pm-closing">
      <Image
        src="/brand/athena.png"
        alt="ATHENA"
        width={270}
        height={81}
        unoptimized
      />
      <h2>
        투자의 다음 장을,
        <br />한 문장으로 열다.
      </h2>
      <p>궁금한 것을 묻고, 떠오른 생각을 적어보세요.</p>
      <div>
        <span>키움증권이 만드는 AI 투자 워크스페이스</span>
        <Image
          src="/brand/daoukiwoom-group.png"
          alt="다우키움그룹"
          width={180}
          height={31}
          unoptimized
        />
      </div>
    </div>
  );
}

export function PresentationSlideContent({
  index,
  printMode = false,
}: {
  index: number;
  printMode?: boolean;
}) {
  const slide = presentationSlides[index] ?? presentationSlides[0];
  if (slide.kind === 'opening') return <OpeningSlide printMode={printMode} />;
  if (slide.kind === 'promise') return <PromiseSlide />;
  if (slide.kind === 'feature-video' && slide.featureSlug)
    return (
      <PresentationFeatureVideo
        slug={slide.featureSlug}
        printMode={printMode}
      />
    );
  if (
    slide.kind === 'feature-capability' &&
    slide.featureSlug &&
    slide.capabilityIndex !== undefined
  )
    return (
      <PresentationFeatureCapability
        slug={slide.featureSlug}
        capabilityIndex={slide.capabilityIndex}
      />
    );
  if (slide.kind === 'feature-companions' && slide.featureSlug)
    return <PresentationFeatureCompanions slug={slide.featureSlug} />;
  if (
    slide.kind === 'technology' &&
    slide.techSlug &&
    slide.techPageIndex !== undefined
  )
    return (
      <PresentationTechSlide
        slug={slide.techSlug}
        pageIndex={slide.techPageIndex}
        printMode={printMode}
      />
    );
  return <ClosingSlide />;
}

export function PresentationLauncher() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [notes, setNotes] = useState(false);
  const [overview, setOverview] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [introActive, setIntroActive] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const elapsedRef = useRef(0);

  const close = useCallback(() => {
    setOpen(false);
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => undefined);
  }, []);

  const dismissOverview = useCallback(() => {
    setOverview(false);
    requestAnimationFrame(() =>
      stageRef.current?.focus({ preventScroll: true }),
    );
  }, []);

  const finishIntro = useCallback(() => {
    setIntroActive(false);
    requestAnimationFrame(() =>
      stageRef.current?.focus({ preventScroll: true }),
    );
  }, []);

  const go = useCallback(
    (nextIndex: number) => {
      setIndex(Math.max(0, Math.min(presentationSlides.length - 1, nextIndex)));
      dismissOverview();
    },
    [dismissOverview],
  );

  const launch = () => {
    setOpen(true);
    setIndex(0);
    setElapsed(0);
    elapsedRef.current = 0;
    setPaused(false);
    setNotes(false);
    setOverview(false);
    setIntroActive(true);
    if (document.documentElement.requestFullscreen) {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
  };

  useEffect(() => {
    if (!open) return;
    const overlayElement = overlayRef.current;
    const launcherElement = launcherRef.current;
    const hidden: Array<{
      element: HTMLElement;
      inert: boolean;
      ariaHidden: string | null;
    }> = [];
    for (const element of Array.from(document.body.children)) {
      if (
        !(element instanceof HTMLElement) ||
        element === overlayElement ||
        element.contains(overlayElement)
      )
        continue;
      hidden.push({
        element,
        inert: element.inert,
        ariaHidden: element.getAttribute('aria-hidden'),
      });
      element.inert = true;
      element.setAttribute('aria-hidden', 'true');
    }
    return () => {
      for (const item of hidden) {
        item.element.inert = item.inert;
        if (item.ariaHidden === null)
          item.element.removeAttribute('aria-hidden');
        else item.element.setAttribute('aria-hidden', item.ariaHidden);
      }
      launcherElement?.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (open && !introActive) closeRef.current?.focus({ preventScroll: true });
  }, [introActive, open]);

  useEffect(() => {
    if (!open) return;
    const onFullscreen = () =>
      setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    onFullscreen();
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, [open]);

  useEffect(() => {
    if (!open || paused) return;
    let frame = 0;
    let previous = performance.now();
    let published = previous;
    const tick = (now: number) => {
      elapsedRef.current += (now - previous) / 1000;
      previous = now;
      if (now - published >= 200) {
        setElapsed(elapsedRef.current);
        published = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [open, paused]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (introActive) return;
      if (
        document.querySelector(
          '.feature-video-dialog[open], .presentation-tech-figure-dialog[open]',
        )
      )
        return;
      const target = event.target;
      const spaceInteractive =
        target instanceof Element &&
        Boolean(
          target.closest(
            'button, a, input, textarea, select, summary, [role="tab"], video, audio, iframe',
          ),
        );
      const ownsNavigationKeys =
        target instanceof Element &&
        Boolean(
          target.closest(
            'input, textarea, select, summary, [role="tab"], video, audio, iframe',
          ),
        );
      if (
        ownsNavigationKeys &&
        ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
      )
        return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (
        event.key === 'ArrowRight' ||
        event.key === 'PageDown' ||
        (event.key === ' ' && !spaceInteractive)
      ) {
        event.preventDefault();
        setIndex((current) => movePresentationSlide(current, 'next'));
        dismissOverview();
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        setIndex((current) => movePresentationSlide(current, 'previous'));
        dismissOverview();
      } else if (event.key === 'Home') {
        event.preventDefault();
        setIndex(0);
        dismissOverview();
      } else if (event.key === 'End') {
        event.preventDefault();
        setIndex(presentationSlides.length - 1);
        dismissOverview();
      } else if (event.key === 'Tab') {
        const focusable = Array.from(
          overlayRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        ).filter((element) => element.getClientRects().length > 0);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!overlayRef.current?.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close, dismissOverview, introActive, open]);

  const resetTimer = () => {
    elapsedRef.current = 0;
    setElapsed(0);
    setPaused(false);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => undefined);
    else if (document.documentElement.requestFullscreen)
      void document.documentElement.requestFullscreen().catch(() => undefined);
  };

  const slide = presentationSlides[index] ?? presentationSlides[0];
  const progress = ((index + 1) / presentationSlides.length) * 100;

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className="button light presentation-launcher"
        onClick={launch}
      >
        <Presentation size={17} aria-hidden="true" /> 15분 프레젠테이션
      </button>
      {open &&
        createPortal(
          <dialog
            ref={overlayRef}
            open
            className="presentation-shell"
            aria-modal="true"
            aria-label="ATHENA 15분 프레젠테이션"
          >
            {introActive ? (
              <AthenaIntro
                contained
                showWordmark={false}
                onComplete={finishIntro}
              />
            ) : null}
            <div
              className="pm-chrome"
              inert={introActive}
              aria-hidden={introActive}
            >
              <div className="pm-progress" aria-hidden="true">
                <span style={{ width: `${progress}%` }} />
              </div>
              <header className="pm-topbar">
                <Image
                  src="/brand/athena.png"
                  alt="ATHENA"
                  width={114}
                  height={34}
                  unoptimized
                />
                <p aria-live="polite">
                  <b>{String(index + 1).padStart(2, '0')}</b> /{' '}
                  {String(presentationSlides.length).padStart(2, '0')}
                  <span>{slide.label}</span>
                </p>
                <div className="pm-top-actions">
                  <button
                    type="button"
                    onClick={() => setNotes((value) => !value)}
                    aria-pressed={notes}
                    title="발표자 노트"
                  >
                    <FileText size={18} />
                    <span>노트</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      overview ? dismissOverview() : setOverview(true)
                    }
                    aria-pressed={overview}
                    title="슬라이드 한눈에 보기"
                  >
                    <LayoutGrid size={18} />
                    <span>목차</span>
                  </button>
                  <PresentationPrint>
                    {presentationSlides.map((item, itemIndex) => (
                      <section
                        className="presentation-print-page"
                        key={item.id}
                        aria-label={`${itemIndex + 1}번째 슬라이드: ${item.label}`}
                      >
                        <div className="pm-slide">
                          <PresentationSlideContent
                            index={itemIndex}
                            printMode
                          />
                        </div>
                      </section>
                    ))}
                  </PresentationPrint>
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    title={fullscreen ? '전체 화면 종료' : '전체 화면'}
                  >
                    {fullscreen ? (
                      <Minimize2 size={18} />
                    ) : (
                      <Maximize2 size={18} />
                    )}
                    <span>전체 화면</span>
                  </button>
                  <button
                    ref={closeRef}
                    type="button"
                    onClick={close}
                    title="프레젠테이션 종료"
                  >
                    <X size={20} />
                    <span>종료</span>
                  </button>
                </div>
              </header>

              <main
                ref={stageRef}
                tabIndex={-1}
                className="pm-stage"
                aria-label={`${index + 1}번째 슬라이드: ${slide.label}`}
              >
                <div key={slide.id} className="pm-slide">
                  <PresentationSlideContent index={index} />
                </div>
                {notes ? (
                  <aside className="pm-notes" aria-label="발표자 노트">
                    <b>발표자 노트</b>
                    <p>{speakerNoteFor(slide)}</p>
                    <small>권장 {formatPresentationTime(slide.duration)}</small>
                  </aside>
                ) : null}
                {overview ? (
                  <nav className="pm-overview" aria-label="슬라이드 목차">
                    <div>
                      <h2>15분 프레젠테이션</h2>
                      <button
                        type="button"
                        onClick={dismissOverview}
                        aria-label="목차 닫기"
                      >
                        <X size={20} />
                      </button>
                    </div>
                    <ol>
                      {presentationSlides.map((item, itemIndex) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            className={itemIndex === index ? 'is-current' : ''}
                            onClick={() => go(itemIndex)}
                          >
                            <span>
                              {String(itemIndex + 1).padStart(2, '0')}
                            </span>
                            <b>{item.label}</b>
                            <small>
                              {formatPresentationTime(item.duration)}
                            </small>
                          </button>
                        </li>
                      ))}
                    </ol>
                  </nav>
                ) : null}
              </main>

              <footer className="pm-controls">
                <div
                  className="pm-timer"
                  aria-label={`발표 경과 시간 ${formatPresentationTime(elapsed)}`}
                >
                  <span>{formatPresentationTime(elapsed)}</span>
                  <small>
                    / {formatPresentationTime(PRESENTATION_DURATION)}
                  </small>
                  <button
                    type="button"
                    onClick={() => setPaused((value) => !value)}
                    title={paused ? '타이머 계속' : '타이머 일시 정지'}
                  >
                    {paused ? <Play size={17} /> : <Pause size={17} />}
                  </button>
                  <button
                    type="button"
                    onClick={resetTimer}
                    title="타이머 초기화"
                  >
                    <RotateCcw size={16} />
                  </button>
                </div>
                <div className="pm-navigation">
                  <button
                    type="button"
                    onClick={() => go(movePresentationSlide(index, 'previous'))}
                    disabled={index === 0}
                  >
                    <ChevronLeft size={20} /> 이전
                  </button>
                  <span>
                    <kbd>←</kbd>
                    <kbd>→</kbd>로 이동
                  </span>
                  <button
                    type="button"
                    onClick={() => go(movePresentationSlide(index, 'next'))}
                    disabled={index === presentationSlides.length - 1}
                  >
                    다음 <ChevronRight size={20} />
                  </button>
                </div>
              </footer>
            </div>
          </dialog>,
          document.body,
        )}
    </>
  );
}
