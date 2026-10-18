'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Play } from 'lucide-react';

const FILM_ID = 'VvLjTC2nNxo';
const FILM_URL = `https://www.youtube.com/watch?v=${FILM_ID}`;

export function LaunchFilm() {
  const [playing, setPlaying] = useState(false);
  const player = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (playing) player.current?.focus();
  }, [playing]);
  return (
    <figure className="launch-film">
      <div className="launch-film-player">
        {playing ? (
          <iframe
            ref={player}
            src={`https://www.youtube-nocookie.com/embed/${FILM_ID}?autoplay=1&rel=0`}
            title="ATHENA 소개 영상 60초"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button
            type="button"
            className="launch-film-cover"
            onClick={() => setPlaying(true)}
            aria-label="ATHENA 소개 영상 60초 재생"
          >
            <Image
              src="/media/launch/film-poster.webp"
              alt=""
              width={1600}
              height={900}
              unoptimized
              loading="lazy"
              sizes="(max-width: 800px) 92vw, 1440px"
            />
            <span className="launch-film-play">
              <Play size={23} fill="currentColor" aria-hidden="true" />
              <span>60초 영상 보기</span>
            </span>
          </button>
        )}
      </div>
      <figcaption>
        <span>ATHENA 소개 영상</span>
        <a href={FILM_URL} target="_blank" rel="noopener noreferrer">
          YouTube에서 보기 <ArrowUpRight size={15} aria-hidden="true" />
          <span className="sr-only"> (새 탭에서 열림)</span>
        </a>
      </figcaption>
    </figure>
  );
}
