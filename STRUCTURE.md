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
- `js/store.js`(state·config·drafts·`onStateChange`/`notifyState` 구독) / `js/export.js`(PDF·DXF·저장 파이프라인·`_imp` 공유 캐시) 분리 — app.js는 UI 바인딩·렌더링 (2,187→1,793줄).
- A7 해소: 토스트 `data-code`(`support-unset`·`donor-invalid`·`donor-ok`) · `draftCount[data-n]` — 한글 카피 변경이 테스트를 깨지 않음. #1 레이아웃 = ui4 단언 잠금.
- script 순서: config → store → export → app (index.html).
- 게이트: 전 회귀 18종 ALL GREEN 후 커밋.

## 4. 하지 않는 것 (합의된 불변)
- `computeLayout`(단건 인쇄) 정상 경로 — 건드리지 않음 (R12 계약).
- contain/노스트레치, 가이드 비인쇄, 단건·일괄 통합 UX.

## 5. CMYK·순백 알파 PDF — 구현 노트 (2026-10-04, 착수 준비 완료)
- **요구**: ①합성 이미지를 CMYK로 분리·재합치(DeviceCMYK로 저장) ②빈 곳 + **순백색 전부 알파**(무도색 → 인쇄 시 잉크 안 침) ③미리보기도 동일 규칙 (사용자 확정: 순백 전부 알파).
- **현재**: `pure.js buildPdf` = `/DeviceRGB /Filter /DCTDecode`(JPEG, 흰배경 플랫). SMask 없음.
- **방침**: 단건·일괄·미리보기 공통 파이프라인(composeArtFlat/cells)에서 1회 변환.
  1. 래스터 → 픽셀 루프: `alpha = (r,g,b ≈ 255) ? 0 : 255`(순백·기존투명 통합), `C=255-R, M=255-G, Y=255-B, K=min(C,M,Y) 보정`(단순 근사 CMYK, ICC 없이).
  2. PDF 임베드: CMYK = raw→Flate(`CompressionStream('deflate')`, buildPdf async화 검토) 또는 PNG-없음 → **Flate+Predictor 15** 경로. 알파 = DeviceGray SMask 동일 경로.
  3. 검증: pypdfium2로 흰 배경 합성 시 기존 렌더와 동일해야 함(알파 영역=무잉크), interior·e2e·r5·savepanel 게이트 + 참고 PDF 3장 겹침 0 유지.
- **위험**: buildPdf sync→async 시 unit 테스트 호출부 정정 필요; 페이지 크기 증가 추적.
- **⚠ 요구 개정 (2026-10-05)**: 위 ② "순백 전부 알파"는 **오해석으로 폐기**. 정확한 요구 = **알파는 소스에 데이터 없는(투명) 영역만**; CMYK(0,0,0,0) 순백은 유효 데이터 → alpha 255 유지. 레이어 `W` 토글·`knockCanvas` 화이트 키링 전부 삭제, `pdfArtRaster` 알파 = `src alpha < 16`만 0.
