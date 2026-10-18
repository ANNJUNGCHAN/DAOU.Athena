# System 1 판단 모델

> 2026-10-12 동반 요약본. 웹사이트의 정본은 `lib/tech-articles.ts`의 정적 HTML과 목차 메타데이터입니다. 이 Markdown은 런타임 렌더링에 사용하지 않습니다. 전체 그림·주석·소스 링크는 [웹 기술문서](/tech/01-tool-selection)에서 확인하세요.

System 1은 글을 생성하는 대신 작업마다 정해진 선택지를 평가합니다. 판단 계약은 유한 logits를 softmax로 변환해 라벨·임계값·채택 여부·사유를 반환하며, 정책에 따라 reject_all·defer·below_threshold·accepted를 표현할 수 있습니다. 현재 v018 정책은 모든 신뢰도 임계값을 0으로 두고 force_non_defer를 적용해 defer가 가장 높아도 거절 라벨을 제외한 후보 중 최고 점수를 선택합니다. 이 강제 선택 정책에는 새 학습이나 정확도 향상 근거가 없습니다. 발표 기준 order-ticket-v015 번들의 카탈로그에는 28종류의 판단 작업이 있습니다. 카드 형태 8가지는 발표의 설명 예시이며 전체 작업 공통 선택지가 아닙니다.

도구 선택은 적용 사례입니다. search → describe → resolve → call을 통해 후보 검색, 입력 계약, 서명 계획, 호출을 분리합니다. 여러 후보·인증된 LAYA 문맥·일치하는 카탈로그 버전·읽기 또는 웹소켓 의도가 있을 때만 제한적인 의미 보정이 적용됩니다. 전체 후보를 유지하며 호출자가 구조화한 인자가 우선합니다.

call은 일회용 nonce를 소비한 뒤 봉인 인자를 검증합니다. 조회 경로는 주문 계획을 거절합니다. 모의투자 주문은 티켓마다 사용자가 확인해야 합니다. 실계좌 주문과 모든 계정의 자동매매는 범위 밖이며, 실계좌 조회와 백테스트 가상 거래는 범위에 포함됩니다.

응답 캐시는 search·describe에만 적용됩니다. LAYA 결정 재사용은 티켓·작업·후보 범위에 한정됩니다. ToolRerank는 연구 참고이며 해당 논문의 모델 파이프라인이 ATHENA에 배포되었다는 의미가 아닙니다.

ToolRerank Figure 2 원본 크롭: Zheng et al., 2024, p. 16265(PDF 3쪽), © 2024 ELRA Language Resource Association. [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) · [논문 원문](https://aclanthology.org/2024.lrec-main.1413/).

향후 계획은 자체 라우팅의 판단 범위를 넓히고, 사용이 허용된 금융 말뭉치·투자 작업 사례·독립 평가를 기반으로 모델을 미세 조정하는 것입니다. 이미 학습·배포된 금융 LLM이라는 뜻은 아닙니다. [System One 판단 기본 요소](https://docs.system-one.dev/en/docs/primitives)와 [소개](https://system-one.dev/en/about), [BloombergGPT 연구](https://arxiv.org/abs/2303.17564)는 관련 설계 참고이며 같은 모델 사용이나 같은 성능의 근거가 아닙니다.

소스 기준: [25d971bb8717fc942fe648df1cdd405f99dbab51](https://github.com/ANNJUNGCHAN/DAOU.Athena/tree/25d971bb8717fc942fe648df1cdd405f99dbab51).
