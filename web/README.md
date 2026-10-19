# ATHENA Website

통합 ATHENA 저장소의 `web/`에 있는 공식 웹사이트입니다. 아래 명령은 저장소 루트에서 실행합니다.

```bash
git clone https://github.com/ANNJUNGCHAN/DAOU.Athena.git
cd DAOU.Athena
npm ci --prefix web
npm --prefix web run dev
```

Node.js 22.13 이상이 필요합니다. 프로덕션 빌드는 `npm --prefix web run build` 후 `npm --prefix web start`입니다.

검증 명령:

```bash
npm --prefix web run lint
npm --prefix web run typecheck
npm --prefix web test
npm --prefix web run build
```

`npm --prefix web test`는 Node.js 22에서 TypeScript 소스를 읽는 데 필요한 옵션을 포함합니다.

내부 페이지 이동에는 일반 `<a>`를 사용합니다. 현재 Vinext 1.0.0-beta.5의
프로덕션 빌드에서 `next/link` 클릭과 RSC prefetch에 런타임 오류가 발생해
페이지 이동이 실패하는 것을 확인했습니다. 따라서 `.oxlintrc.json`에서는
`nextjs/no-html-link-for-pages`만 끄고 접근성 검사는 유지합니다.
Base UI `NavigationMenuLink`는 `href`를 직접 받아 기본 앵커로 렌더링합니다.

`npm --prefix web start`는 `web/dist`의 빌드 결과물을 사용하는 로컬 서버입니다. 다시 빌드할 때는
이 서버를 실행한 터미널에서 `Ctrl+C`로 종료한 뒤 `npm --prefix web run build`를 실행하고,
완료되면 `npm --prefix web start`로 재시작하세요. Windows에서는 실행 중인 서버가 `web/dist/client`를
잠가 빌드 정리 단계에서 `EBUSY` 오류가 발생할 수 있습니다.

## 의존성 보안 점검

```bash
npm ci --prefix web
npm --prefix web test
npm --prefix web run lint
npm --prefix web run typecheck
npm --prefix web run build
npm --prefix web audit
powershell -NoProfile -File scripts/security/eval-security-gates.ps1
```

마지막 명령이 통합 공개 저장소의 정본 보안 게이트입니다.

`package.json`의 override는 `vinext`가 고정한 `image-size`를 `2.0.4`로,
`miniflare`가 고정한 `sharp`를 `0.35.5`로 올려 보안 수정 버전을 사용합니다.
상위 패키지가 해당 수정 버전을 포함하면 override를 다시 검토합니다.

2026-10-08 기준 `braces`의
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)은
공개된 수정 버전이 없어 `npm audit`에 경고가 남습니다. 현재 확인된 사용 경로는
`vinext`의 빌드·개발 도구 및 `shadcn` CLI이며, 웹 앱은 `shadcn`의 CSS만 가져옵니다.
HTTP 요청 처리 경로에서는 사용을 발견하지 못했지만 취약점 해결이나 전체 감사 통과를
의미하지 않습니다.

## 공식 발표 자료

`/presentation`은 제품 릴리스 매니페스트가 가리키는 39장 공식 발표자료의 정적
미리보기입니다. 원본 PPTX/PDF는 같은 저장소의 `presentation/`에서 관리하며 웹 공개 폴더에는
복제하지 않습니다. 2026-09-22의 43장 웹 발표 런타임과 자산은
`archive/presentation-v0.1.2`에 과거 버전으로 보존합니다.

## Cloudflare 배포

```bash
npm exec --prefix web -- wrangler login
npm --prefix web run deploy
```

`npm --prefix web run deploy`는 릴리스 매니페스트와 발표 미리보기의 파일 해시·순서를 먼저 검증하고,
검증을 통과한 뒤 빌드한 `web/dist/server/wrangler.json`을 배포합니다. 기본 Worker 이름은
`athena-homepage`입니다.

향후 Cloudflare Git 연동 대상을 통합 저장소로 바꿀 때는 프로젝트 Root directory를 `web`으로 지정합니다.

현재 배포 주소: https://athena-homepage.athena-jcahn.workers.dev
