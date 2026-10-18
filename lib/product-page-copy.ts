export type ProductFeature = {
  title: string;
  description: string;
  image: string;
  imageAlt: string;
};

export type ProductSubfeature = {
  title: string;
  description: string;
  icon:
    | 'file-question'
    | 'sliders'
    | 'network'
    | 'pencil'
    | 'activity'
    | 'search';
};

export type ProductPageCopy = {
  name: string;
  intro: string;
  mainFeatures: readonly ProductFeature[];
  subfeatures?: readonly ProductSubfeature[];
};

export const productPageCopy: Record<string, ProductPageCopy> = {
  agora: {
    name: '대화',
    intro:
      '대화는 질문이 곧 작업이 되는 AI 투자 공간입니다. 말로 필요한 화면을 열고, 내 자료와 화면 속 결과를 함께 분석하며, 모의투자 주문 티켓까지 하나의 대화로 이어갑니다.',
    mainFeatures: [
      {
        title: '화면 호출',
        description:
          '차트, 시세, 공시처럼 필요한 정보를 말하면 질문에 맞는 화면이 열립니다. 대화를 이어가며 자료를 더하고, 지금 궁금한 내용을 한곳에서 살펴보세요.',
        image: '/media/product-features/agora-01.png',
        imageAlt:
          '대화로 요청한 차트와 투자 정보 화면이 함께 열리는 화면 호출 예시',
      },
      {
        title: '화면 대화',
        description:
          '보고 있는 창이나 차트 구간, 표의 항목을 짚어 질문하세요. AI가 같은 자료를 바탕으로 의미를 설명하고, 다른 결과와 비교해줍니다.',
        image: '/media/product-features/agora-02.png',
        imageAlt:
          '선택한 차트 구간을 바탕으로 질문과 분석이 이어지는 화면 대화 예시',
      },
      {
        title: '대화주문',
        description:
          '종목과 수량, 가격을 말하면 모의투자 주문 티켓이 만들어집니다. 대화로 조건을 다듬고, 주문마다 최종 내용을 확인한 뒤 직접 실행하세요. 실계좌 주문과 자동매매는 지원하지 않습니다.',
        image: '/media/product-features/agora-03.png',
        imageAlt:
          '대화 내용으로 주문 조건을 구성하고 최종 확인하는 주문 예시',
      },
    ],
    subfeatures: [
      {
        title: '자료 대화',
        description:
          '파일을 첨부하거나 폴더를 지정해 내 자료를 대화에 연결하세요. 문서에 담긴 내용과 시장 정보를 함께 살펴보며 나만의 분석을 이어갈 수 있습니다.',
        icon: 'file-question',
      },
      {
        title: '대화 설정',
        description:
          '목표 모드와 계획 모드 등 작업에 맞는 대화 방식을 선택하세요. 사용할 AI 모델과 사고 정도도 조절해 질문의 목적과 깊이에 맞출 수 있습니다.',
        icon: 'sliders',
      },
    ],
  },
  metis: {
    name: '그래프',
    intro:
      '그래프는 대화와 사용자가 확인한 기록, 보유·체결 정보를 나만의 지식으로 연결하는 AI 기억 공간입니다. 출처가 남는 기록을 함께 펼쳐놓고 대화하며 나에게 맞는 제안을 받을 수 있습니다.',
    mainFeatures: [
      {
        title: '활동 기억',
        description:
          '대화에서 남긴 관심과 사용자가 확인한 수동 기록, 입력된 보유·체결 정보를 출처와 함께 연결합니다. 요약 화면에서 내 관심사와 판단이 어떻게 쌓이고 달라졌는지 살펴보세요.',
        image: '/media/product-features/metis-01.png',
        imageAlt:
          '대화와 분석 활동이 시간의 흐름에 따라 정리되는 그래프 활동 기억 예시',
      },
      {
        title: '지식 대화',
        description:
          '노드를 골라 “내가 이 종목을 왜 지켜봤지?”라고 물어보세요. 관련 대화와 자료, 관계의 근거를 함께 짚어주어 배경을 다시 설명하지 않고 생각을 이어갈 수 있습니다.',
        image: '/media/product-features/metis-02.png',
        imageAlt:
          '지식 그래프의 노드를 선택해 연결된 근거와 대화하는 예시',
      },
      {
        title: '맞춤 추천',
        description:
          'AI가 그래프에 쌓인 관심사와 판단을 바탕으로 자료, 비교 대상, 다음 질문을 추천합니다. 어떤 활동과 연결에서 나온 제안인지 근거도 함께 보여줍니다.',
        image: '/media/product-features/metis-03.png',
        imageAlt:
          '지식 그래프를 근거로 다음 자료와 질문을 제안하는 맞춤 추천 예시',
      },
    ],
    subfeatures: [
      {
        title: '클러스터',
        description:
          '서로 연관된 종목과 주제, 판단과 활동을 클러스터로 묶어 보여줍니다. 각 기록의 관계를 따라가며 따로 살펴보던 관심사 사이의 숨은 연결도 발견할 수 있습니다.',
        icon: 'network',
      },
      {
        title: '기억 수정',
        description:
          'AI가 잘못 이해한 관심이나 관계를 대화로 바로잡으세요. 수정 내용을 확인해 반영하면, 이후의 대화와 추천도 더 정확해진 맥락을 바탕으로 이어집니다.',
        icon: 'pencil',
      },
    ],
  },
  aegis: {
    name: '알림',
    intro:
      '알림은 나의 관심을 이해하고, 필요한 순간에 먼저 알려주는 AI 에이전트입니다. 지식 그래프와 연결된 데이터를 바탕으로 변화를 감시하며, 조건과 일정을 말하면 알림부터 분석 작업까지 맡아줍니다.',
    mainFeatures: [
      {
        title: '맞춤 알람',
        description:
          '그래프에 쌓인 관심 종목과 분석 주제, 이전 판단을 바탕으로 나에게 중요한 변화를 알려줍니다. 어떤 일이 생겼는지와 함께 왜 내 관심사에 관련되는지도 설명합니다.',
        image: '/media/product-features/aegis-01.png',
        imageAlt:
          '관심 종목과 이전 판단을 근거로 중요한 변화를 설명하는 알림 예시',
      },
      {
        title: '대화형 자동화',
        description:
          '“매일 장 마감 후 정리해줘”, “이 조건이 충족되면 분석해줘”처럼 원하는 일을 말하세요. 반복 작업과 여러 조건을 조합한 감시를 설정하고, 변경도 대화로 이어갈 수 있습니다.',
        image: '/media/product-features/aegis-02.png',
        imageAlt: '대화로 일정과 조건을 구성하는 알림 자동화 설정 예시',
      },
      {
        title: '통합 감시',
        description:
          '키움 REST API와 플러그인에서 지정한 모든 MCP의 데이터를 감시 조건으로 활용합니다. 시세 변화와 새 공시, 외부 서비스의 소식을 함께 확인하고 필요한 순간에 알려줍니다.',
        image: '/media/product-features/aegis-03.png',
        imageAlt:
          '키움 REST API와 여러 MCP 데이터를 하나의 조건으로 감시하는 알림 예시',
      },
    ],
  },
  ergane: {
    name: '플러그인',
    intro:
      '플러그인은 투자정보와 외부 서비스를 연결해 ATHENA의 모든 모드를 확장하는 MCP 허브입니다. 연결에 필요한 설정을 안내하고, 한 번 연결한 도구를 질문과 분석, 감시와 전략 연구에 맞게 활용하도록 돕습니다.',
    mainFeatures: [
      {
        title: '투자정보 연동',
        description:
          '여러  데이터를 제공하는 MCP로 시세, 기업정보, 뉴스 등 모든 것을  받아봅니다. 내가 고른 정보들을 모아 질문하고 분석할 수 있습니다.',
        image: '/media/product-features/ergane-01.png',
        imageAlt:
          '여러 투자 정보 MCP의 데이터가 한곳에 연결되는 플러그인 연동 예시',
      },
      {
        title: '서비스 연동',
        description:
          '디스코드, 텔레그램, 슬랙과 연결해 모바일에서도 Athena를 사용하세요. 익숙한 메신저에서 질문하고, 알림과 분석 결과를 받아보며 PC 밖에서도 작업을 이어갈 수 있습니다.',
        image: '/media/product-features/ergane-02.png',
        imageAlt:
          '메신저와 ATHENA의 질문 및 알림이 연결되는 플러그인 서비스 연동 예시',
      },
      {
        title: '도구 호출',
        description:
          'Athena의 모든 모드에서 필요한 도구를 @로 호출해  활용하세요. 같은 도구를 대화의 자료로, 감시의 조건으로, 전략 연구의 재료로 연결할 수 있습니다.',
        image: '/media/product-features/ergane-03.png',
        imageAlt:
          '입력창에서 MCP 도구를 선택해 여러 모드에서 호출하는 플러그인 예시',
      },
    ],
  },
  pallas: {
    name: '전략',
    intro:
      '전략은 투자 아이디어를 대화로 만들고 실험하는 AI 전략 연구 공간입니다. 코드를 직접 쓰지 않고 채팅으로 전략을 완성하며, 백테스트와 진단, 비교와 조건 탐색을 거쳐 아이디어를 구체화합니다.',
    mainFeatures: [
      {
        title: '바이브코딩',
        description:
          '아이디어를 말하면 AI가 필요한 조건을 묻고 코드 창의 전략을 작성합니다. 진입·청산 조건 변경과 오류 수정도 채팅으로 요청하고, 바뀐 내용을 확인하세요.',
        image: '/media/product-features/pallas-01.png',
        imageAlt:
          '대화로 전략 조건을 다듬고 코드 창의 변경을 확인하는 전략 바이브코딩 예시',
      },
      {
        title: '노드 대화',
        description:
          '전략의 흐름에서 한 단계를 골라 “왜 여기서 진입해?”라고 묻거나 수정을 요청하세요. 선택한 조건과 관련 코드를 함께 보며 전략의 작동 방식을 이해할 수 있습니다.',
        image: '/media/product-features/pallas-02.png',
        imageAlt:
          '전략 흐름의 노드를 선택해 조건과 코드에 관해 대화하는 예시',
      },
      {
        title: '백테스트',
        description:
          '과거 데이터로 전략을 검증하고 성과와 거래 내역을 한눈에 확인합니다. 기존 전략과 수정안의 코드·설정·자산곡선을 같은 조건에서 비교해 변경이 결과에 미친 영향도 살펴보세요.',
        image: '/media/product-features/pallas-03.png',
        imageAlt:
          '전략별 성과와 거래 내역, 자산곡선을 함께 비교하는 백테스트 예시',
      },
    ],
    subfeatures: [
      {
        title: '투자 진단',
        description:
          '손실이 컸던 구간이나 특정 거래를 짚어 이유를 물어보세요. 시장 상황과 당시 조건, 거래 비용을 함께 살펴보고 전략의 강점과 약점을 파악할 수 있습니다.',
        icon: 'activity',
      },
      {
        title: '조건 탐색',
        description:
          '여러 파라미터 조합을 시험하고 결과를 비교합니다. 특정 조합에서만 성과가 좋은지, 주변 설정에서도 비슷한 결과가 이어지는지 살펴보며 전략을 다듬으세요.',
        icon: 'search',
      },
    ],
  },
  glaux: {
    name: '알림 오브',
    intro:
      '알림 오브는 다른 일을 하는 동안에도 질문과 결과를 이어주는 작은 AI 동반자입니다. 작업 화면 곁에서 자료를 함께 살펴보고, 중요한 소식이 생기면 먼저 말을 걸어 확인할 내용과 다음 행동을 제안합니다.',
    mainFeatures: [
      {
        title: '미니 대화',
        description:
          '큰 앱 창을 열지 않고 작은 창에서 질문하고 결과를 받아보세요. 표와 차트, 문서의 핵심을 미니 카드로 살펴보고, 도착한 알림에서도 대화를 이어갈 수 있습니다.',
        image: '/media/product-features/glaux-01.png',
        imageAlt:
          '작은 알림 오브 창에서 질문과 미니 카드를 함께 살펴보는 대화 예시',
      },
      {
        title: '능동 알림',
        description:
          '새로운 소식과 작업 결과를 화면 곁에서 계속 전합니다. 사용자의 관심과 상황에 맞춰 먼저 말을 걸고, 지금 확인할 내용과 다음 행동을 제안합니다.',
        image: '/media/product-features/glaux-03.png',
        imageAlt:
          '사용자의 관심과 상황에 맞춰 다음 행동을 제안하는 알림 오브 예시',
      },
    ],
  },
};
