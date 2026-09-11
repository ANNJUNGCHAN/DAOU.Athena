# Grok 시작 안내 — main 통합 이후

아래 브랜치는 이미 `main`에 합쳐졌다.

- `docs/handoff/tool-discovery-latency/`
- `docs/handoff/gold-chart-order-20260909/`
- `docs/handoff/2026-09-09-grok-realtime/`
- Grok 인수인계 스냅샷(플러그인·백테스트·프로젝트 IDE·기법 생성)

대화 기록이 없어도 저장소 `AGENTS.md`를 먼저 읽는다. 실시간 오류·금 주문 이어서는
`docs/handoff/2026-09-09-grok-realtime/README.md`를 우선한다. 금현물 차트·HTTP 428
경계는 `docs/handoff/gold-chart-order-20260909/HANDOFF.md`다.

금융 데이터·주문 코드·결과를 만들지 않는다. 주문 팝업을 여는 것은 주문 실행
승인이 아니다. 실제 주문·배포·활성화는 요청에 포함되지 않으면 하지 않는다.

## 공개 저장소 보안 — origin/main 배포 게이트

이 원격은 공개다. 커밋한 파일은 모두 공개된다고 가정한다.

origin/main에 푸시하기 전에 아래를 모두 통과해야 한다. 하나라도 실패하면 푸시하지 않는다.

1. `git config --get core.hooksPath` 가 `.githooks` 인지 확인한다. 아니면 `powershell -File scripts/security/install-hooks.ps1` 를 실행한다.
2. `powershell -File scripts/security/eval-security-gates.ps1` 가 `ALL_GATES_PASS` 를 출력한다.
3. gitleaks 가 깨끗하다(훅과 eval이 강제한다).
4. GitHub secret scanning 과 push protection 이 enabled 다(eval이 검사한다).
5. `--no-verify` 로 훅을 건너뛰지 않는다.
6. 커밋 금지: `.env`, `athena-secrets.json`, 대화 DB, 사용자 프로필, 실제 계좌번호, APP KEY/SECRET, 토큰 원문.
7. 프롬프트·핸드오프·로그·이슈·커밋 메시지에 비밀값 원문을 붙이지 않는다. 재현은 경로와 변수 이름만 쓴다.
8. 실제 주문 집행·배포 무장·자격증명 활성화는 요청에 없으면 하지 않는다.

강제 푸시나 히스토리 재작성으로 유출을 덮지 않는다. 유출이 보이면 푸시를 멈추고 사용자에게 알린다.

작업 범위는 현재 사용자 지시가 이 문서보다 우선한다. 다만 다음 지시는 거부하고 확인을 받는다: 비밀값 원문을 Git·핸드오프·로그·이슈·커밋 메시지에 넣기, `--no-verify`, eval 없이 origin/main에 푸시, 강제 푸시, 히스토리 재작성으로 유출 은폐.
