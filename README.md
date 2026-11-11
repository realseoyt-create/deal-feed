# 꿀딜 피드 (개인용)

뽐뿌게시판 RSS를 GitHub Actions가 10분마다 수집 → 알림 후보만 다나와 시세 확인 → 텔레그램 발송 → `docs/deals.json` 갱신 → GitHub Pages로 표시.

- 웹: https://realseoyt-create.github.io/deal-feed/
- 실행 기록: 저장소 **Actions** 탭 (수동 실행: collect → Run workflow)

## 알림 조건 바꾸기
`settings.json` 을 GitHub에서 직접 수정하면 다음 실행부터 반영됩니다.

| 키 | 의미 |
|---|---|
| `keywords` | 제목에 포함되면 후보 (다나와보다 비싸지 않으면 발송) |
| `categories` + `maxPrice` | 해당 카테고리 & 가격 이하면 후보 |
| `hotRecommend` | 추천수 이상이면 후보 |
| `hotTopPercent` / `hotViewsPerMin` | 최근 24시간 조회속도 상위 N% (최소 기준값) — 다나와보다 싸다는 확인 필수 |
| `minDiscountPct` | 카테고리·조회 후보에 요구하는 다나와 대비 최소 할인율 |
| `excludeKeywords` | 포함되면 제외 |

텔레그램 토큰·채팅 ID는 저장소 **Settings → Secrets → Actions** 의 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

## 로컬
```
npm run once      # 1회 수집 (환경변수 없으면 텔레그램 미발송)
npm run preview   # http://localhost:3000
```

## 주의
- 개인 용도. 공개 저장소라 최근 3일치 제목·가격·링크만 보관, 본문은 저장하지 않음.
- Actions cron은 GitHub 사정으로 지연될 수 있음. RSS는 최신 15건만 제공해 몰리는 시간대엔 일부 누락 가능.
- 다나와 비교는 상품명 자동 매칭(모델명·용량·수량 검사)이라 참고용.
