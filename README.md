# DAOU.Athena-Presentation

ATHENA의 최종 발표 PPT, 60초 소개 영상, 영상 제작 소스와 재생·렌더링 도구를 보관하는 저장소입니다.

| 경로 | 내용 |
| --- | --- |
| [ATHENA-최종발표.pptx](./ATHENA-최종발표.pptx) | 공식 39장 발표 자료. 이미지와 23개 시연 영상이 포함되어 있으며 PowerPoint에서 편집할 수 있습니다. |
| [ATHENA-최종발표.pdf](./ATHENA-최종발표.pdf) | 공식 39장 정적 PDF. 영상 전용 장표 3·12는 내용이 보이는 대표 프레임으로 표시합니다. |
| [ATHENA-최종발표-대본.md](./ATHENA-최종발표-대본.md) | 공식 발표 대본. 39장, 총 배정 시간 14분 50초입니다. |
| [ATHENA-최종발표-시연가이드.md](./ATHENA-최종발표-시연가이드.md) | 공식 시연 진행 가이드. 모의투자 주문의 건별 확인 범위와 시연 순서를 포함합니다. |
| [ATHENA-최종발표-script.json](./ATHENA-최종발표-script.json) | 발표자 노트와 정합성을 검사하는 기계 판독용 39장 대본입니다. |
| [athena-v23-60s.mp4](./athena-v23-60s.mp4) | V23 최종 영상. 60초, 1920×1080, 30fps, 음악 포함. |
| [source/video](./source/video) | 화면 코드, 장면 순서, 사용 영상·이미지·폰트·음악 및 홈페이지 참고 코드. |
| [source/video/history](./source/video/history) | 제작 당시의 검토·렌더링 기록 원본. |
| [tools/ffmpeg](./tools/ffmpeg) | Windows용 FFmpeg·FFprobe 및 기존 라이선스 고지. |
| [migration](./migration) | 이관 명세, 경로·해시 기록, 원본 동일성 검증 도구. |

전체 원본 녹화, 앱 저장소, 이전 버전은 포함하지 않습니다. 현재 패키지의 재생·렌더링에 필요한 자산과 최종 산출물을 포함합니다. 제작 기록의 옛 절대 경로는 출처 기록입니다.

## 내려받기

