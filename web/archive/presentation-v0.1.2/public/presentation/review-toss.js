/* Review-only override. Every product visual comes from a cited official page. */
(() => {
  const scenes = window.ATHENA_SCENES ||= {};
  const cards = [
    ['rt-api', 'Open API', '국내·미국 주식 API 연결', 'assets/revision/docs/toss-service.png'],
    ['rt-auth', '인증과 호출', 'OAuth 2.0 토큰 · 공식 curl 예제', 'assets/review-toss/openapi/auth.png'],
    ['rt-rest', '시세 조회', '현재가 · 호가 · 체결 · 캔들 API', 'assets/review-toss/openapi/market-data.png'],
    ['rt-websocket', '실시간 구독', 'WebSocket 연동 · 공식 Python 예제', 'assets/review-toss/openapi/connection.png']
  ];
  scenes['s07-toss'] = {
    title: 'Open API로 투자 기능 연결', duration: 1250, revision: true,
    render: () => `<section class="review-toss"><header><span>토스증권</span><h1>Open API로 투자 기능 연결</h1><p>국내·미국 주식의 시세와 주문을 내 서비스에 연결합니다.</p></header><div class="rt-collage"><div class="rt-brand">토스증권<small>Open API · REST · WebSocket</small></div>${cards.map(([cls,title,caption,img])=>`<figure class="rt-card ${cls}"><figcaption><b>${title}</b><span>${caption}</span></figcaption><img src="${img}" alt="${caption}"></figure>`).join('')}</div><footer>공식 공개 자료 · p.tossinvest.com/ko/open-api · developers.tossinvest.com/docs<br>Open API 소개 및 공식 개발자 문서 발췌 · 인증 / 시세 조회 / 웹소켓 연동</footer></section>`,
    play: async (root,api) => { await Promise.all([...root.querySelectorAll('.rt-card')].map((el,i)=>api.animate(el,[{opacity:0,translate:'0 18px'},{opacity:1,translate:'0 0'}],{duration:api.reduced?1:650,delay:api.reduced?0:i*150,fill:'both'}))); }
  };
})();
