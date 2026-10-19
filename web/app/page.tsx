import { ArrowUpRight, Play } from 'lucide-react';
import { DownloadButton } from '@/components/download-button';
import { ParticleField } from '@/components/particle-field';
import { Reveal } from '@/components/reveal';
import { features } from '@/lib/content';
import { GITHUB_REPO_URL } from '@/lib/github-link';
import { techArticles } from '@/lib/tech-articles';
import { AthenaIntro } from '@/components/athena-intro';
import { FeatureMotion } from '@/components/cinematic-motion';
import { PresentationLauncher } from '@/components/presentation-mode';
import { LaunchFilm } from '@/components/launch-film';
import release from '@/config/product-release.json';

export default function Home() {
  const hasCanonicalPresentation =
    String(release.presentation.status) === 'canonical' &&
    release.presentation.slides === 39 &&
    /^[0-9a-f]{64}$/.test(release.presentation.sha256 ?? '');

  return (
    <main id="main" className="legacy-home">
      <section className="hero">
        <ParticleField />
        <div className="hero-content">
          <AthenaIntro />
          <h1>
            <span>투자의 시야를 가리던</span>
            <br />
            <span>안개를 걷어내다.</span>
          </h1>
          <p className="hero-mist-subtitle">정보 너머의 맥락이 보이도록.</p>
          <div className="hero-actions">
            <DownloadButton />
            <a
              className="button light"
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub 바로가기 (새 탭에서 열림)"
            >
              GitHub 바로가기 <ArrowUpRight size={17} aria-hidden="true" />
            </a>
            <a className="button light" href="/tech">
              Explore Tech
            </a>
            {hasCanonicalPresentation ? (
              <a className="button light" href="/presentation">
                39장 공식 발표자료
              </a>
            ) : (
              <PresentationLauncher />
            )}
            <a className="button light" href="#film">
              <Play size={17} aria-hidden="true" />
              60초 홍보영상
            </a>
          </div>
        </div>
      </section>
      <section
        id="film"
        className="home-promo wrap"
        aria-labelledby="home-promo-title"
      >
        <Reveal>
          <p className="home-intro-label">ATHENA FILM · 60 SECONDS</p>
          <h2 id="home-promo-title" className="statement">
            ATHENA, 60초로 만나보기.
          </h2>
          <p className="home-intro-description">
            대화에서 그래프, 알림과 전략까지.
            <br />
            ATHENA의 새로운 이야기를 만나보세요.
          </p>
        </Reveal>
        <LaunchFilm />
      </section>
      <section className="home-features wrap">
        <Reveal>
          <p className="home-intro-label">
            키움증권이 만드는 AI 투자 워크스페이스
          </p>
          <h2 className="statement">
            투자의 다음 장을,
            <br />한 문장으로 열다.
          </h2>
          <p className="home-intro-description">
            궁금한 것을 묻고, 떠오른 생각을 적어보세요.
            <br />
            ATHENA와 함께 분석하고 검증하는 새로운 투자 방식.
          </p>
        </Reveal>
        {features.map((f) => (
          <section key={f.slug} className="home-feature">
            <div className="home-feature-copy">
              <Reveal>
                <h2>{f.name}</h2>
                <p className="feature-short-description">{f.tagline}</p>
                <p>{f.description}</p>
                <a className="text-link" href={`/features/${f.slug}`}>
                  기능 살펴보기 <ArrowUpRight size={17} aria-hidden="true" />
                </a>
              </Reveal>
            </div>
            <Reveal>
              <FeatureMotion feature={f} />
            </Reveal>
          </section>
        ))}
      </section>
      <section id="resources" className="home-cases wrap">
        <Reveal>
          <h2 className="statement">ATHENA를 만드는 기술.</h2>
        </Reveal>
        <div className="case-grid">
          {techArticles.map((article, index) => (
            <a
              key={article.slug}
              href={`/tech/${article.slug}`}
              className="case-link"
            >
              <span>
                {String(index + 1).padStart(2, '0')} · {article.title}
              </span>
              <ArrowUpRight aria-hidden="true" />
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
