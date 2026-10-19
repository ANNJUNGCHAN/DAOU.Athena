'use client';

import Image from 'next/image';
import { useRef } from 'react';
import { ArrowUpRight, Maximize2, X } from 'lucide-react';
import type { PresentationTechFigure as TechFigure } from '@/lib/presentation-tech';
import { getPresentationTechPage } from '@/lib/presentation-tech';
import './presentation-tech.css';

function PresentationTechFigure({
  figure,
  printMode = false,
}: {
  figure: TechFigure;
  printMode?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = () => dialogRef.current?.close();

  return (
    <figure className={figure.paper ? 'is-paper-figure' : undefined}>
      <span>{figure.label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="presentation-tech-figure-trigger"
        aria-label={`${figure.label} 도식 크게 보기`}
        onClick={() => dialogRef.current?.showModal()}
      >
        <picture>
          {figure.reducedMotionSrc ? (
            <source
              media="print, (prefers-reduced-motion: reduce)"
              srcSet={figure.reducedMotionSrc}
            />
          ) : null}
          <Image
            src={
              printMode ? (figure.reducedMotionSrc ?? figure.src) : figure.src
            }
            alt={figure.alt}
            width={960}
            height={540}
            unoptimized
            priority
          />
        </picture>
        <Maximize2 aria-hidden="true" size={15} strokeWidth={1.7} />
      </button>
      {figure.caption ? (
        <figcaption>
          {figure.caption}
          {figure.links?.map((link) => (
            <a
              href={link.href}
              key={link.href}
              target="_blank"
              rel="noreferrer"
            >
              {link.label}
            </a>
          ))}
        </figcaption>
      ) : null}

      <dialog
        ref={dialogRef}
        className="presentation-tech-figure-dialog"
        aria-label={`${figure.label} 확대 도식`}
        onClose={() => triggerRef.current?.focus({ preventScroll: true })}
      >
        <div>
          <header>
            <p>{figure.label}</p>
            <button type="button" aria-label="확대 도식 닫기" onClick={close}>
              <X aria-hidden="true" size={20} strokeWidth={1.5} />
            </button>
          </header>
          <picture>
            {figure.reducedMotionSrc ? (
              <source
                media="print, (prefers-reduced-motion: reduce)"
                srcSet={figure.reducedMotionSrc}
              />
            ) : null}
            <Image
              src={figure.src}
              alt={figure.alt}
              width={1600}
              height={900}
              unoptimized
            />
          </picture>
          {figure.caption ? (
            <footer>
              <p>{figure.caption}</p>
              <div>
                {figure.links?.map((link) => (
                  <a
                    href={link.href}
                    key={link.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {link.label}
                    <ArrowUpRight
                      aria-hidden="true"
                      size={13}
                      strokeWidth={1.7}
                    />
                  </a>
                ))}
              </div>
            </footer>
          ) : null}
        </div>
      </dialog>
    </figure>
  );
}

export function PresentationTechSlide({
  slug,
  pageIndex = 0,
  printMode = false,
}: {
  slug: string;
  pageIndex?: number;
  printMode?: boolean;
}) {
  const content = getPresentationTechPage(slug, pageIndex);

  if (!content) return null;

  const { article, page } = content;

  return (
    <article className="presentation-tech-slide">
      <div className="presentation-tech-main">
        <div className="presentation-tech-copy">
          <div className="presentation-tech-heading">
            <p className="pm-eyebrow">{page.eyebrow}</p>
            <h2>{page.title}</h2>
            <p className="presentation-tech-lead">{page.lead}</p>
          </div>

          <div className="presentation-tech-distinction">
            <span>{page.distinction.label}</span>
            <p>{page.distinction.text}</p>
          </div>
          <p className="presentation-tech-explanation">
            {page.steps.map((step) => step.description).join(' ')}
          </p>
        </div>

        <div className="presentation-tech-visual">
          <div
            className={`presentation-tech-figures presentation-tech-figures-${page.figures.length}`}
          >
            {page.figures.map((figure) => (
              <PresentationTechFigure
                figure={figure}
                key={figure.src}
                printMode={printMode}
              />
            ))}
          </div>
          <div className="presentation-tech-meta">
            <div aria-label="연결된 ATHENA 기능">
              {article.modes.map((mode) => (
                <span key={mode}>{mode}</span>
              ))}
            </div>
            <a
              href={`/tech/${article.slug}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`${article.articleTitle} 기술 원문 새 탭에서 보기`}
            >
              기술 원문
              <ArrowUpRight aria-hidden="true" size={14} strokeWidth={1.7} />
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}
