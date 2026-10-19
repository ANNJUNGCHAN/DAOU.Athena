import { ArrowLeft, ArrowRight, BookOpenText } from 'lucide-react';
import { notFound } from 'next/navigation';
import { features } from '@/lib/content';
import { DownloadButton } from '@/components/download-button';
import { Reveal } from '@/components/reveal';
import { ProductFeatureGallery } from '@/components/product-feature-gallery';
import { FeatureVideo } from '@/components/feature-video';
import { LatestDemoLinks } from '@/components/latest-demo-links';
import { getYoutubeVideo } from '@/lib/youtube-videos';
import '../capabilities.css';

const techLinks: Record<string, { href: string; label: string }> = {
  agora: { href: '/tech/01-tool-selection', label: '도구 선택 기술 읽기' },
  metis: { href: '/tech/03-graph-retrieval', label: '그래프 검색 기술 읽기' },
  aegis: { href: '/tech/02-investment-memory', label: '투자 기억 기술 읽기' },
  ergane: { href: '/tech/01-tool-selection', label: '도구 연결 기술 읽기' },
  pallas: { href: '/tech', label: 'ATHENA 기술 문서 보기' },
  glaux: { href: '/tech', label: 'ATHENA 기술 문서 보기' },
};

export function generateStaticParams() {
  return features.map((feature) => ({ slug: feature.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const feature = features.find((item) => item.slug === slug);
  return {
    title: feature ? `${feature.label} — ATHENA` : '기능을 찾을 수 없습니다.',
  };
}

export default async function FeaturePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const featureIndex = features.findIndex((item) => item.slug === slug);
  if (featureIndex < 0) notFound();

  const feature = features[featureIndex];
  const previous =
    features[(featureIndex - 1 + features.length) % features.length];
  const next = features[(featureIndex + 1) % features.length];
  const tech = techLinks[feature.slug];

  return (
    <main id="main" className="capability-page capability-detail">
      <section className="capability-detail-hero wrap">
        <a href="/features" className="capability-back-link">
          <ArrowLeft size={16} aria-hidden="true" /> 전체 기능
        </a>
        <p className="capability-kicker">{feature.label}</p>
        <h1>{feature.tagline}</h1>
        <p className="capability-detail-lead">{feature.description}</p>
        <DownloadButton />
      </section>

      {getYoutubeVideo(feature.slug) ? (
        <div className="capability-video wide-wrap">
          <Reveal>
            <FeatureVideo slug={feature.slug} />
          </Reveal>
        </div>
      ) : null}

      <LatestDemoLinks slug={feature.slug} />

      <section
        className="capability-points wrap"
        aria-label={`${feature.label} 핵심 기능`}
      >
        {feature.points.map(([title, copy], index) => (
          <Reveal key={title} className="capability-point">
            <span>{String(index + 1).padStart(2, '0')}</span>
            <h2>{title}</h2>
            <p>{copy}</p>
          </Reveal>
        ))}
      </section>

      <ProductFeatureGallery slug={feature.slug} />

      <section
        className="capability-evidence wrap"
        aria-labelledby="capability-evidence-title"
      >
        <div>
          <p className="capability-kicker">HOW IT WORKS</p>
          <h2 id="capability-evidence-title">기능 뒤의 기술도 확인하세요.</h2>
        </div>
        <a href={tech.href} className="capability-tech-link">
          <BookOpenText size={20} aria-hidden="true" /> {tech.label}{' '}
          <ArrowRight size={17} aria-hidden="true" />
        </a>
        <p className="capability-disclaimer">
          {feature.slug === 'pallas'
            ? '백테스트는 과거 데이터와 입력한 가정에 따른 실험 결과이며 미래 수익을 보장하지 않습니다.'
            : feature.slug === 'glaux'
              ? '현재 주문 연동은 모의계좌만 지원하며, 주문은 종목과 수량을 검토한 사용자의 최종 확인 후 진행됩니다.'
              : '화면과 기능의 이용 범위는 연결한 데이터 제공자, 외부 도구와 계정 권한에 따라 달라질 수 있습니다.'}
        </p>
      </section>

      <nav className="capability-explorer wrap" aria-label="다른 기능 살펴보기">
        <a href={`/features/${previous.slug}`}>
          <ArrowLeft size={19} aria-hidden="true" />
          <span>
            <small>이전 기능</small>
            <b>{previous.label}</b>
          </span>
        </a>
        <a href={`/features/${next.slug}`}>
          <span>
            <small>다음 기능</small>
            <b>{next.label}</b>
          </span>
          <ArrowRight size={19} aria-hidden="true" />
        </a>
      </nav>
    </main>
  );
}
