import { techSlides } from '@/lib/tech-slides';
import Image from 'next/image';

export function TechSlideGallery({ slug }: { slug: string }) {
  const slides = techSlides[slug];
  if (!slides) return null;

  return (
    <section className="tech-slide-gallery" aria-labelledby="tech-slides-title">
      <p className="tech-kicker">이전 기술 자료 (55장)</p>
      <h2 id="tech-slides-title">이전 발표 장표로 보는 기술</h2>
      <p className="tech-slide-guide">
        장표를 누르면 원본 이미지를 새 탭에서 크게 볼 수 있습니다. <a href="/presentation">현재 39장 공식 발표 보기</a>
      </p>
      {slides.map((slide) => (
        <figure className="tech-source-slide" key={slide.page}>
          <a
            className="tech-slide-image-link"
            href={slide.src}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${slide.title} · 이전 기술 자료 (55장) ${slide.page}쪽 원본 크게 보기 (새 탭)`}
          >
            <Image src={slide.src} alt={slide.alt} width={1920} height={1080} loading="lazy" unoptimized />
          </a>
          <figcaption>
            <div className="tech-slide-caption-heading">
              <span>이전 기술 자료 (55장) {slide.page}쪽 · {slide.kind}</span>
              <a href={slide.src} target="_blank" rel="noopener noreferrer">원본 크게 보기 <span className="sr-only">(새 탭)</span></a>
            </div>
            <h3>{slide.title}</h3>
            <p>{slide.note}</p>
          </figcaption>
        </figure>
      ))}
    </section>
  );
}
