'use client';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
export function ParticleField() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const context = el.getContext('2d');
    if (!context) return;
    const ctx = context;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0,
      t = 0,
      width = 0,
      height = 0,
      visible = true,
      previous = 0;
    const pointer = { x: 0, y: 0 };
    const draw = (time: number) => {
      if (time - previous < 30) {
        frame = requestAnimationFrame(draw);
        return;
      }
      previous = time;
      ctx.clearRect(0, 0, width, height);
      const count = width < 600 ? 100 : 300;
      for (let i = 0; i < count; i++) {
        const angle = i * 2.399963 + Math.sin(i * 0.7) * 0.25 + t * 0.025;
        const radius = Math.sqrt((i + 0.5) / count);
        const wave = Math.sin(angle * 3 + t + radius * 9) * 18;
        const x =
          width / 2 +
          Math.cos(angle) * (radius * width * 0.75 + wave) +
          pointer.x * radius * 12;
        const y =
          height / 2 +
          Math.sin(angle) * (radius * height * 0.8 + wave) +
          pointer.y * radius * 12;
        const central =
          Math.abs(x - width / 2) < width * 0.36 &&
          y > height * 0.3 &&
          y < height * 0.73;
        ctx.globalAlpha = central ? 0.14 : 0.35 + radius * 0.4;
        ctx.strokeStyle =
          i % 7 === 0 ? '#ee137b' : i % 4 === 0 ? '#9b9fe6' : '#4051df';
        ctx.lineWidth = 1 + radius * 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(
          x + Math.cos(angle + t) * radius * 4,
          y + Math.sin(angle + t) * radius * 4,
        );
        ctx.stroke();
      }
      if (!paused && !reduced.matches && visible && !document.hidden) {
        t += 0.014;
        frame = requestAnimationFrame(draw);
      }
    };
    const start = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    };
    const resize = () => {
      const rect = el.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = width * dpr;
      el.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      start();
    };
    const move = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      pointer.x = (e.clientX - b.left) / b.width - 0.5;
      pointer.y = (e.clientY - b.top) / b.height - 0.5;
    };
    const observer = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible) start();
      else cancelAnimationFrame(frame);
    });
    observer.observe(el);
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    window.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('visibilitychange', start);
    reduced.addEventListener('change', start);
    resize();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      ro.disconnect();
      window.removeEventListener('pointermove', move);
      document.removeEventListener('visibilitychange', start);
      reduced.removeEventListener('change', start);
    };
  }, [paused]);
  return (
    <>
      <canvas ref={canvas} className="particle-canvas" aria-hidden="true" />
      <button
        type="button"
        className="motion-toggle"
        aria-label={
          paused ? '배경 애니메이션 재생' : '배경 애니메이션 일시정지'
        }
        onClick={() => setPaused((p) => !p)}
      >
        {paused ? <Play size={14} /> : <Pause size={14} />}
      </button>
    </>
  );
}
