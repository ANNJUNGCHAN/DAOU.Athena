import { ArrowUpRight } from 'lucide-react';
import { techArticles } from '@/lib/tech-articles';

export const metadata = {
  title: 'Tech — ATHENA',
  description:
    'ATHENA가 도구를 선택하고, 투자 기억을 구조화하고, 그래프에서 근거를 찾는 방식을 설명합니다.',
};

const articleRoles = ['유한 선택 판단', '관심의 이유와 출처', '군집과 숨은 연결'];

export default function TechPage() {
  return (
    <main id="main" className="wrap tech-index">
      <header className="tech-index-heading">
        <p className="tech-kicker">ATHENA Tech</p>
        <h1>제품 안에서 작동하는<br />기술을 설명합니다.</h1>
        <p className="tech-index-lead">
          최종 발표의 System 1 판단 모델, Graph Memory, 군집과 숨은 연결을
          현재 구현과 함께 풀었습니다. 앞으로의 학습 계획은 별도로 표시합니다.
        </p>
      </header>

      <div className="tech-index-guide" aria-label="기술문서 읽는 순서">
        <span>정해진 선택지를 평가하고</span>
        <span>관심의 이유를 기억하고</span>
        <span>근거와 연결을 다시 찾습니다</span>
      </div>

      <div className="tech-index-list">
        {techArticles.map((article, index) => (
          <a
            key={article.slug}
            href={`/tech/${article.slug}`}
            className="tech-index-item"
          >
            <span className="tech-index-number">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div className="tech-index-copy">
              <p className="tech-index-role">{articleRoles[index]}</p>
              <h2>{article.title}</h2>
              <p>{article.description}</p>
              <p className="tech-index-question">{article.question}</p>
              <div className="tech-index-modes" aria-label="연결된 제품 모드">
                {article.modes.map((mode) => <span key={mode}>{mode}</span>)}
              </div>
            </div>
            <ArrowUpRight aria-hidden="true" />
          </a>
        ))}
      </div>
    </main>
  );
}
