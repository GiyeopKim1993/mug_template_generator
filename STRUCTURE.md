# 구조 보고서 (STRUCTURE) — 2026-10-04 · v4.14 기준

요청: "뭐가 잘못됐는지 보고 → 개선 방향 → 적용"

## 1. 진단: 왜 버그 경로가 자꾸 생기나

| # | 안티패턴 | 증거 (현장) | 초래한 버그 |
|---|---|---|---|
| A1 | **모놀리스** `js/app.js` 2,462줄 — 에디터·렌더링·3D·PDF·배치·광고·UI 한 파일 | grep 한 번에 200+ 함수 | 어디를 고쳐도 다른 곳이 깨짐 (UI 6종 테스트가 매번 깨진 이유) |
| A2 | **전역 가변 `state` + DOM id 직접 결합** | 모든 핸들러가 `state.x=…; renderY()` 수동 전파 | 순서 의존: 값을 바꿔도 렌더를 안 부르면 다른 화면이 구식 — "가운데 안 맞음"류 잠재 버그 |
| A3 | **`applyDraft()` 재사용 = 렌더링 엔진이 상태 복원기 겸업** | `__computeImposedPages()`가 `applyDraft(d,true)`로 작업 교체 후 caller가 snapshot 복원 | 동시 빌드 race, 빌드 중 UI가 임시값으로 노출 (관측 버그 3종의 근원). quiet/락으로 **봉인만** 한 상태 = 반쪽 해결 |
| A4 | **단건/일괄 2중 파이프라인** | `exportPdf()`/`buildPdfBlob()` vs `buildImposedPdf()` 각각 구현 | "인쇄는 안 겹치는데 내보내기는 겹친다" = 한쪽만 고친 버그 구조 |
| A5 | **미리보기↔PDF 재계산 이중** | `buildImposedPrev()`와 `buildImposedPdf()`가 같은 키를 각각 캐시 | 미리보기와 실제 내보내기가 다른 결과를 낼 수 있음 |
| A6 | **데드코드 방치** | `zipStore()` 27줄, savePanel의 zip 분기 — ZIP 제거 후 방치 | 코드 독해 비용 + "zip 아직 있나?" 헷갈림 |
| A7 | **테스트가 UI 문구·id에 결합** | 테스트가 한글 카피/세그먼트 id를 직접 스냅 | 구조 개선=테스트 개보수 (매 회귀 라운드마다 수술한 직접 원인) |

## 2. 이미 적용된 것 (이 보고서와 함께)

- ✅ **A6 제거**: `zipStore` + savePanel zip 분기 완전 삭제 — `zip` 문자열 0 (user 복사 "ZIP 없음" 문구만 유지). 게이트: unit 38/38 · savepanel ✓ · r5 ALL PASS.
- ✅ R12에서 일부 완료: 단건/일괄 **저장 패널·미리보기 UI 통합**, `_imp` 캐시 1곳, quiet 래퍼, A4 단일화.

## 3. 개선 로드맵 (각 단계 = 전체 테스트 통과가 게이트)

### ✅ S3-a: `computeImposedPages` 상태 해방 — 완료 (2026-10-04)
- `drawArtwork`/`composeArtFlat`/`designIdxFor`에 **선택 `env` 인자** 도입 (`E = env || state` → 미전달 시 동작 불변).
- compute 루프 = `draftEnv(d)`로 렌더 → **`applyDraft`·state 변이 0회**.
- 삭제: `_applyQuiet` 전역 플래그, quiet 래퍼, `buildImposedPrev`/`exportPdf` list의 snapshotNow 복원 dance 2곳.
- 게이트: unit 38/38 · r5 · savepanel · e2e · workbench · paths · interact PASS.

### ✅ S3-b: 미리보기↔내보내기 단일 결과 — 완료 (2026-10-04)
- `_imp.result`가 compute 결과 전체를 캐시 → `buildImposedPdf`는 키 일치 시 **그대로 재사용**(재계산 0, 미리보기와 바이트 동일 보장).
- 부정 캐시·스코프 전환 시 캐시 클리어 포함.
- 게이트: 전체 15종 회귀 ALL GREEN.

### ✅ S4: 결합 해소 (A1/A2/A7) — 1차 완료 (2026-10-05)
- `js/store.js`(state·config·drafts·`onStateChange`/`notifyState` 구독) / `js/export.js`(PDF·FCM·저장 파이프라인·`_imp` 공유 캐시) 분리 — app.js는 UI 바인딩·렌더링 (2,187→1,793줄).
- A7 해소: 토스트 `data-code`(`support-unset`·`donor-invalid`·`donor-ok`) · `draftCount[data-n]` — 한글 카피 변경이 테스트를 깨지 않음. #1 레이아웃 = ui4 단언 잠금.
- script 순서: config → store → export → app (index.html).
- 게이트: 전 회귀 18종 ALL GREEN 후 커밋.

