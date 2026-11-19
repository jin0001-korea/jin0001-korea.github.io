/* 곤지암 강사 후기 위젯 — 아임웹(캐치스키/라이즌) 페이지 삽입용.
 * 사용법: <div data-gonjiam-reviews="catchski"></div>
 *        <script src="https://jin0001-korea.github.io/reviews/widget.js" defer></script>
 * - 데이터: Supabase Edge(slope-reviews) 공개 GET(승인 후기만).
 * - 스타일: Shadow DOM — 아임웹 테마와 충돌하지 않는다.
 * - SEO/GEO: 페이지 head 에 schema.org JSON-LD(Service + AggregateRating + Review)를 주입한다.
 * - 모든 텍스트는 textContent 로만 렌더한다(XSS 차단).
 */
(() => {
'use strict';
const SUPABASE_HOST = 'https://ewiekbmjvgktwsbbxrzw.supabase.co';
const ENDPOINT = SUPABASE_HOST + '/functions/v1/slope-reviews';
const PAGE_SIZE = 10;
const CSS = `
:host{all:initial;display:block;font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif;color:#20242b;line-height:1.6}
.box{max-width:860px;margin:0 auto}
.head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:4px}
.head h3{font-size:20px;margin:0;font-weight:800}
.head .avg{color:#f59e0b;font-weight:800;font-size:18px}
.head .cnt{color:#6b7280;font-size:14px}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 16px}
.chip{border:1px solid #e2e5ea;background:#fff;border-radius:999px;padding:5px 12px;font-size:13px;cursor:pointer;color:#374151}
.chip .s{color:#f59e0b;font-weight:700}
.chip.on{background:#20242b;border-color:#20242b;color:#fff}
.chip.on .s{color:#fbbf24}
.card{border:1px solid #e9ecf0;border-radius:12px;padding:14px 16px;margin-bottom:10px;background:#fff}
.card .top{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap}
.card .who{font-weight:700;font-size:15px}
.card .stars{color:#f59e0b;letter-spacing:1px}
.card .date{color:#9ca3af;font-size:12px}
.card .body{margin-top:6px;font-size:14px;white-space:pre-wrap;word-break:break-word}
.card .body.clamp{display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}
.more-text{border:0;background:none;color:#2563eb;font-size:13px;cursor:pointer;padding:4px 0}
.shots{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.shots a{display:block}
.shots img{width:84px;height:84px;object-fit:cover;border-radius:8px;border:1px solid #e9ecf0}
.more{width:100%;padding:11px;border:1px solid #e2e5ea;border-radius:10px;background:#fff;font-size:14px;cursor:pointer;margin-top:4px}
.empty{color:#6b7280;font-size:14px;padding:18px 0;text-align:center}
`;

function starText(rating) { return '★★★★★'.slice(0, rating) + '☆☆☆☆☆'.slice(0, 5 - rating); }
function koreanDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? `${match[1]}.${match[2]}.${match[3]}` : '';
}

function injectJsonLd(brand, brandName, summary, reviews) {
  if (!summary.count) return;
  // 아임웹이 PC/모바일 섹션으로 같은 위젯을 두 번 배치해도 JSON-LD 는 브랜드당 1개만.
  if (document.head.querySelector(`script[data-gonjiam-reviews-ld="${brand}"]`)) return;
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: `${brandName} 스키·보드 강습`,
    provider: { '@type': 'LocalBusiness', name: brandName, url: location.origin },
    aggregateRating: { '@type': 'AggregateRating', ratingValue: summary.average, reviewCount: summary.count, bestRating: 5, worstRating: 1 },
    review: reviews.slice(0, 10).map(review => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: '수강생' },
      datePublished: review.reviewDate,
      reviewBody: review.body.slice(0, 500),
      name: `${review.instructorName} 강사 강습 후기`,
      reviewRating: { '@type': 'Rating', ratingValue: review.rating, bestRating: 5, worstRating: 1 },
    })),
  };
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.dataset.gonjiamReviewsLd = brand;
  // HTML 재직렬화(프리렌더·캐시) 시 본문의 "</script>" 가 태그를 닫지 못하게 이스케이프.
  script.textContent = JSON.stringify(payload).replace(/</g, '\\u003c');
  document.head.appendChild(script);
}

