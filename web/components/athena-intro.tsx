'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { introAt, INTRO_END } from '@/lib/intro-timeline';
import { TypedWordmark } from './typed-wordmark';
import './athena-intro.css';

const INTRO_SESSION_KEY = 'athena:intro-complete';

function StarFlight({ elapsed }: { elapsed: React.RefObject<number> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    let frame = 0;
    const stars = Array.from({ length: 420 }, (_, i) => ({
      x: Math.sin(i * 127.1 + 4) * 1.8,
      y: Math.cos(i * 311.7 + 9) * 1.8,
      z: 0.2 + (((i * 73) % 419) / 419) * 3,
      size: 0.4 + (i % 5) * 0.18,
    }));
    const resize = () => {
      const dpr = Math.min(devicePixelRatio, 2);
      el.width = innerWidth * dpr;
      el.height = innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    addEventListener('resize', resize);
    const draw = () => {
      const t = elapsed.current;
      const w = innerWidth,
        h = innerHeight;
      ctx.fillStyle = '#02030a';
      ctx.fillRect(0, 0, w, h);
      const rush = Math.max(0, Math.min(1, (t - 1300) / 1600));
      const travel = t * 0.000018 + rush ** 3 * 3.5;
      const focal = Math.max(w, h) * 0.42;
      for (const star of stars) {
        const z = ((((star.z - travel) % 3.2) + 3.2) % 3.2) + 0.07;
        const x = w / 2 + (star.x / z) * focal;
        const y = h / 2 + (star.y / z) * focal;
        const tail = 0.003 + rush ** 3 * 0.32;
        const px = w / 2 + (star.x / (z + tail)) * focal;
        const py = h / 2 + (star.y / (z + tail)) * focal;
        ctx.strokeStyle = `rgba(209,222,255,${Math.min(0.9, 0.25 + (1 / z) * 0.18)})`;
        ctx.lineWidth = star.size;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      const radius = 35 + rush ** 5 * Math.max(w, h) * 1.5;
      const glow = ctx.createRadialGradient(
        w / 2,
        h / 2,
        0,
        w / 2,
        h / 2,
        radius,
      );
      glow.addColorStop(0, '#fff');
      glow.addColorStop(0.025, '#f2f5ff');
      glow.addColorStop(0.13, 'rgba(194,212,255,.8)');
      glow.addColorStop(0.45, 'rgba(111,143,232,.16)');
      glow.addColorStop(1, 'rgba(100,130,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = `rgba(235,241,255,${0.65 + Math.sin(t / 240) * 0.2})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w / 2 - 14, h / 2);
      ctx.lineTo(w / 2 + 14, h / 2);
      ctx.moveTo(w / 2, h / 2 - 14);
      ctx.lineTo(w / 2, h / 2 + 14);
      ctx.stroke();
      const white = Math.max(0, Math.min(1, (t - 2700) / 600));
      ctx.fillStyle = `rgba(255,255,255,${white})`;
      ctx.fillRect(0, 0, w, h);
      if (t < 3300) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('resize', resize);
    };
  }, [elapsed]);
  return <canvas ref={canvas} className="intro-stars" aria-hidden="true" />;
}

type AthenaIntroProps = {
  contained?: boolean;
  onComplete?: () => void;
  showWordmark?: boolean;
};

export function AthenaIntro({
  contained = false,
  onComplete,
  showWordmark = true,
}: AthenaIntroProps = {}) {
  const [active, setActive] = useState(contained);
  const [time, setTime] = useState(contained ? 0 : INTRO_END);
  const elapsed = useRef(0);
  const skip = useRef<HTMLButtonElement>(null);
  const completed = useRef(false);
  const scene = introAt(time);
  const finish = useCallback(() => {
    if (!contained) {
      try {
        sessionStorage.setItem(INTRO_SESSION_KEY, '1');
      } catch {}
    }
    setActive(false);
    if (!completed.current) {
      completed.current = true;
      onComplete?.();
    }
  }, [contained, onComplete]);

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (!contained) return;
      const frame = requestAnimationFrame(finish);
      return () => cancelAnimationFrame(frame);
    }
    if (contained) return;
    try {
      if (sessionStorage.getItem(INTRO_SESSION_KEY) === '1') return;
    } catch {}
    const frame = requestAnimationFrame(() => {
      setTime(0);
      setActive(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [contained, finish]);

  useEffect(() => {
    if (!active) return;
    const oldOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    if (!contained) document.body.style.overflow = 'hidden';
    skip.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
      if (event.key === 'Tab') {
        event.preventDefault();
        skip.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    let previous = performance.now();
    let frame = 0;
    let lastUpdate = 0;
    const tick = (now: number) => {
      if (!document.hidden) elapsed.current += Math.min(now - previous, 100);
      previous = now;
      if (elapsed.current - lastUpdate >= 30) {
        setTime(elapsed.current);
        lastUpdate = elapsed.current;
      }
      if (elapsed.current >= INTRO_END) {
        finish();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const onReduced = () => {
      if (reduced.matches) finish();
    };
    reduced.addEventListener('change', onReduced);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      if (!contained) document.body.style.overflow = oldOverflow;
      reduced.removeEventListener('change', onReduced);
      document.removeEventListener('keydown', onKey);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [active, contained, finish]);

  if (!active) return showWordmark ? <TypedWordmark /> : null;

  const introContent = (
    <>
      {scene.space && <StarFlight elapsed={elapsed} />}
      {!scene.space && (
        <>
          <div className="intro-fog fog-left" aria-hidden="true" />
          <div className="intro-fog fog-right" aria-hidden="true" />
          <div className="intro-quote-stage">
            <div
              className="intro-quote"
              lang={scene.language}
              aria-hidden="true"
            >
              {scene.text}
              <span className="intro-caret" />
            </div>
            <span className="sr-only">
              그대의 눈을 가리던 안개를 걷어냈다. 신과 인간을 분명히 구별할 수
              있도록.
            </span>
            <div
              className={`intro-citation ${scene.citation ? 'is-visible' : ''}`}
              lang={scene.language}
            >
              <span>
                {scene.language === 'en'
                  ? 'Athena to Diomedes'
                  : '아테나가 디오메데스에게'}
              </span>
              <span>
                {scene.language === 'en'
                  ? 'Homer, Iliad · Book 5, lines 127–128'
                  : '호메로스, 『일리아스』 · 5권 127–128행'}
              </span>
              <small>
                {scene.language === 'en' ? 'Adapted translation' : '발췌 번역'}
              </small>
            </div>
          </div>
        </>
      )}
      <button ref={skip} className="intro-skip" onClick={finish}>
        건너뛰기 <span aria-hidden="true">↗</span>
      </button>
    </>
  );

  const className = `athena-intro ${scene.space ? 'is-space' : ''} ${scene.clearing ? 'is-clearing' : ''}`;
  if (contained) {
    return (
      <div
        className={className}
        aria-label="ATHENA 소개: 안개 너머의 새로운 시야"
      >
        {introContent}
      </div>
    );
  }
  return createPortal(
    <dialog
      open
      className={className}
      aria-modal="true"
      aria-label="ATHENA 소개: 안개 너머의 새로운 시야"
    >
      {introContent}
    </dialog>,
    document.body,
  );
}
