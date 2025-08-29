// Simple 2D path visualization using SVG
(() => {
  const svg = document.getElementById('svg');
  const NS = 'http://www.w3.org/2000/svg';
  const W = 1200, H = 720;

  // World points
  const A = { x: 120, y: 560 };
  const B = { x: 1040, y: 160 };
  const L = { x: 320, y: 240 }; // left speaker
  const R = { x: 880, y: 520 }; // right speaker

  function rnd(n=1){ return (Math.random()*n); }
  function lerp(a,b,t){ return a + (b-a)*t; }
  function dist(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return Math.hypot(dx,dy); }

  function intensity(p, s){ const d = dist(p,s)+8; return 1/(d*d); }
  function scorePath(pts){
    let acc = 0, len=0;
    for (let i=0;i<pts.length;i++){
      const p = pts[i];
      const Il = intensity(p,L), Ir = intensity(p,R);
      const loud = Math.max(Il, Ir);
      acc += loud;
      if (i>0) len += dist(pts[i-1], p);
    }
    return acc - 0.0009*len;
  }

  function bezierPoints(ctrl, n=160){
    const p = [A, ...ctrl, B];
    const out = [];
    function catmull(i,t){
      const p0 = p[Math.max(0,i-1)], p1=p[i], p2=p[i+1], p3=p[Math.min(p.length-1,i+2)];
      const t2=t*t, t3=t2*t;
      function cmp(a,b,c,d){ return 0.5*((2*b) + (-a + c)*t + (2*a-5*b+4*c-d)*t2 + (-a+3*b-3*c+d)*t3); }
      return { x: cmp(p0.x,p1.x,p2.x,p3.x), y: cmp(p0.y,p1.y,p2.y,p3.y) };
    }
    for(let i=0;i<p.length-1;i++){
      for(let j=0;j<n/(p.length-1);j++) out.push(catmull(i,j/Math.max(1,(n/(p.length-1)-1))));
    }
    return out;
  }

  function makeCandidate(seed){
    const rng = mulberry32(seed);
    const ctrl = [];
    const K = 4;
    for (let i=0;i<K;i++){
      ctrl.push({
        x: lerp(A.x,B.x,(i+1)/(K+1)) + (rng()*2-1)*180,
        y: lerp(A.y,B.y,(i+1)/(K+1)) + (rng()*2-1)*140,
      });
    }
    const pts = bezierPoints(ctrl, 180);
    return { ctrl, pts, score: scorePath(pts) };
  }

  function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
  }

  function create(){ while(svg.firstChild) svg.removeChild(svg.firstChild);
    // Field background
    const rect = document.createElementNS(NS,'rect'); rect.setAttribute('x',0); rect.setAttribute('y',0); rect.setAttribute('width',W); rect.setAttribute('height',H); rect.setAttribute('fill','url(#bg)'); svg.appendChild(rect);

    // defs for background gradient
    const defs = document.createElementNS(NS,'defs');
    const grad = document.createElementNS(NS,'linearGradient'); grad.setAttribute('id','bg'); grad.setAttribute('x1','0%'); grad.setAttribute('y1','100%'); grad.setAttribute('x2','100%'); grad.setAttribute('y2','0%');
    const s1 = document.createElementNS(NS,'stop'); s1.setAttribute('offset','0%'); s1.setAttribute('stop-color','#0f1220');
    const s2 = document.createElementNS(NS,'stop'); s2.setAttribute('offset','100%'); s2.setAttribute('stop-color','#0a0c14');
    grad.appendChild(s1); grad.appendChild(s2); defs.appendChild(grad);
    svg.appendChild(defs);

    // speakers and markers
    circle(L.x, L.y, 10, '#3b82f6', 0.9);
    circle(R.x, R.y, 10, '#ef4444', 0.9);
    circle(A.x, A.y, 8, '#ffffff', 0.9);
    circle(B.x, B.y, 8, '#22c55e', 0.9);

    const seeds = Array.from({length: 18}, (_,i)=> (Math.random()*1e9)|0);
    const candidates = seeds.map(makeCandidate).sort((a,b)=> b.score - a.score);
    const best = candidates[0];

    // draw others
    for (let i=1;i<candidates.length;i++) drawPath(candidates[i].pts, 'rgba(139,92,246,0.25)', 3);
    // draw best
    const bestPath = drawPath(best.pts, '#8b5cf6', 4.5);
    animateDot(best.pts, '#e6e9ef', ()=> animateDot(best.pts, '#e6e9ef'));

    // title overlay
    label('A', A.x+10, A.y-10);
    label('B', B.x+10, B.y-10);
  }

  function circle(x,y,r,fill='white',op=1){ const c=document.createElementNS(NS,'circle'); c.setAttribute('cx',x); c.setAttribute('cy',y); c.setAttribute('r',r); c.setAttribute('fill',fill); c.setAttribute('opacity',op); svg.appendChild(c); return c; }
  function label(text,x,y){ const t=document.createElementNS(NS,'text'); t.setAttribute('x',x); t.setAttribute('y',y); t.setAttribute('fill','#aab1c5'); t.setAttribute('font-family','Inter, system-ui'); t.setAttribute('font-size','12'); t.textContent=text; svg.appendChild(t); return t; }
  function drawPath(pts, color, w){
    const p = document.createElementNS(NS,'path');
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i=1;i<pts.length;i++) d += ` L ${pts[i].x} ${pts[i].y}`;
    p.setAttribute('d', d);
    p.setAttribute('fill','none');
    p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', String(w));
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    return p;
  }

  function animateDot(pts, color='#fff', onEnd){
    const dot = circle(pts[0].x, pts[0].y, 6, color, 1);
    let i = 0; const N = pts.length; const dur = 3200; const step = Math.max(1, Math.floor(N/(dur/16)));
    function tick(){ i += step; if (i>=N) { svg.removeChild(dot); onEnd && onEnd(); return; }
      dot.setAttribute('cx', pts[i].x); dot.setAttribute('cy', pts[i].y);
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function reseed(){ create(); }
  function play(){ create(); }

  document.getElementById('btnPlay').addEventListener('click', play);
  document.getElementById('btnReseed').addEventListener('click', reseed);

  // initial
  create();
})();