function render(root, data) {
  // 스크립트가 두 번 로드돼 boot 가 동시에 돌아도(둘 다 fetch 대기 통과) throw 없이 마지막 렌더가 이긴다.
  const shadow = root.shadowRoot || root.attachShadow({ mode: 'open' });
  shadow.textContent = '';
  const style = document.createElement('style'); style.textContent = CSS; shadow.appendChild(style);
  const box = document.createElement('div'); box.className = 'box'; shadow.appendChild(box);

  const head = document.createElement('div'); head.className = 'head';
  const title = document.createElement('h3'); title.textContent = `${data.brandName} 수강생 후기`;
  head.appendChild(title);
  if (data.summary.count) {
    const avg = document.createElement('span'); avg.className = 'avg'; avg.textContent = `★ ${data.summary.average}`;
    const cnt = document.createElement('span'); cnt.className = 'cnt'; cnt.textContent = `실제 수강 후기 ${data.totalCount || data.summary.count}건`;
    head.append(avg, cnt);
  }
  box.appendChild(head);

  const listWrap = document.createElement('div');
  const moreButton = document.createElement('button'); moreButton.className = 'more'; moreButton.type = 'button'; moreButton.textContent = '후기 더 보기';
  let filter = null, shown = PAGE_SIZE;

  if (data.summary.instructors.length > 1) {
    const chips = document.createElement('div'); chips.className = 'chips';
    const makeChip = (label, star, value) => {
      const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'chip' + (value === null ? ' on' : '');
      chip.appendChild(document.createTextNode(label + ' '));
      if (star !== null) { const s = document.createElement('span'); s.className = 's'; s.textContent = `★${star}`; chip.appendChild(s); }
      chip.addEventListener('click', () => {
        filter = value; shown = PAGE_SIZE;
        for (const item of chips.children) item.classList.remove('on');
        chip.classList.add('on');
        paint();
      });
      chips.appendChild(chip);
    };
    makeChip(`전체 ${data.summary.count}`, null, null);
    for (const item of data.summary.instructors) makeChip(`${item.name} ${item.count}`, item.average, item.name);
    box.appendChild(chips);
  }
  box.appendChild(listWrap);
  box.appendChild(moreButton);
  moreButton.addEventListener('click', () => { shown += PAGE_SIZE; paint(); });

  function paint() {
    listWrap.textContent = '';
    const rows = filter ? data.reviews.filter(review => review.instructorName === filter) : data.reviews;
    if (!rows.length) {
      const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '아직 등록된 후기가 없습니다.';
      listWrap.appendChild(empty); moreButton.hidden = true; return;
    }
    for (const review of rows.slice(0, shown)) {
      const card = document.createElement('article'); card.className = 'card';
      const top = document.createElement('div'); top.className = 'top';
      const who = document.createElement('span'); who.className = 'who'; who.textContent = `${review.instructorName} 강사`;
      const stars = document.createElement('span'); stars.className = 'stars'; stars.textContent = starText(review.rating);
      const date = document.createElement('span'); date.className = 'date'; date.textContent = koreanDate(review.reviewDate);
      top.append(who, stars, date); card.appendChild(top);
      const body = document.createElement('div'); body.className = 'body'; body.textContent = review.body;
      card.appendChild(body);
      if (review.body.length > 180) {
        body.classList.add('clamp');
        const expand = document.createElement('button'); expand.type = 'button'; expand.className = 'more-text'; expand.textContent = '더 읽기';
        expand.addEventListener('click', () => { body.classList.remove('clamp'); expand.remove(); });
        card.appendChild(expand);
      }
      if (review.photos.length) {
        const shots = document.createElement('div'); shots.className = 'shots';
        for (const photo of review.photos.slice(0, 6)) {
          if (!photo.startsWith(SUPABASE_HOST + '/')) continue;
          const link = document.createElement('a'); link.href = photo; link.target = '_blank'; link.rel = 'noopener noreferrer';
          const img = document.createElement('img'); img.loading = 'lazy'; img.src = photo; img.alt = `${review.instructorName} 강사 강습 후기 사진`;
          link.appendChild(img); shots.appendChild(link);
        }
        card.appendChild(shots);
      }
      listWrap.appendChild(card);
    }
    moreButton.hidden = rows.length <= shown;
  }
  paint();
}

async function boot() {
  const containers = document.querySelectorAll('[data-gonjiam-reviews]');
  for (const container of containers) {
    const brand = container.getAttribute('data-gonjiam-reviews');
    if (!/^(catchski|risenski)$/.test(brand) || container.shadowRoot) continue;
    try {
      const response = await fetch(`${ENDPOINT}?brand=${brand}`);
      if (!response.ok) continue;
      const data = await response.json();
      if (container.shadowRoot && container.shadowRoot.childNodes.length) continue;
      render(container, data);
      injectJsonLd(brand, data.brandName, data.summary, data.reviews);
    } catch (error) {
      try { console.warn('[gonjiam-reviews]', error); } catch {}
    }
  }
}
window.gonjiamReviewsScan = boot;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
