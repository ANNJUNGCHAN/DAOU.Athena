export type TechOutlineItem = {
  id: string;
  label: string;
  title: string;
};

export type TechRelatedCapability = {
  name: string;
  href: string;
  description: string;
};

export type TechArticle = {
  slug: string;
  title: string;
  description: string;
  question: string;
  summary: string[];
  modes: string[];
  outline: TechOutlineItem[];
  relatedCapabilities: TechRelatedCapability[];
  html: string;
};

const sourceCommit = '25d971bb8717fc942fe648df1cdd405f99dbab51';
const sourceRoot = `https://github.com/ANNJUNGCHAN/DAOU.Athena/blob/${sourceCommit}`;

// The rendered website is authored here. The Markdown files in public/tech/manuscripts
// are concise companion copies for readers and are not a runtime content pipeline.
export const techArticles: TechArticle[] = [
  {
    slug: '01-tool-selection',
    title: 'System 1 판단 모델',
    description: '글을 생성하는 대신 정해진 선택지를 평가하고, 검증된 작업 흐름으로 연결하는 방법',
    question: '화면과 도구를 고르는 작은 판단을, 자유로운 글 생성과 어떻게 분리할까요?',
    summary: [
      '판단 계약은 정책별 거절·보류·임계값을 표현하며, 현재 v018 정책은 최고 점수의 거절 제외 라벨을 선택합니다.',
      '발표 기준 28종류의 판단을 다루며, 카드 형태 8가지는 발표의 설명 예시입니다.',
      '판단 결과와 실행 권한을 분리하고, 도구 호출에는 별도 계약 검증을 적용합니다.',
    ],
    modes: ['대화', '플러그인'],
    outline: [
      { id: 'tool-slide-1', label: '01', title: '글 생성 대신 유한 선택' },
      { id: 'tool-slide-2', label: '02', title: '도구 선택에 적용하기' },
      { id: 'tool-slide-3', label: '03', title: '실행 전 검증 경계' },
      { id: 'tool-slide-4', label: '04', title: '현재 구현과 확장 계획' },
    ],
    relatedCapabilities: [
      { name: '대화', href: '/features/agora', description: '자연어 요청을 도구 호출과 화면 응답으로 연결합니다.' },
      { name: '플러그인', href: '/features/ergane', description: '플러그인의 도구 설명과 입력 계약을 관리합니다.' },
    ],
    html: `
      <article id="01-tool-selection">
        <section class="blog-slide" id="tool-slide-1">
          <div class="blog-slide-copy">
            <span class="blog-step">01 · 글 생성 대신 유한 선택</span>
            <h2>긴 답변을 쓰는 일과, 다음 선택지를 평가하는 일을 나눕니다</h2>
            <p>최종 발표에서 소개한 <strong>System 1</strong>은 작업마다 정해진 선택지를 평가하는 판단 모델입니다. 예를 들어 카드 형태 8가지를 점수로 비교하는 장면은 설명 예시이며, 모든 작업이 같은 8개 선택지를 사용한다는 뜻은 아닙니다. 발표 기준 번들에는 <strong>28종류의 판단 작업</strong>이 등록되어 있습니다.</p>
            <p>판단 계약은 유한한 logits를 softmax로 변환하고 라벨·임계값·채택 여부·사유를 반환합니다. 계약은 정책에 따라 <code>reject_all</code>·<code>defer</code>·<code>below_threshold</code>·<code>accepted</code>를 표현할 수 있습니다. 다만 현재 배포된 <strong>v018 정책</strong>은 모든 신뢰도 임계값을 0으로 두고 <code>force_non_defer</code>를 적용해, <code>defer</code>가 가장 높아도 거절 라벨을 제외한 후보 중 최고 점수를 선택합니다. 이 강제 선택 정책에는 새 학습이나 정확도 향상 근거가 없습니다.</p>
            <p>“삼성전자 차트 보여줘”라는 문장은 바로 제공자 API로 전달되지 않습니다. ATHENA는 먼저 <strong>search</strong>로 관련 도구를 찾고, <strong>describe</strong>로 입력 계약을 읽은 뒤, <strong>resolve</strong>에서 종목·범위·권한을 검증한 서명 계획을 만듭니다. <strong>call</strong>은 그 계획이 유효할 때만 실제 도구를 호출합니다.</p>
            <p>도구의 이름을 맞히는 일과 실행 가능한 요청을 만드는 일을 분리했기 때문에, 후보가 비슷해도 필수 입력이나 권한 범위가 맞지 않으면 다음 단계로 넘어가지 않습니다.</p>
          </div>
          <figure class="blog-visual">
            <picture><source media="(prefers-reduced-motion: reduce)" srcset="/tech/assets/beginner-01-static.svg"><img src="/tech/assets/beginner-01.svg" alt="사용자 질문이 요청 해석, 도구 확인, 데이터 조회, 차트 표시로 이어지는 흐름"></picture>
            <figcaption>질문은 후보 검색과 계약 확인을 거쳐 검증된 실행 계획이 됩니다.</figcaption>
          </figure>
        </section>

        <section class="blog-slide" id="tool-slide-2">
          <div class="blog-slide-copy">
            <span class="blog-step">02 · 도구 선택에 적용하기</span>
            <h2>판단 모델은 관련성을 평가하고, 서버는 실행 조건을 검증합니다</h2>
            <p>후보가 여러 개이고 인증된 LAYA 문맥, 카탈로그 버전, 읽기 또는 웹소켓 의도가 모두 맞을 때만 로컬 의미 보정을 사용합니다. 보정 결과는 후보의 <code>operation_relevance</code>를 보완할 뿐이며, 후보를 유일한 도구로 확정하거나 서버의 스키마 검사를 건너뛰지 않습니다.</p>
            <p>생략된 인자를 보정할 때도 호출자가 구조화해 넘긴 값이 우선입니다. 보정 결과는 다시 일반 selector의 도구 식별, 스키마, 종목, 범위, 계획 봉인 검사를 통과해야 합니다.</p>
          </div>
          <figure class="blog-visual blog-paper-figure">
            <img src="/tech/assets/toolrerank-figure-2-original.png" alt="Dual Encoder 검색부터 Adaptive Truncation, Cross Encoder와 계층 기반 재정렬로 이어지는 ToolRerank Figure 2 원본">
            <figcaption>Zheng et al., 2024, ToolRerank, Figure 2, p. 16265(PDF 3쪽) 원본 크롭 · © 2024 ELRA Language Resource Association · <a href="https://creativecommons.org/licenses/by-nc/4.0/">CC BY-NC 4.0</a> · <a href="https://aclanthology.org/2024.lrec-main.1413/">논문 원문</a></figcaption>
          </figure>
          <div class="blog-callout">
            <strong>연구 참고와 현재 구현의 차이</strong>
            <p>ToolRerank는 후보 검색과 재정렬을 분리하는 관련 연구입니다. ATHENA가 이 논문의 학습된 Dual Encoder·Cross Encoder 파이프라인을 배포했다는 뜻은 아닙니다. 현재 구현은 타입이 있는 도구 카탈로그, 제한된 로컬 의미 보정, 결정적인 서버 검증을 사용합니다.</p>
          </div>
          <figure class="blog-visual">
            <picture><source media="(prefers-reduced-motion: reduce)" srcset="/tech/assets/beginner-02-static.svg"><img src="/tech/assets/beginner-02.svg" alt="단어 점수로 후보를 찾고 입력 조건을 검사하는 ATHENA의 과정"></picture>
            <figcaption>후보의 관련성을 보정한 뒤에도 입력 조건과 실행 범위는 별도로 검사합니다.</figcaption>
          </figure>
        </section>

        <section class="blog-slide" id="tool-slide-3">
          <div class="blog-slide-copy">
            <span class="blog-step">03 · 실행 전 검증 경계</span>
            <h2>계획은 서명되고, 한 번만 사용할 수 있습니다</h2>
            <p><strong>resolve</strong>가 만든 계획에는 봉인된 인자와 서명이 들어갑니다. <strong>call</strong> 단계에서는 일회용 nonce를 검증하고 소비한 뒤 봉인된 인자를 다시 확인합니다. 이미 사용한 계획이나 계약이 달라진 계획은 재실행할 수 없습니다.</p>
            <p>조회 경로가 주문 계획을 받으면 <code>OrderTicketRequiredError</code>로 거절합니다. 모의투자 주문은 주문 티켓에서 사용자가 건별 확인해야 합니다. 실계좌 주문과 모든 계정의 자동매매는 제품 범위에 포함되지 않으며, 실계좌 조회와 백테스트의 가상 거래는 범위에 포함됩니다.</p>
          </div>
          <figure class="blog-visual">
            <picture><source media="(prefers-reduced-motion: reduce)" srcset="/tech/assets/beginner-03-static.svg"><img src="/tech/assets/beginner-03.svg" alt="서명 계획에서 일회용 nonce 소비와 봉인 인자 검사를 거쳐 호출하거나 거절하는 과정"></picture>
            <figcaption>일회용 nonce는 봉인 인자 검사 전에 소비됩니다. 실패한 계획을 그대로 다시 호출할 수 없으며, 주문 계획에는 별도 티켓이 필요합니다.</figcaption>
          </figure>
        </section>

        <section class="blog-slide" id="tool-slide-4">
          <div class="blog-slide-copy">
            <span class="blog-step">04 · 현재 구현과 확장 계획</span>
            <h2>현재의 제한된 판단에서, 검증 가능한 금융 작업으로 확장합니다</h2>
            <p>이 구조는 후보 검색, 도구 설명, 계획 검증, 실제 호출을 각각 관찰할 수 있게 합니다. 의미 기반 보정이 실패하거나 허용 조건이 맞지 않아도 결정적인 selector 검사가 남습니다. 다만 올바른 도구가 카탈로그에 없거나 필요한 데이터 제공자가 준비되지 않았다면 값을 만들어 내지 않고 실패 상태를 반환합니다.</p>
            <p><strong>향후 계획</strong>은 자체 라우팅이 맡을 판단 범위를 넓히고, 사용이 허용된 금융 말뭉치와 투자 작업 사례, 독립 평가를 기반으로 모델을 미세 조정하는 것입니다. 자체 라우팅 확장과 금융 특화 추가 학습은 향후 연구·개발 계획입니다.</p>
            <p>관련 설계 참고인 <a href="https://docs.system-one.dev/en/docs/primitives">System One의 판단 기본 요소</a>는 Choice와 Noul처럼 선택과 조건 평가를 구분합니다. 발표에서 소개한 <strong>Jev</strong>는 <a href="https://typesafe.ai/blog/introducing-system-one-models-and-jev">공식 모델 소개</a>에서 확인할 수 있습니다. <a href="https://system-one.dev/en/about">System One 소개</a>와 <a href="https://arxiv.org/abs/2303.17564">BloombergGPT 연구</a>는 설계와 금융 특화 학습을 살펴보는 참고 자료이며, ATHENA가 같은 모델을 사용하거나 같은 성능을 낸다는 근거는 아닙니다.</p>
          </div>
          <div class="blog-source-row">
            <div><span>검증한 소스</span><p>2026-10-12 · commit <code>${sourceCommit.slice(0, 8)}</code></p></div>
            <div class="blog-source-links"><a href="${sourceRoot}/backend/athena_api/laya/contracts.py#L37">유한 선택 계약</a><a href="${sourceRoot}/backend/athena_api/laya/runtime.py#L167">작업 등록</a><a href="${sourceRoot}/backend/athena_api/laya/catalog_selection.py#L122">관련성 재정렬</a><a href="${sourceRoot}/backend/athena_api/api/llm_tools.py#L41">도구 단계</a><a href="${sourceRoot}/backend/athena_api/laya/query.py#L47">LAYA 보정</a><a href="${sourceRoot}/backend/athena_api/selector/service.py#L987">일회성 계획 소비</a><a href="${sourceRoot}/backend/athena_mcp/selector_tools.py#L652">응답 캐시 범위</a></div>
          </div>
        </section>

        <div class="blog-technical-notes">
          <details>
            <summary>기술 용어와 경계 자세히 보기</summary>
            <p id="tool-note-1"><strong>[1] Signed plan</strong>은 resolve 단계에서 검증한 도구와 인자를 봉인한 실행 계획입니다. call은 계획의 서명과 일회용 nonce를 확인합니다.</p>
            <p id="tool-note-2"><strong>[2] Semantic refinement</strong>는 여러 후보의 관련성을 제한적으로 보정합니다. 전체 후보를 유지하고 응답의 ID·라벨·신뢰도·사유를 검증합니다. LAYA의 결정 재사용은 해당 티켓과 작업·후보에 한정됩니다. MCP 응답 캐시는 search·describe에 적용되며 resolve·call은 캐시하지 않습니다.</p>
            <p id="tool-note-3"><strong>[3] Query-only boundary</strong>는 조회 요청이 주문 실행으로 넘어가지 않게 막는 계약입니다. 주문에는 별도의 티켓과 사용자 확인이 필요합니다.</p>
            <p id="tool-note-4"><strong>[4] ToolRerank</strong>는 후보 검색과 재정렬을 분리한 관련 연구입니다. ATHENA의 현재 배포 모델과 동일한 구현이라는 뜻은 아닙니다.</p>
            <p id="tool-note-5"><strong>[5] 발표 기준 작업 수</strong> 28종류는 최종 발표에 대응하는 order-ticket-v015 번들의 <code>laya-runtime/catalog.json</code> 작업 목록 기준입니다. 향후 카탈로그의 작업 수가 바뀔 수 있으며, 카드 형태 8가지는 하나의 작업을 설명하는 예시입니다.</p>
          </details>
        </div>
      </article>
    `,
  },
  {
    slug: '02-investment-memory',
    title: 'Graph Memory',
    description: '관심 대상뿐 아니라 그 이유와 원문 출처를 남겨, 다음 대화에서 근거를 다시 찾는 방법',
    question: '나중에 “왜 은행주에 관심이 생겼지?”라고 물으면, 어떤 기록으로 답할까요?',
    summary: [
      '관심의 이유를 원문 출처·시점과 함께 남겨 다음 질문의 근거로 조회합니다.',
      '대화·체결·보유의 식별자와 출처를 분리해 사실이 섞이지 않게 합니다.',
      '추출 결과의 형식과 요청 결합을 검증하고, 위험한 자동 병합을 제한합니다.',
    ],
    modes: ['대화', '그래프', '알림'],
    outline: [
      { id: 'memory-slide-1', label: '01', title: '관심 대상과 그 이유' },
      { id: 'memory-slide-2', label: '02', title: '현재 상태와 변경 이력' },
      { id: 'memory-slide-3', label: '03', title: '추출과 동일 대상 판정' },
      { id: 'memory-slide-4', label: '04', title: '보장하는 것과 남는 한계' },
    ],
    relatedCapabilities: [
      { name: '대화', href: '/features/agora', description: '대화에서 관심과 근거를 구조화합니다.' },
      { name: '그래프', href: '/features/metis', description: '기억의 관계와 출처를 그래프로 확인합니다.' },
      { name: '알림', href: '/features/aegis', description: '확인된 관심과 보유 맥락을 감시에 연결합니다.' },
    ],
    html: `
      <article id="02-investment-memory">
        <section class="blog-slide" id="memory-slide-1">
          <div class="blog-slide-copy">
            <span class="blog-step">01 · 관심 대상과 그 이유</span>
            <h2>“금리 때문에 은행주에 관심 생겼어”의 이유까지 남깁니다</h2>
            <p>최종 발표의 이 문장은 설명 예시입니다. Graph Memory는 ‘은행주’라는 대상과 ‘금리 때문’이라는 관심 이유를 원문 출처와 시점에 연결합니다. 나중에 “왜 은행주에 관심이 생겼지?”라고 물으면 새 이유를 지어내는 대신 그 발언의 근거를 다시 조회할 수 있게 합니다.</p>
            <p>사용자가 직접 말한 내용과 AI가 해석한 관계는 구분됩니다. 연결을 그렸다는 사실만으로 AI의 추론이 사용자 발언이나 확인된 투자 사실이 되지는 않습니다. 아래 그림은 같은 구분을 관심과 계좌 보유 입력에 적용한 예시입니다.</p>
            <p>대화에서 나온 관심, 계좌에서 확인한 보유, 체결로 생긴 변화는 서로 다른 종류의 기록입니다. ATHENA는 종류(<code>kind</code>), 위치(<code>locator</code>), 시점, 원문 지문, 리비전을 따로 저장하고 대화 ID·거래 ID·보유 ID도 구분합니다.</p>
            <p>보유 기록은 계정과 수량에 묶입니다. 따라서 어떤 종목을 이야기했다는 이유만으로 보유로 바뀌지 않고, 다른 계정의 수량이 하나로 합쳐지지도 않습니다.</p>
          </div>
          <figure class="blog-visual">
            <picture><source media="(prefers-reduced-motion: reduce)" srcset="/tech/assets/beginner-05-static.svg"><img src="/tech/assets/beginner-05.svg" alt="관심 표현과 투자 사실을 구분하는 예시"></picture>
            <figcaption>관심 표현과 계좌에서 확인한 사실은 처음부터 다른 기억으로 저장합니다.</figcaption>
          </figure>
        </section>

        <section class="blog-slide" id="memory-slide-2">
          <div class="blog-slide-copy">
            <span class="blog-step">02 · 현재 상태와 변경 이력</span>
            <h2>지금의 값과 바뀐 과정을 함께 남깁니다</h2>
            <p>빠른 조회를 위한 현재 레코드와, 수정 과정을 보존하는 append-only 변경 이력을 함께 관리합니다. 새 사실이 들어오면 현재 상태는 갱신할 수 있지만 이전 변경 기록을 덮어쓰지는 않습니다.</p>
            <p>이 구조 덕분에 “지금 무엇을 알고 있는가”와 “어떤 근거가 언제 바뀌었는가”를 분리해 확인할 수 있습니다. 그래프의 관계를 대화나 계좌 기록으로 되짚을 때도 같은 출처 식별자를 사용합니다.</p>
          </div>
          <figure class="blog-visual">
            <picture><source media="(prefers-reduced-motion: reduce)" srcset="/tech/assets/beginner-06-static.svg"><img src="/tech/assets/beginner-06.svg" alt="대화와 거래 데이터가 서로 다른 경로로 저장되는 과정"></picture>
            <figcaption>대화 추출과 계좌 기록은 각자의 식별자와 검증 경로를 유지합니다.</figcaption>
          </figure>
        </section>

        <section class="blog-slide" id="memory-slide-3">
          <div class="blog-slide-copy">
            <span class="blog-step">03 · 추출과 동일 대상 판정</span>
            <h2>형식을 검증하고, 합쳐도 되는 대상만 묶습니다</h2>
            <p>대화 추출은 <code>EXTRACTED</code>·<code>INFERRED</code>·<code>AMBIGUOUS</code> 상태를 구분합니다. 잘못된 JSON, 중복 키, 요청 ID 불일치, 원문 지문 불일치는 저장 전에 거절합니다. 자연어 출력이 그럴듯하다는 이유만으로 기억에 넣지 않습니다.</p>
            <p>동일 대상 판정은 정확한 별칭을 먼저 보고, 이름 토큰과 이웃 관계의 유사도를 제한된 조건에서 비교합니다. 종목과 투자자 프로필 노드는 텍스트가 비슷하다는 이유만으로 자동 병합하지 않습니다.</p>
          </div>
          <figure class="blog-visual">
            <picture><source media="(prefers-reduced-motion: reduce)" srcset="/tech/assets/beginner-07-static.svg"><img src="/tech/assets/beginner-07.svg" alt="여러 이름을 하나의 대상으로 정리하는 과정"></picture>
            <figcaption>별칭·이름·이웃 관계를 비교하되, 투자 사실을 옮길 수 있는 위험한 병합은 제한합니다.</figcaption>
          </figure>
        </section>

        <section class="blog-slide" id="memory-slide-4">
          <div class="blog-slide-copy">
            <span class="blog-step">04 · 보장과 한계</span>
            <h2>기억은 근거와 함께 보존되지만, 추론은 사실이 아닙니다</h2>
            <p>현재 상태, 변경 이력, 출처, 명시성은 서로 다른 필드로 남습니다. 이를 통해 대화의 관심을 계좌 사실과 구분하고, 같은 관계가 어디에서 왔는지 추적할 수 있습니다. 다만 <code>INFERRED</code>나 <code>AMBIGUOUS</code>는 확인된 투자 사실이 아니며, 계좌 데이터가 없으면 보유 수량을 만들어 내지 않습니다.</p>
          </div>
          <div class="blog-source-row">
            <div><span>검증한 소스</span><p>2026-10-12 · commit <code>${sourceCommit.slice(0, 8)}</code></p></div>
            <div class="blog-source-links"><a href="${sourceRoot}/backend/athena_api/brain/history.py#L233">기억 이력</a><a href="${sourceRoot}/backend/athena_api/brain/extraction.py#L113">추출 검증</a><a href="${sourceRoot}/backend/athena_api/brain/dedup.py#L34">동일 대상 판정</a></div>
          </div>
        </section>

        <div class="blog-technical-notes">
          <details>
            <summary>기술 용어와 경계 자세히 보기</summary>
            <p id="memory-note-1"><strong>[1] Agentic Memory</strong>는 다음 작업에 다시 쓸 수 있도록 대화와 활동을 구조화한 기억입니다. ATHENA는 원문 전체를 한 덩어리로 취급하지 않고 개체·관계·출처로 나눕니다.</p>
            <p id="memory-note-2"><strong>[2] Structured Extraction</strong>은 정해진 JSON 계약으로 개체와 관계를 받는 과정입니다. 형식뿐 아니라 요청과 원문 지문의 결합도 검사합니다.</p>
            <p id="memory-note-3"><strong>[3] Provenance</strong>는 기억이 나온 대화·체결·보유 기록과 시점을 추적하는 정보입니다.</p>
            <p id="memory-note-4"><strong>[4] Entity Resolution</strong>은 다른 표현이 같은 대상을 가리키는지 판단하는 과정입니다. 자동 병합에서 제외할 종류를 함께 정의해야 안전합니다.</p>
          </details>
        </div>
      </article>
    `,
  },
  {
    slug: '03-graph-retrieval',
    title: '그래프 검색 · 군집과 숨은 연결',
    description: '기억의 근거를 찾고, 비슷한 관계의 군집과 군집 사이에 이미 존재하는 연결을 살펴보는 방법',
    question: '기억을 비슷한 맥락으로 묶고, 서로 다른 군집 사이의 연결을 어떻게 다시 발견할까요?',
    summary: [
      '리터럴 토큰 기반 FTS5/BM25 검색으로 후보 범위를 제한합니다.',
      '선택한 노드의 이웃을 깊이와 개수 한도 안에서 조회합니다.',
      '군집 사이의 기존 연결을 상대 점수로 정렬하며, 새 관계나 투자 사실을 만들지 않습니다.',
    ],
    modes: ['그래프'],
    outline: [
      { id: 'graph-slide-1', label: '01', title: '대상 후보 찾기' },
      { id: 'graph-slide-2', label: '02', title: '관계와 출처 회수' },
      { id: 'graph-slide-3', label: '03', title: '군집과 숨은 연결' },
      { id: 'graph-slide-4', label: '04', title: '보장하는 것과 남는 한계' },
    ],
    relatedCapabilities: [
      { name: '그래프', href: '/features/metis', description: '개체, 관계, 출처를 한 그래프에서 탐색합니다.' },
      { name: '대화', href: '/features/agora', description: '검색한 근거를 대화의 답변 문맥으로 연결합니다.' },
    ],
    html: `
      <article id="03-graph-retrieval">
        <section class="blog-slide" id="graph-slide-1">
          <div class="blog-slide-copy">
            <span class="blog-step">01 · 대상 후보 찾기</span>
            <h2>질문 속 이름을 그래프의 노드와 연결합니다</h2>
            <p>“삼성에 관해 예전에 무슨 이야기를 했지?”에서 ‘삼성’은 여러 대상을 가리킬 수 있습니다. ATHENA는 화면이 넘긴 ID가 있으면 그 대상을 먼저 사용하고, 그렇지 않으면 리터럴 토큰 기반 FTS5/BM25 검색으로 이름과 별칭 후보를 찾습니다.</p>
            <p>이름 검색은 후보를 최대 5개 반환합니다. 정확한 이름 일치가 하나이거나 검색 후보가 하나뿐일 때만 대상을 확정합니다. 그 외에는 <code>resolved: false</code>와 후보 목록을 반환해 선택을 남겨 둡니다.</p>
          </div>
          <figure class="blog-visual">
            <picture><source media="(prefers-reduced-motion: reduce)" srcset="/tech/assets/beginner-09-static.svg"><img src="/tech/assets/beginner-09.svg" alt="질문에서 그래프의 대상을 찾는 과정"></picture>
            <figcaption>먼저 대상을 좁힌 뒤 관계 조회를 시작합니다.</figcaption>
          </figure>
        </section>

        <section class="blog-slide" id="graph-slide-2">
          <div class="blog-slide-copy">
            <span class="blog-step">02 · 관계와 출처 회수</span>
            <h2>노드만 꺼내지 않고 연결된 근거까지 찾습니다</h2>
            <p>대상이 정해지면 주변 관계를 깊이와 개수 한도 안에서 조회합니다. 관계의 방향, 종류, 시점과 함께 원문 위치와 지문을 되돌려, 그래프의 선이 어떤 기록에서 만들어졌는지 추적할 수 있게 합니다.</p>
            <p>범위를 제한하는 이유는 그래프 전체를 매번 답변 문맥에 넣지 않기 위해서입니다. 관련 이웃만 가져오되 출처 연결은 유지해, 요약문이 원래 기록에서 멀어지지 않게 합니다.</p>
          </div>
          <figure class="blog-visual">
            <picture><source media="(prefers-reduced-motion: reduce)" srcset="/tech/assets/beginner-10-static.svg"><img src="/tech/assets/beginner-10.svg" alt="관계와 근거 원문을 함께 되돌려주는 흐름"></picture>
            <figcaption>관계와 원문 위치를 함께 반환해 그래프의 연결을 되짚을 수 있게 합니다.</figcaption>
          </figure>
        </section>

        <section class="blog-slide" id="graph-slide-3">
          <div class="blog-slide-copy">
            <span class="blog-step">03 · 군집과 숨은 연결</span>
            <h2>비슷한 기억을 묶고, 군집 사이의 기존 연결을 살펴봅니다</h2>
            <p>그래프 투영은 리비전별 캐시를 사용하고 투자자 노드를 제외한 뒤 NetworkX의 Greedy Modularity로 군집을 계산합니다. 연결이 없는 노드는 억지로 묶지 않고 <code>-1</code>로 분리합니다.</p>
            <p>군집의 기계적 라벨은 차수가 가장 높은 노드 하나에서 정합니다. 선택적인 AI 라벨은 차수 상위 노드의 이름과 종류만 제한적으로 사용하며, 결과는 추정 이름으로 별도 제공됩니다. 실패하면 AI 라벨은 비어 있고 기계적 라벨은 유지됩니다. AI 라벨 캐시는 구성원 집합과 프롬프트 지문을 함께 구분합니다.</p>
            <p>발표의 ‘숨은 연결’은 군집 경계를 넘는 <strong>이미 저장된 엣지</strong>를 찾아 <code>surprise_score</code>의 상대 순서로 보여주는 기능입니다. 새 엣지를 생성하거나 인과관계를 확정하지 않습니다. ‘삼성전자–분할매수’는 흐름을 설명하는 예시이며, 사용자의 실제 기록이나 투자 추천으로 제시하는 데이터가 아닙니다.</p>
          </div>
          <figure class="blog-visual">
            <picture><source media="(prefers-reduced-motion: reduce)" srcset="/tech/assets/beginner-11-static.svg"><img src="/tech/assets/beginner-11.svg" alt="점과 선을 클러스터로 묶고 이름표를 만드는 과정"></picture>
            <figcaption>군집 구조와 선택적인 AI 라벨을 분리해 계산 결과를 설명 가능하게 유지합니다.</figcaption>
          </figure>
        </section>

        <section class="blog-slide" id="graph-slide-4">
          <div class="blog-slide-copy">
            <span class="blog-step">04 · 보장과 한계</span>
            <h2>근거의 경로를 보존하고, 없는 사실은 만들지 않습니다</h2>
            <p>검색 결과는 노드·관계·출처로 이어지는 경로를 유지합니다. 군집 응답에는 그래프 리비전, 노드, 엣지, 응집도, 기계적 대표값이 포함되고 AI 라벨은 선택적으로 더해집니다. 검색 후보가 없거나 출처 원문이 남아 있지 않다면 그 공백을 생성 모델의 추측으로 채우지 않습니다.</p>
          </div>
          <div class="blog-source-row">
            <div><span>검증한 소스</span><p>2026-10-12 · commit <code>${sourceCommit.slice(0, 8)}</code></p></div>
            <div class="blog-source-links"><a href="${sourceRoot}/backend/athena_api/brain/store.py#L1278">검색</a><a href="${sourceRoot}/backend/athena_api/api/brain.py#L1517">대상 확정 조건</a><a href="${sourceRoot}/backend/athena_api/brain/projection.py#L155">그래프 투영</a><a href="${sourceRoot}/backend/athena_api/brain/labeling.py#L19">선택적 AI 라벨</a><a href="${sourceRoot}/backend/athena_api/brain/analysis.py#L141">군집 사이 숨은 연결</a></div>
          </div>
        </section>

        <div class="blog-technical-notes">
          <details>
            <summary>기술 용어와 경계 자세히 보기</summary>
            <p id="graph-note-1"><strong>[1] Entity Retrieval</strong>은 질문의 이름을 저장된 노드 후보와 연결하는 과정입니다. ID가 있으면 우선 사용하고, 없으면 이름과 별칭을 검색합니다.</p>
            <p id="graph-note-2"><strong>[2] FTS5/BM25</strong>는 SQLite의 전문 검색 색인과 순위 계산입니다. ATHENA는 리터럴 토큰으로 후보를 찾고 결과 범위를 제한합니다.</p>
            <p id="graph-note-3"><strong>[3] Evidence Grounding</strong>은 설명을 관계의 출처와 원문 위치에 연결하는 방식입니다. 근거가 없는 연결을 생성하는 기능이 아닙니다.</p>
            <p id="graph-note-4"><strong>[4] Greedy Modularity</strong>는 군집 안의 연결은 많고 군집 사이의 연결은 적도록 노드를 묶는 알고리즘입니다. AI 라벨은 이 계산과 별개입니다.</p>
          </details>
        </div>
      </article>
    `,
  },
];
