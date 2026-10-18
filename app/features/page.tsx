import Image from 'next/image';
import { ArrowRight, Check, ExternalLink } from 'lucide-react';
import { features } from '@/lib/content';
import { Reveal } from '@/components/reveal';
import { DownloadButton } from '@/components/download-button';
import { StartupWalkthrough } from '@/components/startup-walkthrough';
import './capabilities.css';

export const metadata = { title: '기능 — ATHENA' };

export default function Features() {
  return (
    <main id="main" className="capability-page capability-index">
      <section
        className="capability-hero wrap"
        aria-labelledby="capability-title"
      >
        <p className="capability-kicker">ATHENA CAPABILITIES</p>
        <h1 id="capability-title">
          나의 투자에 맞는
          <br />
          여섯 가지 기능
        </h1>
        <p className="capability-hero-copy">
          질문하고, 연결하고, 확인하고, 실험하는 흐름을 하나의 작업 공간에
          모았습니다. 각 기능이 무엇을 하는지 실제 화면과 함께 살펴보세요.
        </p>
      </section>

      <section className="capability-list wrap" aria-label="ATHENA 기능 목록">
        {features.map((feature, index) => (
          <Reveal key={feature.slug} className="capability-card">
            <a
              href={`/features/${feature.slug}`}
              className="capability-card-visual"
              aria-label={`${feature.label} 기능 자세히 보기`}
            >
              <Image
                src={feature.image}
                alt={`${feature.label} 기능의 실제 제품 화면`}
                fill
                sizes="(max-width: 800px) 100vw, 50vw"
                unoptimized
              />
            </a>
            <div className="capability-card-copy">
              <div className="capability-card-meta">
                <span>{String(index + 1).padStart(2, '0')}</span>
                <span>{feature.label}</span>
              </div>
              <h2>{feature.label}</h2>
              <p>{feature.description}</p>
              <a
                href={`/features/${feature.slug}`}
                className="capability-text-link"
              >
                기능 자세히 보기 <ArrowRight size={17} aria-hidden="true" />
              </a>
            </div>
          </Reveal>
        ))}
      </section>

      <section
        id="start"
        className="capability-start wrap"
        aria-labelledby="capability-start-title"
      >
        <div className="capability-section-heading">
          <p className="capability-kicker">GET STARTED</p>
          <h2 id="capability-start-title">설치부터 첫 질문까지</h2>
        </div>
        <div className="capability-start-layout">
          <Reveal className="capability-start-demo">
            <StartupWalkthrough />
          </Reveal>
          <ol className="capability-start-steps">
            <li>
              <Check aria-hidden="true" />
              <div>
                <h3>Windows 앱 설치</h3>
                <p>ATHENA 설치 파일을 내려받아 앱을 실행합니다.</p>
              </div>
            </li>
            <li>
              <Check aria-hidden="true" />
              <div>
                <h3>사용할 AI CLI 등록</h3>
                <p>
                  Claude, Codex, Grok 중 설치된 CLI를 확인하고 해당 계정에
                  로그인합니다.
                </p>
              </div>
            </li>
            <li>
              <Check aria-hidden="true" />
              <div>
                <h3>키움증권 API 등록</h3>
                <p>
                  <a
                    href="https://openapi.kiwoom.com"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    키움 REST API 홈페이지{' '}
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                  에서 사용 신청 후 발급받은 키를 등록합니다.
                </p>
                <small>현재 주문 연동은 모의계좌만 지원합니다.</small>
              </div>
            </li>
            <li>
              <Check aria-hidden="true" />
              <div>
                <h3>질문으로 시작</h3>
                <p>
                  궁금한 종목, 보고 싶은 자료, 시험할 아이디어를 채팅창에
                  입력합니다.
                </p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section
        className="capability-cta wrap"
        aria-labelledby="capability-cta-title"
      >
        <p className="capability-kicker">ATHENA FOR WINDOWS</p>
        <h2 id="capability-cta-title">
          질문에서 시작하는
          <br />
          나만의 투자 작업 공간
        </h2>
        <DownloadButton />
      </section>
    </main>
  );
}
