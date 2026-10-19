export type PresentationTechStep = {
  label: string;
  title: string;
  description: string;
};

export type PresentationTechDetail = {
  term: string;
  description: string;
};

export type PresentationTechFigure = {
  src: string;
  reducedMotionSrc?: string;
  alt: string;
  label: string;
  caption?: string;
  links?: { label: string; href: string }[];
  paper?: boolean;
};

export type PresentationTechPage = {
  eyebrow: string;
  title: string;
  lead: string;
  figures: PresentationTechFigure[];
  steps: PresentationTechStep[];
  distinction: { label: string; text: string };
  details: PresentationTechDetail[];
};

export type PresentationTechArticle = {
  slug: string;
  articleTitle: string;
  modes: string[];
  pages: [PresentationTechPage, PresentationTechPage];
};

export const presentationTechArticles: PresentationTechArticle[] = [
  {
    slug: '01-tool-selection',
    articleTitle: 'System 1 판단 모델',
    modes: ['대화', '플러그인'],
    pages: [
      {
        eyebrow: '01 · SYSTEM 1 · 1/2',
        title: '글 생성과 유한 선택 판단을 나눕니다',
        lead: '작업마다 정해진 선택지를 평가합니다. 판단 계약은 거절·보류·임계값을 표현할 수 있지만, 현재 v018 정책은 임계값 0과 force_non_defer를 적용해 거절 라벨을 제외한 최고 점수 후보를 선택합니다. 발표 기준 28종류의 판단을 다루며, 카드 형태 8가지는 발표의 설명 예시입니다.',
        figures: [
          {
            src: '/tech/assets/beginner-01.svg',
            reducedMotionSrc: '/tech/assets/beginner-01-static.svg',
            alt: '사용자 질문이 요청 해석, 도구 확인, 데이터 조회, 차트 표시로 이어지는 흐름',
            label: '질문에서 차트까지',
          },
          {
            src: '/tech/assets/toolrerank-figure-2-original.png',
            alt: 'Dual Encoder 검색부터 Adaptive Truncation, Cross Encoder와 계층 기반 재정렬로 이어지는 ToolRerank Figure 2 원본',
            label: '연구 참고 구조',
            caption:
              'Zheng et al., 2024, ToolRerank, Figure 2, p. 16265(PDF 3쪽) 원본 크롭 · © 2024 ELRA Language Resource Association · CC BY-NC 4.0',
            links: [
              {
                label: '라이선스',
                href: 'https://creativecommons.org/licenses/by-nc/4.0/',
              },
              {
                label: '논문 원문',
                href: 'https://aclanthology.org/2024.lrec-main.1413/',
              },
            ],
            paper: true,
          },
        ],
        steps: [
          {
            label: 'INTERPRET',
            title: '작업과 선택지를 정합니다',
            description: '자유로운 글 대신 작업별 유한 라벨을 평가합니다.',
          },
          {
            label: 'RETRIEVE',
            title: '점수와 현재 정책을 확인합니다',
            description: '유한 logits를 softmax로 변환하고 정책에 따라 채택 여부를 반환합니다.',
          },
          {
            label: 'CHECK',
            title: '판단 정책과 실행 검증을 나눕니다',
            description: 'v018은 임계값 0에서 defer를 제외한 최고 점수 후보를 선택합니다.',
          },
        ],
        distinction: {
          label: '논문과 실제 구현',
          text: 'ToolRerank는 검색·재정렬의 참고 연구입니다. 해당 논문의 학습 모델 배포를 주장하지 않습니다. 현재 ATHENA는 제한된 판단 보정과 별도의 스키마·권한 검증을 사용합니다.',
        },
        details: [
          {
            term: 'ToolRerank',
            description:
              '논문은 Dual Encoder로 후보를 찾고 Cross Encoder와 계층 기반 재정렬로 상위 k개를 LLM에 전달합니다.',
          },
          {
            term: 'System 1 판단 계약',
            description:
              '판단 결과는 라벨·임계값·채택 여부·사유를 포함합니다. 현재 v018 강제 선택 정책은 새 정확도 보장을 뜻하지 않으며, 모델의 출력은 도구를 실행할 권한이 아닙니다.',
          },
        ],
      },
      {
        eyebrow: '01 · SYSTEM 1 · 2/2',
        title: '판단은 보정하고, 실행은 별도 계약으로 검증합니다',
        lead: '도구 후보의 관련성 보정에는 인증 문맥과 카탈로그 버전 등 조건이 필요합니다. 전체 후보와 호출자가 제공한 인자를 유지하며, 서명 계획과 일회용 nonce를 검사한 뒤 호출합니다.',
        figures: [
          {
            src: '/tech/assets/beginner-02.svg',
            reducedMotionSrc: '/tech/assets/beginner-02-static.svg',
            alt: '단어 점수로 후보를 찾고 입력 조건을 검사하는 ATHENA의 과정',
            label: 'ATHENA 후보 검색과 조건 검사',
          },
          {
            src: '/tech/assets/beginner-03.svg',
            reducedMotionSrc: '/tech/assets/beginner-03-static.svg',
            alt: '서명 계획의 nonce를 소비하고 봉인 인자를 검사한 뒤 호출하거나 거절하는 과정',
            label: '일회성 실행 계획',
          },
        ],
        steps: [
          {
            label: 'CLASSIFY',
            title: '관련성을 제한적으로 보정합니다',
            description: '허용된 조건에서만 보정하고 전체 후보를 유지합니다.',
          },
          {
            label: 'VALIDATE',
            title: '서버가 검사합니다',
            description: '도구 식별·인자·스키마·권한·범위를 검사합니다.',
          },
          {
            label: 'EXECUTE',
            title: '한 번만 실행합니다',
            description:
              'nonce를 소비한 뒤 봉인 인자를 확인하며 계획을 재사용하지 않습니다.',
          },
        ],
        distinction: {
          label: '판단과 실행의 경계',
          text: '조회는 주문 계획을 거절합니다. 모의투자 주문에는 건별 사용자 확인이 필요하고, 실계좌 주문과 모든 계정의 자동매매는 제품 범위 밖입니다.',
        },
        details: [
          {
            term: '현재의 판단 범위',
            description:
              '등록된 유한 작업 안에서만 판단합니다. MCP 응답 캐시는 search·describe에만 적용되며 resolve·call은 캐시하지 않습니다.',
          },
          {
            term: '향후 학습 계획',
            description:
              '자체 라우팅 범위 확장 후 허용된 금융 말뭉치·투자 작업 사례·독립 평가로 기반 모델을 미세 조정할 계획입니다. 현재 배포된 금융 LLM이라는 뜻은 아닙니다.',
          },
        ],
      },
    ],
  },
  {
    slug: '02-investment-memory',
    articleTitle: 'Graph Memory',
    modes: ['대화', '그래프', '알림'],
    pages: [
      {
        eyebrow: '02 · GRAPH MEMORY · 1/2',
        title: '관심의 이유를 원문 출처와 함께 기억합니다',
        lead: '“금리 때문에 은행주에 관심 생겼어”는 발표의 설명 예시입니다. 관심의 대상과 이유를 원문 출처·시점에 연결해 나중에 왜 관심이 생겼는지 근거를 다시 조회합니다. 사용자 발언과 AI 추론, 계좌 사실을 구분합니다.',
        figures: [
          {
            src: '/tech/assets/beginner-05.svg',
            reducedMotionSrc: '/tech/assets/beginner-05-static.svg',
            alt: '관심 표현과 투자 사실을 구분하는 예시',
            label: '관심 표현과 투자 사실',
          },
          {
            src: '/tech/assets/beginner-06.svg',
            reducedMotionSrc: '/tech/assets/beginner-06-static.svg',
            alt: '대화와 거래 데이터가 서로 다른 경로로 저장되는 과정',
            label: '출처별 입력 경로',
          },
        ],
        steps: [
          {
            label: 'CONVERSATION',
            title: '대화는 구조화해 추출합니다',
            description: '개체·관계·명시성·근거를 정해진 JSON으로 받습니다.',
          },
          {
            label: 'ACCOUNT',
            title: '거래는 규칙으로 옮깁니다',
            description: '체결·보유 정보에는 LLM의 해석을 넣지 않습니다.',
          },
          {
            label: 'PROVENANCE',
            title: '근거를 같이 남깁니다',
            description: '출처·원문·시점과 명시성 상태를 각각 기록합니다.',
          },
        ],
        distinction: {
          label: '핵심 원칙',
          text: 'EXTRACTED · INFERRED · AMBIGUOUS는 원문에 얼마나 분명히 드러났는지를 나타냅니다. 명시성과 출처를 한 점수로 합치지 않습니다.',
        },
        details: [
          {
            term: 'Structured Extraction',
            description:
              '요청 ID와 원문 지문이 다르거나 JSON 형식 검사를 통과하지 못한 결과는 그래프에 저장하지 않습니다.',
          },
          {
            term: '우선순위',
            description:
              '사용자 수정과 체결·보유에서 확인한 사실을 대화 추론보다 먼저 적용합니다.',
          },
        ],
      },
      {
        eyebrow: '02 · GRAPH MEMORY · 2/2',
        title: '같은 의미는 묶고, 위험한 병합은 막습니다',
        lead: '“반도체 산업”, “반도체 업종”, “반도체”처럼 표현이 달라도 같은 관심사를 가리킬 수 있습니다. 별칭과 이름, 연결 관계를 차례로 비교해 대표 노드로 정리합니다.',
        figures: [
          {
            src: '/tech/assets/beginner-07.svg',
            reducedMotionSrc: '/tech/assets/beginner-07-static.svg',
            alt: '여러 이름을 하나의 대상으로 정리하는 과정',
            label: 'Entity Resolution',
          },
        ],
        steps: [
          {
            label: 'ALIAS',
            title: '정확한 별칭을 먼저 봅니다',
            description: '고정된 별칭이 맞으면 같은 후보로 연결합니다.',
          },
          {
            label: 'SIMILARITY',
            title: '유사도를 제한해 비교합니다',
            description: '이름 0.6, 이웃 관계 0.8 이상에서만 연결합니다.',
          },
          {
            label: 'UNION-FIND',
            title: '대표 노드를 고릅니다',
            description: '관계 수·별칭 수·생성 순서로 한 묶음을 정리합니다.',
          },
        ],
        distinction: {
          label: '병합 보호',
          text: '종목은 이름이 비슷하다는 이유로 합치지 않고 종목코드로 구분합니다. 투자자 프로필도 자동 병합에서 제외합니다.',
        },
        details: [
          {
            term: '이웃 비교 조건',
            description:
              '이웃 관계 유사도는 두 대상 모두 연결된 이웃이 2개 이상일 때만 비교합니다.',
          },
          {
            term: '사용 위치',
            description:
              '정리된 그래프는 근거 확인, 다음 대화, 맞춤 알림에 다시 사용됩니다.',
          },
        ],
      },
    ],
  },
  {
    slug: '03-graph-retrieval',
    articleTitle: '그래프 검색 · 군집과 숨은 연결',
    modes: ['그래프'],
    pages: [
      {
        eyebrow: '03 · GRAPH RETRIEVAL · 1/2',
        title: '대상을 확정한 뒤, 근거 원문까지 찾습니다',
        lead: '“삼성”처럼 여러 기업을 가리킬 수 있는 이름은 먼저 그래프의 한 점과 연결합니다. 대상이 정해진 뒤 관계와 판단 이유, 출처 원문을 함께 가져옵니다.',
        figures: [
          {
            src: '/tech/assets/beginner-09.svg',
            reducedMotionSrc: '/tech/assets/beginner-09-static.svg',
            alt: '질문에서 그래프의 대상을 찾는 과정',
            label: 'Entity Retrieval',
          },
          {
            src: '/tech/assets/beginner-10.svg',
            reducedMotionSrc: '/tech/assets/beginner-10-static.svg',
            alt: '관계와 근거 원문을 함께 되돌려주는 흐름',
            label: 'Evidence Grounding',
          },
        ],
        steps: [
          {
            label: 'IDENTIFY',
            title: 'ID를 먼저 확인합니다',
            description: '화면이 넘긴 ID가 있으면 그 대상을 직접 찾습니다.',
          },
          {
            label: 'SEARCH',
            title: '후보를 최대 5개만 찾습니다',
            description: 'ID가 없을 때 FTS5/BM25로 이름과 별칭을 검색합니다.',
          },
          {
            label: 'GROUND',
            title: '관계와 원문을 묶습니다',
            description: '방향·시점·rationale·provenance·발췌문을 반환합니다.',
          },
        ],
        distinction: {
          label: '제한된 RAG',
          text: '정확히 일치하는 이름이 하나이거나 후보가 하나일 때만 확정합니다. 여러 후보가 남으면 추측하지 않고 사용자가 고를 목록을 보여줍니다.',
        },
        details: [
          {
            term: 'FTS5 / BM25',
            description:
              'SQLite 전문 검색과 순위 계산으로 이름·별칭 후보를 제한하고 정확한 일치 여부를 다시 검사합니다.',
          },
          {
            term: 'Evidence Grounding',
            description:
              '관계의 한 줄 판단 이유와 원문 발췌, 출처 ID를 함께 조회해 그래프의 선을 원래 기록까지 되짚게 합니다.',
          },
        ],
      },
      {
        eyebrow: '03 · CLUSTERS & CONNECTIONS · 2/2',
        title: '비슷한 기억을 묶고 군집 사이의 연결을 찾습니다',
        lead: '군집 경계를 넘는 기존 엣지를 surprise_score의 상대 순서로 보여줍니다. 새 관계를 만들거나 사실을 확정하지 않습니다. 삼성전자–분할매수는 설명 예시이며 사용자의 실제 기록이나 투자 추천이 아닙니다.',
        figures: [
          {
            src: '/tech/assets/beginner-11.svg',
            reducedMotionSrc: '/tech/assets/beginner-11-static.svg',
            alt: '점과 선을 클러스터로 묶고 이름표를 만드는 과정',
            label: 'Community Detection',
          },
        ],
        steps: [
          {
            label: 'CLUSTER',
            title: '연결이 촘촘한 점을 묶습니다',
            description: 'Greedy Modularity로 클러스터를 계산합니다.',
          },
          {
            label: 'STABILIZE',
            title: '표시 순서를 고정합니다',
            description: '크기와 노드 ID로 번호를 정해 흔들림을 줄입니다.',
          },
          {
            label: 'LABEL',
            title: '기계적 이름과 AI 추정을 나눕니다',
            description: '최고 차수 노드가 기본 라벨이며 AI 이름은 선택 사항입니다.',
          },
        ],
        distinction: {
          label: '결정적인 구조',
          text: '연결이 없는 점은 미분류로 남습니다. AI 라벨이 실패해도 기계적 라벨은 유지되고, 숨은 연결은 이미 존재하는 관계만 다시 정렬합니다.',
        },
        details: [
          {
            term: 'Greedy Modularity',
            description:
              '클러스터 안의 연결은 많고 클러스터 사이의 연결은 적도록 노드를 차례로 묶습니다.',
          },
          {
            term: 'Label Cache',
            description:
              '클러스터 구성과 라벨링 프롬프트가 같으면 저장해 둔 이름을 다시 사용합니다.',
          },
        ],
      },
    ],
  },
];

export const presentationTechPageCountBySlug = Object.fromEntries(
  presentationTechArticles.map((article) => [
    article.slug,
    article.pages.length,
  ]),
);

export function getPresentationTechPage(slug: string, pageIndex: number) {
  const article = presentationTechArticles.find((item) => item.slug === slug);
  const page = article?.pages[pageIndex];
  return article && page ? { article, page } : undefined;
}