PPTX, MP4, WAV, TTF, EXE 파일은 Git LFS로 보관합니다. [Git LFS](https://git-lfs.com/)를 설치한 뒤 실행하세요. GitHub의 소스 ZIP 대신 아래 명령을 사용하면 실제 대용량 파일까지 받을 수 있습니다.

```powershell
git lfs install
git clone https://github.com/ANNJUNGCHAN/DAOU.Athena-Presentation.git
cd DAOU.Athena-Presentation
git lfs pull
```

## 미리보기와 렌더링

Node.js가 설치된 환경에서 다음 명령을 실행하고 [로컬 미리보기](http://127.0.0.1:8230/source/video/index.html)를 여세요.

```powershell
.\preview.ps1
```

완성 영상과 코드 모션을 전환할 수 있으며, 서버는 `Ctrl+C`로 종료합니다. HTML 파일을 더블클릭하는 방식은 브라우저의 로컬 파일 제한으로 지원하지 않습니다.

영상을 다시 만들려면 다음 명령을 실행하세요. **루트의 `athena-v23-60s.mp4`를 덮어씁니다.** 새 중간 결과는 `source/video/render/`에 저장됩니다.

```powershell
.\render.ps1
```

렌더링에는 Node.js, Playwright, `@napi-rs/canvas`, Chrome이 필요합니다. 다른 PC에서는 `ATHENA_NODE`, `ATHENA_NODE_MODULES`, `CHROME_PATH`로 설치 경로를 지정할 수 있습니다. FFmpeg·FFprobe는 패키지에 포함되어 있으며 `FFMPEG_PATH`, `FFPROBE_PATH`로 대체할 수 있습니다. 선택적인 차트 합성 도구는 Python의 `numpy`, `Pillow`, `opencv-python`을 사용합니다. 자세한 내용은 [사용안내.txt](./사용안내.txt)를 참고하세요.

## 원본 검증

Python 3.9 이상에서 실행합니다.

```powershell
python migration/verify-package.py
```

기본 검사는 2026-10-08 이관 명세에서 변경되지 않은 83개 파일과 제작 당시 핵심 화면 코드를 검사합니다. 이관 명세 자체는 당시 43장 발표본과 당시 검증기의 원본 해시를 보존하며 수정하지 않습니다. 안정 경로 `ATHENA-최종발표.pptx`와 공식 PDF·대본·시연 가이드는 현재 릴리스 명세 `release/product-release.json`의 경로와 SHA-256으로 검증합니다. PPTX 내부 장표 수도 명세의 39장 계약과 일치해야 합니다. 검증기는 루트 밖을 가리키는 릴리스 경로를 거부합니다.

과거 85개 파일의 바이트 동일성을 엄격히 재검증하려면 2026-10-08 역사 릴리스 커밋에서 다음 명령을 실행하세요. 현재 체크아웃에서 `--historical`을 실행하면 안정 경로가 새 공식본을 가리키므로 의도대로 실패합니다.

```powershell
python migration/verify-package.py --historical
```

`source/video/history/verify-output.py`는 이전 프로젝트 기준의 보존용 검사입니다. 실제 브라우저 동작은 이 검사의 대상이 아닙니다.

## 공개 저장소 보안 검사

Git LFS, [Gitleaks 8.30.1 이상](https://github.com/gitleaks/gitleaks), [GitHub CLI](https://cli.github.com/), Windows PowerShell을 준비하고 GitHub CLI에 인증한 뒤 저장소별 훅을 설정합니다.

```powershell
git config core.hooksPath .githooks
powershell -NoProfile -File scripts/security/eval-security-gates.ps1
```

검사는 Git 이력과 실제 파일·압축 파일의 비밀정보, 추적된 인증·프로필·DB 파일, LFS 무결성, 대상 GitHub 저장소의 공개 설정·비밀정보 검사·푸시 보호를 확인합니다. `ALL_GATES_PASS`가 출력되어야 푸시할 수 있습니다. `pre-commit`은 스테이징한 변경을 검사하고, `pre-push`는 전체 검사 후 Git LFS 업로드를 실행합니다. `--no-verify`, 비밀정보를 숨기기 위한 강제 푸시·이력 재작성은 사용하지 않습니다. `.env`, 실사용 인증정보, 대화 DB와 사용자 프로필을 커밋하지 마세요.

## 음악과 외부 자산

**“Origami” — Scott Buckley**, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). 출처: [Scott Buckley 공식 곡 페이지](https://www.scottbuckley.com.au/library/origami/), [공식 사용 안내](https://www.scottbuckley.com.au/library/using-this-music/).

원곡의 00:00–00:56 구간을 사용하고 음량을 3.6 dB 낮췄습니다. 0.12초 페이드인과 53–56초 페이드아웃을 적용하고, 56–60초에 무음을 추가했으며, 48 kHz 스테레오 WAV로 변환했습니다. 기존 음원 제작 기록에는 ATHENA V6용 가공으로 기재되어 있습니다. 자세한 출처와 게시 시 크레딧 안내는 [source/video/audio/attribution.txt](./source/video/audio/attribution.txt)에 보존되어 있습니다.

FFmpeg와 폰트 등 외부 자산의 기존 라이선스·출처 고지를 유지합니다. 이 저장소는 모든 파일에 일괄 적용되는 소프트웨어 라이선스를 별도로 부여하지 않습니다.

## 관련 저장소

- [DAOU.Athena](https://github.com/ANNJUNGCHAN/DAOU.Athena) — ATHENA 앱
- [DAOU.Athena-Web](https://github.com/ANNJUNGCHAN/DAOU.Athena-Web) — ATHENA 웹
