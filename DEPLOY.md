# 배포 · 광고 가이드 (DEPLOY)

> v4.18 · GitHub → Cloudflare Pages 자동 배포 + 애드센스/애드핏 병행 준비

## 1. Cloudflare Pages 자동 배포 파이프라인

원하는 흐름 그대로: **관리자 편집 → Git push → 사이트 자동 갱신**.

### 1회 세팅 (본인 계정, 약 5분)
1. [Cloudflare 대시보드](https://dash.cloudflare.com) 가입 (무료 요금제)
2. **Workers & Pages → Create → Pages → Connect to Git**
3. GitHub 저장소 `GiyeopKim1993/mug_template_generator` 선택 (권한 승인)
4. 빌드 구성 (정적 사이트라 그대로):
   - Framework preset: **None**
   - Build command: *(비움)* · Output directory: **/** (저장소 루트)
5. Save and deploy → `https://mug-template.pages.dev` 발급
6. (권장) Custom domain 추가 → DNS 위임 → 무료 SSL 자동

### 이후 흐름 (자동)
```
노트북/Codespace에서 편집 (js/config.js 등)
   → git add/commit/push
   → Cloudflare가 자동 빌드(정적 복사) · 배포
   → 사이트 반영 (보통 30초~1분)
```
- 참고: GitHub Pages도 광고가 허용되지만 무료 대역폭 소프트캡(100GB/월)이 있어 **CF Pages(무제한 대역폭)** 를 우선합니다. 둘 다 켜두는 것도 가능(_CF가 메인_).
- 빌드 한도: 무료 500회/월(하루 약 16회) — 사람 수준의 push에는 충분합니다.

### 관리자 편집 위치
- 광고·후원 설정: **`js/config.js`** (`MT_CONFIG` — 코드스페이스에서 `node admin/server.js` UI 또는 직접 편집)
- 수정 후 push하면 자동 반영됩니다. `version`을 올리면 광고 쿨다운이 초기화됩니다.

## 2. 애드센스 + 애드핏 병행 코드

두 네트워크는 **동시 삽입 가능**합니다. `js/config.js`의 `ad.html`에 아래를 **둘 다** 붙여넣고 `ad.enabled=true`:

```html
<!-- Google AdSense (본인 ca-pub-XXXXXXXXXXXXXXXX 로 교체) -->
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX" crossorigin="anonymous"></script>
<ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-XXXXXXXXXXXXXXXX"
     data-ad-slot="SLOT_ID" data-ad-format="auto" data-full-width-responsive="true"></ins>
<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>

<!-- Kakao AdFit (본인 TD-XXXXXXX 로 교체) -->
<script src="https://t1.daumcdn.net/kas/static/ba.min.js" async></script>
<ins id="kakao_ad_slot" style="display:none;width:100%" data-ad-unit="TD-XXXXXXX"
     data-ad-width="320" data-ad-height="50"></ins>
<script>try{(kakaoAdQueue=kakaoAdQueue||[]).push(function(){kakao.show();});}catch(e){}</script>
```

- 노출 위치: `#adSlot` (출력 카드) — 트리거: 내보내기 3회 / 디자인 5개 이상 (config.triggers)
- ✕ 닫기 = 현재 세션 해제 (`adCloseMutes`)

## 3. 심사 체크리스트 (두 심사 합본)

### 사이트가 이미 갖춘 것
- [x] 소개 페이지 `about.html` · 문의 페이지 `contact.html` · 개인정보처리방침 `privacy.html` (개인정보처리방침에 **두 네트워크 병행** 명시)
- [x] 푸터에서 세 페이지 링크 노출 + 처리방침 상시 접근
- [x] 브라우저 내 처리(업로드 전송 없음) 명시 — 신뢰성
- [x] 모바일 대응 · 내부 링크 정상

### 본인이 할 일 (계정 생성 순)
1. **애드핏 먼저** (심사·정산이 빠름): [애드핏 파트너 가입](https://adfit.kakao.com) → 심사 사이트 URL = CF Pages/커스텀 도메인
2. **애드센스**: [adsense.google.com](https://adsense.google.com) 가입 → 사이트 URL 등록 → 위3페이지 확인 후 신청
3. 계정 정보: 애드센스는 **지급 주소·세금 정보**(개인 가능), 애드핏은 본인 확인 절차
4. 승인 후 발급되는 코드(`ca-pub-…`, `TD-…`)를 §2 스니펫에 교체 → push → 자동 배포
5. 애드센스 $100 지급 조건·PIN 확인, 애드핏 익월 15일 정산 (별도 안내 문서 참조)

### 유지해야 할 규칙
- 페이지당 광고 과밀 금지 (현재 슬롯1곳·트리거식 노출)
- 유도 클릭·가짜 다운로드 버튼 금지 (내보내기는 실제 다운로드 ✓)
- 개인정보처리방침은 광고 코드 추가 시 함께 갱신

## 4. 라이선스 표기
- 3D 모델 후보: viromedia/virocore (MIT) — 통합 시 `assets/ATTRIBUTION.txt`에 표기
- FCM 인코더: [open-fcm](https://github.com/markuryy/open-fcm) (MIT) — `js/fcm-lib.js` 헤더에 표기됨
