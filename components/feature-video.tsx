'use client';

import Image from 'next/image';
import { Play, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { features } from '@/lib/content';
import { getYoutubeVideo } from '@/lib/youtube-videos';
import './feature-video.css';

export function FeatureVideo({
  slug,
  presentation = false,
  print = false,
}: {
  slug: string;
  presentation?: boolean;
  print?: boolean;
}) {
  const feature = features.find((item) => item.slug === slug);
  const youtube = getYoutubeVideo(slug);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  if (!feature || !youtube) return null;

  if (print) {
    return (
      <figure className="feature-video feature-video-presentation feature-video-print">
        <div className="feature-video-stage">
          <Image
            src={feature.image}
            alt={`${feature.name} 영상 미리보기`}
            width={1600}
            height={900}
            unoptimized
            loading="eager"
          />
        </div>
        <figcaption>
          <a href={youtube.url}>
            ATHENA {feature.name} 영상 보기 · {youtube.url}
          </a>
        </figcaption>
      </figure>
    );
  }

  const close = () => setOpen(false);

  return (
    <>
      <figure
        className={`feature-video${presentation ? ' feature-video-presentation' : ''}`}
      >
        <div className="feature-video-stage">
          <Image
            src={feature.image}
            alt=""
            fill
            sizes="(max-width: 800px) 92vw, 1500px"
            unoptimized
          />
          <span className="feature-video-shade" aria-hidden="true" />
          <button
            ref={triggerRef}
            type="button"
            className="feature-video-play"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
          >
            <Play size={23} fill="currentColor" aria-hidden="true" />
            Play Video
          </button>
        </div>
        <figcaption>ATHENA {feature.name} 기능 영상</figcaption>
      </figure>

      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <dialog
        ref={dialogRef}
        className="feature-video-dialog"
        aria-labelledby={`feature-video-title-${slug}`}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={() => {
          setOpen(false);
          triggerRef.current?.focus({ preventScroll: true });
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="feature-video-dialog-panel">
          <header>
            <div>
              <p>ATHENA {feature.name}</p>
              <h2 id={`feature-video-title-${slug}`}>{feature.tagline}</h2>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={close}
              aria-label="영상 닫기"
            >
              <X size={23} aria-hidden="true" />
            </button>
          </header>
          <div className="feature-video-player">
            {open ? (
              <iframe
                src={`https://www.youtube.com/embed/${youtube.id}?autoplay=1&rel=0`}
                title={`ATHENA ${feature.name} 전체 영상`}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : null}
          </div>
        </div>
      </dialog>
    </>
  );
}
