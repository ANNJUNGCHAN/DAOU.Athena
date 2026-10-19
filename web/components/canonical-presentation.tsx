'use client';

import Image from 'next/image';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import './canonical-presentation.css';

export type CanonicalSlideAsset = {
  number: number;
  file: string;
  sha256: string;
  width: number;
  height: number;
  kind: 'render' | 'poster';
  sourceMedia?: string;
};

export function CanonicalPresentation({
  sourceSha256,
  slides,
}: {
  sourceSha256: string;
  slides: CanonicalSlideAsset[];
}) {
  const [index, setIndex] = useState(0);
  const lastIndex = slides.length - 1;
  const slide = slides[index];

  const move = useCallback(
    (direction: -1 | 1) => {
      setIndex((current) =>
        Math.max(0, Math.min(lastIndex, current + direction)),
      );
    },
    [lastIndex],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      )
        return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        move(1);
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        move(-1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        setIndex(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        setIndex(lastIndex);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [lastIndex, move]);

  if (!slide) return null;

  return (
    <section className="canonical-presentation" aria-label="39장 발표자료 미리보기">
      <header>
        <div>
          <p>ATHENA · 공식 39장 발표자료</p>
          <h1>발표자료 미리보기</h1>
        </div>
        <output aria-live="polite">
          {String(index + 1).padStart(2, '0')} /{' '}
          {String(slides.length).padStart(2, '0')}
        </output>
      </header>

      <figure>
        <Image
          key={slide.file}
          src={`/presentation/slides/${slide.file}`}
          alt={`ATHENA 공식 발표자료 ${slide.number}장`}
          width={slide.width}
          height={slide.height}
          priority={index === 0}
          unoptimized
        />
        <figcaption>
          정적 미리보기입니다. 영상·전환·발표자 노트는 원본 PPTX와 다를 수
          있습니다.
          {slide.kind === 'poster' ? ' 이 장은 영상의 대표 프레임입니다.' : ''}
        </figcaption>
      </figure>

      <nav aria-label="발표자료 장 이동">
        <button
          type="button"
          onClick={() => move(-1)}
          disabled={index === 0}
        >
          <ChevronLeft size={20} aria-hidden="true" /> 이전
        </button>
        <input
          type="range"
          min="1"
          max={slides.length}
          value={index + 1}
          onChange={(event) => setIndex(Number(event.target.value) - 1)}
          aria-label="발표자료 장 선택"
        />
        <button
          type="button"
          onClick={() => move(1)}
          disabled={index === lastIndex}
        >
          다음 <ChevronRight size={20} aria-hidden="true" />
        </button>
      </nav>

      <footer>
        <a href="/">홈으로</a>
        <span title={sourceSha256}>원본 SHA-256 {sourceSha256.slice(0, 12)}…</span>
      </footer>
    </section>
  );
}
