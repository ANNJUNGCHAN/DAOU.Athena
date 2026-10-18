export type TechSlide = {
  page: number;
  title: string;
  src: string;
  alt: string;
  note: string;
  kind: '기술 설명' | '참고 사례' | '향후 계획';
};

export const techSlides: Record<string, TechSlide[]> = {
  '01-tool-selection': [
    {
      page: 50,
      title: 'System 1 판단 모델',
      src: '/tech/slides/s50.png',
      alt: '이전 기술 자료 (55장) 50쪽. System 1이 문장을 생성하는 대신 카드 형태의 선택지를 점수로 평가하는 예시와 앱의 판단 작업을 설명합니다.',
      note: '표시된 퍼센트는 발표 예시 문장에 대한 모델 선택 점수입니다. 전체 정확도나 투자 수익률이 아닙니다. 카드 형태 8가지는 설명 예시이며, 28종류의 판단은 발표 대응 번들 기준입니다.',
      kind: '기술 설명',
    },
    {
      page: 53,
      title: '관련 모델 · Jev와 BloombergGPT',
      src: '/tech/slides/s53.png',
      alt: '이전 기술 자료 (55장) 53쪽. System One의 Jev와 금융 특화 언어 모델 BloombergGPT를 관련 사례로 소개합니다.',
      note: 'Jev와 BloombergGPT는 관련 설계와 연구 사례입니다. ATHENA가 현재 같은 모델을 구현하거나 같은 성능을 낸다는 의미는 아닙니다.',
      kind: '참고 사례',
    },
    {
      page: 54,
      title: '자체 라우팅과 금융 특화 학습 계획',
      src: '/tech/slides/s54.png',
      alt: '이전 기술 자료 (55장) 54쪽. 제한된 System 1 판단에서 자체 라우팅 범위 확장과 금융 특화 추가 학습으로 이어지는 개발 계획입니다.',
      note: '자체 라우팅 범위 확장과 허용된 금융 말뭉치·투자 작업 사례·독립 평가를 통한 추가 학습은 향후 연구·개발 계획입니다.',
      kind: '향후 계획',
    },
  ],
  '02-investment-memory': [
    {
      page: 48,
      title: 'Graph Memory · 관심의 이유와 원문 출처',
      src: '/tech/slides/s48.png',
      alt: '이전 기술 자료 (55장) 48쪽. 금리 때문에 은행주에 관심이 생겼다는 발언을 원문 출처와 시점에 연결하고 나중에 관심 이유를 다시 찾는 흐름입니다.',
      note: '은행주 관심 문장은 발표의 설명 예시입니다. 사용자 발언과 AI 추론을 구분하고, 관심의 이유를 원문 출처·시점과 함께 보존합니다.',
      kind: '기술 설명',
    },
  ],
  '03-graph-retrieval': [
    {
      page: 49,
      title: '기억의 군집과 숨은 연결',
      src: '/tech/slides/s49.png',
      alt: '이전 기술 자료 (55장) 49쪽. 비슷한 기억을 군집으로 묶고 삼성전자와 분할매수 등 서로 다른 군집 사이의 연결을 살펴보는 예시입니다.',
      note: '삼성전자–분할매수는 설명 예시입니다. 숨은 연결은 군집 경계를 넘는 기존 엣지를 상대 점수로 정렬하며 새 관계나 투자 사실을 만들지 않습니다.',
      kind: '기술 설명',
    },
  ],
};
