'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import './brand-reveal.css';

export function BrandReveal({ dark = false }: { dark?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setEntered(true); observer.disconnect(); }
    }, { threshold: 0.3 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const host = ref.current;
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!host || !element || !context) return;
    const surface = host.parentElement!;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0, height = 0, frame = 0, visible = false, previous = 0;
    const pointer = { x: -1000, y: -1000 };
    const resize = () => {
      width = host.clientWidth; height = host.clientHeight;
      const dpr = Math.min(devicePixelRatio, 2);
      element.width = width * dpr; element.height = height * dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const move = (event: PointerEvent) => {
      const box = host.getBoundingClientRect();
      pointer.x = event.clientX - box.left; pointer.y = event.clientY - box.top;
      host.style.setProperty('--pointer-x', `${pointer.x}px`);
      host.style.setProperty('--pointer-y', `${pointer.y}px`);
      host.style.setProperty('--parallax-x', `${(pointer.x / width - .5) * 20}px`);
      host.style.setProperty('--parallax-y', `${(pointer.y / height - .5) * 14}px`);
    };
    const leave = () => {
      pointer.x = -1000; pointer.y = -1000;
      host.style.removeProperty('--pointer-x'); host.style.removeProperty('--pointer-y');
      host.style.setProperty('--parallax-x', '0px'); host.style.setProperty('--parallax-y', '0px');
    };
    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      if (!visible || document.hidden || time - previous < 32) return;
      previous = time;
      context.clearRect(0, 0, width, height);
      const t = reduced.matches ? 0 : time / 1000;
      const count = dark ? (width < 600 ? 200 : 540) : (width < 600 ? 180 : 650);
      for (let i = 0; i < count; i++) {
        const u = ((i * 0.61803398875) % 1);
        const v = ((i * 0.41421356237) % 1);
        let x = u * width + Math.sin(t * .22 + i) * 12;
        let y = v * height + Math.cos(t * .18 + i * .7) * 14;
        const orbit = i % 4 !== 0;
        const angle = u * Math.PI * 2 + t * .035;
        if (orbit) {
          const radius = .28 + v * .4;
          x = width * .7 + Math.cos(angle) * width * radius * .62;
          y = height * .48 + Math.sin(angle) * height * radius * 1.25;
          x += Math.sin(angle * 3 + t * .25) * 18;
        }
        const dx = x - pointer.x, dy = y - pointer.y;
        const distance = Math.hypot(dx, dy);
        const force = !reduced.matches && distance < 180 ? (1 - distance / 180) : 0;
        if (!dark) {
          x += dx / Math.max(distance, 1) * force * 44;
          y += dy / Math.max(distance, 1) * force * 44;
        }
        const textZone = !dark && x < width * .48 && y < height * .48;
        context.globalAlpha = textZone ? .06 : (dark ? .3 : orbit ? .36 : .13) + force * .5;
        context.fillStyle = i % 7 === 0 ? '#e93398' : dark ? '#9aa6ff' : '#5463cf';
        if (dark) {
          const light = Math.max(0, 1 - distance / 360);
          const twinkle = (Math.sin(t * .85 + i * 1.7) + 1) * .5;
          context.globalAlpha = .26 + twinkle * .24 + light * .5;
          context.fillStyle = orbit ? '#8995ff' : '#f2f4ff';
          if (i % 11 === 0) {
            const halo = context.createRadialGradient(x, y, 0, x, y, 5 + twinkle * 3);
            halo.addColorStop(0, orbit ? '#aab4ff80' : '#ffffffa0');
            halo.addColorStop(1, '#8995ff00');
            context.globalAlpha = .3 + twinkle * .22;
            context.fillStyle = halo;
            context.beginPath(); context.arc(x, y, 5 + twinkle * 3, 0, Math.PI * 2); context.fill();
          }
          context.globalAlpha = .42 + twinkle * .38 + light * .35;
          context.fillStyle = orbit ? '#a7b0ff' : '#ffffff';
          context.beginPath(); context.arc(x, y, .65 + (i % 4) * .24 + twinkle * .32 + light * .45, 0, Math.PI * 2); context.fill();
        } else {
          context.save(); context.translate(x, y); context.rotate(orbit ? angle * .3 : .1);
          context.fillRect(-.7, -3, 1.4, orbit ? 5 + v * 6 : 3);
          context.restore();
        }
      }
      context.globalAlpha = 1;
    };
    const observer = new ResizeObserver(resize); observer.observe(host);
    const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }); visibility.observe(host);
    if (dark) { surface.addEventListener('pointermove', move); surface.addEventListener('pointerleave', leave); }
    resize(); frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); visibility.disconnect(); surface.removeEventListener('pointermove', move); surface.removeEventListener('pointerleave', leave); };
  }, [dark]);
  return <div ref={ref} className={`brand-reveal${dark ? ' brand-reveal-dark' : ''}${entered ? ' brand-reveal-entered' : ''}`} aria-hidden="true">
    <canvas ref={canvas} className="brand-reveal-field" />
    {dark && <div className="brand-reveal-pointer-light" />}
    <div className="brand-reveal-glow" />
    <div className="brand-reveal-mist brand-reveal-mist-one" />
    <div className="brand-reveal-mist brand-reveal-mist-two" />
    {dark && <div className="brand-reveal-spotlight"><div className="brand-reveal-word"><span className="brand-reveal-metal" /><Image className="brand-reveal-logo" src="/brand/athena.png" alt="" width={600} height={150} unoptimized /></div></div>}
    <div className="brand-reveal-word">
      <span className="brand-reveal-ghost">ATHENA</span>
      <span className="brand-reveal-typed"><span className="brand-reveal-letters" /><span className="brand-reveal-caret" /></span>
      <span className="brand-reveal-metal" />
      <Image className="brand-reveal-logo" src="/brand/athena.png" alt="" width={600} height={150} unoptimized />
    </div>
    <div className="brand-reveal-horizon" />
  </div>;
}