## 4. 하지 않는 것 (합의된 불변)
- `computeLayout`(단건 인쇄) 정상 경로 — 건드리지 않음 (R12 계약).
- contain/노스트레치, 가이드 비인쇄, 단건·일괄 통합 UX.

## 5. CMYK·순백 알파 PDF — 구현 완료 (2026-10-04 착수 → 2026-10-05 Phase2 구현·전 배터리 검증)
- **요구**: ①합성 이미지를 CMYK로 분리·재합치(DeviceCMYK로 저장) ②빈 곳 + **순백색 전부 알파**(무도색 → 인쇄 시 잉크 안 침) ③미리보기도 동일 규칙 (사용자 확정: 순백 전부 알파).
- **현재**: `pure.js buildPdf` = `/DeviceRGB /Filter /DCTDecode`(JPEG, 흰배경 플랫). SMask 없음.
- **방침**: 단건·일괄·미리보기 공통 파이프라인(composeArtFlat/cells)에서 1회 변환.
  1. 래스터 → 픽셀 루프: `alpha = (r,g,b ≈ 255) ? 0 : 255`(순백·기존투명 통합), `C=255-R, M=255-G, Y=255-B, K=min(C,M,Y) 보정`(단순 근사 CMYK, ICC 없이).
  2. PDF 임베드: CMYK = raw→Flate(`CompressionStream('deflate')`, buildPdf async화 검토) 또는 PNG-없음 → **Flate+Predictor 15** 경로. 알파 = DeviceGray SMask 동일 경로.
  3. 검증: pypdfium2로 흰 배경 합성 시 기존 렌더와 동일해야 함(알파 영역=무잉크), interior·e2e·r5·savepanel 게이트 + 참고 PDF 3장 겹침 0 유지.
- **위험**: buildPdf sync→async 시 unit 테스트 호출부 정정 필요; 페이지 크기 증가 추적.
- **⚠ 요구 개정 (2026-10-05)**: 위 ② "순백 전부 알파"는 **오해석으로 폐기**. 정확한 요구 = **알파는 소스에 데이터 없는(투명) 영역만**; CMYK(0,0,0,0) 순백은 유효 데이터 → alpha 255 유지. 레이어 `W` 토글·`knockCanvas` 화이트 키링 전부 삭제, `pdfArtRaster` 알파 = `src alpha < 16`만 0.

## 6. R-리팩토링 4단계 (#4, 2026-10-06) — 每 단계 배터리 18 → 커밋
- **R-1 `a8e0827` 역할별 분할**: `js/app.js` 1,792행 → **design-core / stage3d / editor-canvas / editor-ops / editor-preview / support / app(부트)** 7슬라이스. classic script 연속 슬라이싱 = 전역 가시성·실행순서 보존(파일러간 top-level 실행 순서 동일). 부수 수정: 마크 data-URL `onload → drawPagePrev()` 레이스 제거(선언 전 발화 가능 → 부트 시점 디코드로 이동, 5회 연속 스트레스 0에러).
- **R-2 `5307dc1` 중복·데드코드**: `segTransform(x,y,h,or)` (내부 4중복 인라인 폐기: buildDxf·buildSvg·support셀·cutTransform) + `wrapSegsToPts` (export/support 컷 아웃라인 매퍼 문자 그대로 중복 통합) → pure.js 공유화. 상단 전역 미사용 식별자 0(스캔), 동일 함수 몸체 중복 0.
- **R-3 `583646f` 재배치·정규화**: `composeArtFlat`→design-core(래스터 = drawArtwork 곁), `composePageArt`·`exportPdf`·`computeImposedPages`→export.js(파이프라인 본거지), support.js = drafts·support·ads 전용. 전 슬라이스 **역할+로드순서 헤더** 정비(stage3d "pure canvas 2D" 오역 교정, support "PDF export" 오표기 교정), 인라인 mv 로더 → `js/mv-boot.js`, index.html 스크립트 태그 그룹 주석화.
- **R-4**: 이 문서 + README 반영, pure 공유 히어러퍼 단위 테스트 추가(unit 38→46).
- **로드 순서 (index.html)**: fcm-lib → pure → config → store → export → design-core → stage3d → editor-canvas → editor-ops → editor-preview → support → app → i18n → mockup → mv-boot(3D, http only).
- 게이트: 4단계 모두 배터리 18/18 GREEN 후 push.

