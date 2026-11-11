(() => {
let THREE, mergeGeometries;
const DURATION = 28;
const CLS = { grass: 1, leaf: 2, flower: 3, stone: 4, path: 5, roof: 6, wall: 7, field: 8, water: 9, foam: 10, figure: 11, wood: 12, rock: 13 };

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = x => x - Math.floor(x);
const hash2 = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), f = x - i, g = y - j, u = f * f * (3 - 2 * f), v = g * g * (3 - 2 * g);
  return (hash2(i, j) * (1 - u) + hash2(i + 1, j) * u) * (1 - v) + (hash2(i, j + 1) * (1 - u) + hash2(i + 1, j + 1) * u) * v;
}
const fbm = (x, y) => vnoise(x, y) * .5 + vnoise(x * 2.1 + 3, y * 2.1) * .28 + vnoise(x * 4.3, y * 4.3 + 5) * .15 + vnoise(x * 8.7, y * 8.7) * .07;
let seed = 41;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const yieldFrame = () => new Promise(r => setTimeout(r, 0));

const time = { value: 0 };
function tag(mat, cls, extra) {
  mat.onBeforeCompile = (s) => {
    extra?.(s);
    s.fragmentShader = s.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>\n gl_FragColor.a = ${(cls / 16).toFixed(4)};`);
  };
  mat.customProgramCacheKey = () => `c${cls}${extra ? extra.toString().length : 0}`;
  return mat;
}
const TEX = () => window.__dioramaTex || {};
const loadImg = (name) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = TEX()[name]; });
function pixels(img, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h);
  return { d: x.getImageData(0, 0, w, h).data, w, h };
}
let texLoader;
function tex(name, rx = 1, ry = 1) {
  texLoader ||= new THREE.TextureLoader();
  const t = texLoader.load(TEX()[name]);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 4;
  return t;
}

const riverZ = (x) => 15.5 + .1 * x + (fbm(x * .08 + 7, 2.1) - .5) * 6;
const ROCKS = [];
for (let i = 0; i < 40; i++) {
  const x = -34 + rnd() * 68, off = (rnd() < .5 ? -1 : 1) * (1.6 + rnd() * rnd() * 3), r = .3 + rnd() * rnd() * 1.1;
  ROCKS.push([x, riverZ(x) + off, r]);
}
function rawH(x, z) {
  const d = riverZ(x) - z;
  let y = d < 0 ? -1.6 + 2.3 * (1 - Math.exp(d * .7)) : -1.6 + 2.9 * (1 - Math.exp(-d * .45)) + d * .34;
  const hills = (fbm(x * .07, z * .07) - .5) * 5.2 + (fbm(x * .35, z * .35) - .5) * .7;
  y += sstep(0, 5, d) * hills;
  const terrace = sstep(2.6, 4.2, d) * sstep(13.5, 10.5, d);
  if (terrace > 0) y = y * (1 - terrace) + (Math.floor(y / .62) * .62 + .14) * terrace;
  for (const [rx, rz, r] of ROCKS) { const q = ((x - rx) ** 2 + (z - rz) ** 2) / (r * r); if (q < 4) y = Math.max(y, y + Math.exp(-q * 1.4) * r * 1.1); }
  return y;
}
const PATH = [[-11, -27], [-8.5, -21], [-5, -15.5], [-2, -10], [.5, -5], [1.6, 0], [.8, 5], [-1, 9.5], [-.6, 13.5], [1.6, 17.5], [4.2, 22], [6.5, 27]];
let pathCurve, pathLen;
const pathS = [];
function initPath() {
  pathCurve = new THREE.CatmullRomCurve3(PATH.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'catmullrom', .5);
  pathLen = pathCurve.getLength();
  for (let i = 0; i <= 500; i++) { const p = pathCurve.getPointAt(i / 500); pathS.push({ x: p.x, z: p.z, y: rawH(p.x, p.z) }); }
  for (let pass = 0; pass < 7; pass++) {
    const c = pathS.map(s => s.y);
    for (let i = 0; i < c.length; i++) { let a = 0, n = 0; for (let k = -9; k <= 9; k++) { const v = c[i + k]; if (v !== undefined) { a += v; n++; } } pathS[i].y = a / n; }
  }
  pathS.forEach(s => { s.y = Math.max(s.y, .5); });
}
const X0 = -60, X1 = 60, Z0 = -56, Z1 = 44, FW = 360, FH = 300;
const fD = new Float32Array(FW * FH), fY = new Float32Array(FW * FH), fH = new Float32Array(FW * FH);
async function bakeFields() {
  for (let j = 0; j < FH; j++) {
    if (j % 30 === 0) await yieldFrame();
    for (let i = 0; i < FW; i++) {
      const x = X0 + (X1 - X0) * i / (FW - 1), z = Z0 + (Z1 - Z0) * j / (FH - 1);
      let best = 1e9, by = 0;
      for (let k = 0; k < pathS.length; k += 3) { const s = pathS[k], d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < best) { best = d; by = s.y; } }
      const D = Math.sqrt(best), raw = rawH(x, z), k = sstep(3, 1.4, D) * sstep(-.7, -.15, raw);
      fD[j * FW + i] = D; fY[j * FW + i] = by;
      fH[j * FW + i] = raw * (1 - k) + (by - .03) * k;
    }
  }
}
function samp(f, x, z) {
  const u = clamp((x - X0) / (X1 - X0)) * (FW - 1), v = clamp((z - Z0) / (Z1 - Z0)) * (FH - 1);
  const i = Math.min(FW - 2, u | 0), j = Math.min(FH - 2, v | 0), a = u - i, b = v - j;
  return (f[j * FW + i] * (1 - a) + f[j * FW + i + 1] * a) * (1 - b) + (f[(j + 1) * FW + i] * (1 - a) + f[(j + 1) * FW + i + 1] * a) * b;
}
const H = (x, z) => samp(fH, x, z);
const pathD = (x, z) => samp(fD, x, z);
const flowerField = (x, z) => fbm(x * .085 + 11, z * .1 - 4);
const terraceK = (x, z) => { const d = riverZ(x) - z; return sstep(2.6, 4.2, d) * sstep(13.5, 10.5, d); };

const HOUSES = [];
function placeHouses() {
  let side = 1;
  for (let s = pathLen * .17; s < pathLen * .66; s += 3.6 + rnd() * 1.4) {
    const u = s / pathLen, p = pathCurve.getPointAt(u), t = pathCurve.getTangentAt(u);
    const off = 3.1 + rnd() * .9, x = p.x - t.z * side * off, z = p.z + t.x * side * off;
    if (Math.abs(riverZ(x) - z) < 4) { side = -side; continue; }
    HOUSES.push({ x, z, y: H(x, z), rot: Math.atan2(t.x, t.z) + (side > 0 ? -Math.PI / 2 : Math.PI / 2), s: .85 + rnd() * .3 });
    side = -side;
  }
}
const nearHouse = (x, z, r) => HOUSES.some(h => (h.x - x) ** 2 + (h.z - z) ** 2 < r * r);

async function buildTerrain() {
  const [grass, cobble, rock] = await Promise.all(['leafy_grass', 'mossy_cobblestone', 'aerial_rocks_02'].map(n => loadImg(n).then(i => pixels(i, 512, 512))));
  const TW = 960, TH = 800, col = new Uint8Array(TW * TH * 4), cls = new Uint8Array(TW * TH * 4);
  const pick = (t, x, z, m) => { const o = (((fract(z / m) * t.h) | 0) * t.w + ((fract(x / m) * t.w) | 0)) * 4; return [t.d[o], t.d[o + 1], t.d[o + 2]]; };
  for (let j = 0; j < TH; j++) {
    if (j % 40 === 0) await yieldFrame();
    for (let i = 0; i < TW; i++) {
      const x = X0 + (X1 - X0) * i / (TW - 1), z = Z0 + (Z1 - Z0) * j / (TH - 1), y = H(x, z), d = riverZ(x) - z, pd = pathD(x, z);
      const n = fbm(x * .3, z * .3), tk = terraceK(x, z);
      let c, k;
      if (pd < 1.35 && y > .2) { c = pick(cobble, x, z, 2.4); c = [c[0] * .95, c[1] * .95, c[2] * .9]; k = CLS.path; }
      else if (y < .45 + n * .5 && Math.abs(d) < 5) { c = pick(rock, x, z, 6); c = [c[0] * .8, c[1] * .74, c[2] * .62]; k = CLS.rock; }
      else if (tk > .5) {
        const tier = Math.floor(y / .62), v = .8 + .5 * fbm(x * .2 + 3, z * .2);
        c = pick(grass, x, z, 2.2);
        c = tier % 2 ? [c[0] * 1.25 * v, c[1] * 1.15 * v, c[2] * .35 * v] : [c[0] * .7 * v, c[1] * 1.12 * v, c[2] * .4 * v];
        k = CLS.field;
      } else {
        c = pick(grass, x, z, 2.6); const v = .62 + .95 * fbm(x * .16 + 5, z * .16);
        c = [c[0] * .78 * v, c[1] * 1.1 * v, c[2] * .42 * v]; k = CLS.grass;
        if (flowerField(x, z) > .575) c = [c[0] * .85 + 40, c[1] * .85 + 40, c[2] * .85 + 42];
      }
      const o = (j * TW + i) * 4;
      col[o] = Math.min(255, c[0]); col[o + 1] = Math.min(255, c[1]); col[o + 2] = Math.min(255, c[2]); col[o + 3] = 255; cls[o] = k * 16;
    }
  }
  const colTex = new THREE.DataTexture(col, TW, TH, THREE.RGBAFormat);
  colTex.colorSpace = THREE.SRGBColorSpace; colTex.magFilter = THREE.LinearFilter; colTex.minFilter = THREE.LinearMipmapLinearFilter; colTex.generateMipmaps = true; colTex.anisotropy = 4; colTex.needsUpdate = true;
  const clsTex = new THREE.DataTexture(cls, TW, TH, THREE.RGBAFormat); clsTex.magFilter = clsTex.minFilter = THREE.NearestFilter; clsTex.needsUpdate = true;
  const g = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, 420, 350); g.rotateX(-Math.PI / 2); g.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, H(x, z)); uv.setXY(i, (x - X0) / (X1 - X0), (z - Z0) / (Z1 - Z0)); }
  g.computeVertexNormals();
  const m = new THREE.MeshLambertMaterial({ map: colTex });
  m.onBeforeCompile = (s) => {
    s.uniforms.clsTex = { value: clsTex };
    s.fragmentShader = 'uniform sampler2D clsTex;\n' + s.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>\n gl_FragColor.a = texture2D(clsTex, vMapUv).r;`);
  };
  const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.castShadow = true;
  return mesh;
}

function buildRiver() {
  const depth = new Float32Array(FW * FH * 4);
  for (let j = 0; j < FH; j++) for (let i = 0; i < FW; i++) depth[(j * FW + i) * 4] = -fH[j * FW + i];
  const dt = new THREE.DataTexture(depth, FW, FH, THREE.RGBAFormat, THREE.FloatType);
  dt.magFilter = dt.minFilter = THREE.LinearFilter; dt.needsUpdate = true;
  const m = new THREE.ShaderMaterial({
    uniforms: { uD: { value: dt }, uT: time, uB: { value: new THREE.Vector4(X0, Z0, X1 - X0, Z1 - Z0) } },
    vertexShader: `varying vec3 vW; void main(){ vW = (modelMatrix*vec4(position,1.)).xyz; gl_Position = projectionMatrix*viewMatrix*vec4(vW,1.); }`,
    fragmentShader: `
      uniform sampler2D uD; uniform float uT; uniform vec4 uB; varying vec3 vW;
      float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
      float fbm(vec2 p){ return vn(p)*.55+vn(p*2.1+3.1)*.3+vn(p*4.3+7.7)*.15; }
      void main(){
        vec2 uv = (vW.xz-uB.xy)/uB.zw;
        float d = texture2D(uD,uv).r;
        if(d<-.05) discard;
        float n = fbm(vW.xz*.32+vec2(uT*.3,uT*.05));
        float dd = max(d,0.);
        float dist = sqrt(dd);
        float flow = fract((vW.x*.9-uT*1.4+n*2.5)/6.2832);
        float lace = smoothstep(.4,.62,fbm(vW.xz*1.3+vec2(uT*.5,-uT*.05)));
        float range = smoothstep(1.3,.4,dist)*smoothstep(.0,.2,dist);
        float trail = smoothstep(0.,.05,flow)*(1.-smoothstep(.06,.4,flow));
        float foam = trail*range*lace*.8;
        float swash = .12+.08*sin(uT*.9+vW.x*.4+n*4.);
        float rim = smoothstep(swash+.22,swash,dd)*(.35+.5*lace);
        vec3 shallow = vec3(.5,.7,.58), mid = vec3(.1,.46,.5), deep = vec3(.03,.2,.3);
        vec3 c = mix(shallow,mid,smoothstep(.05,.9,dist));
        c = mix(c,deep,smoothstep(.9,1.6,dist));
        c *= .86+.3*vn(vW.xz*vec2(.6,.9)+uT*vec2(.5,.1));
        float sp = smoothstep(.82,.9,vn(vW.xz*vec2(2.4,1.3)+uT*vec2(.9,.2)));
        c += vec3(.45,.5,.45)*sp*smoothstep(.3,1.,dist);
        float cls = 9.;
        float f = max(foam,rim);
        if(f>.3){ c = mix(c,vec3(1.05,1.08,1.04),clamp(f*1.5,0.,1.)); cls = 10.; }
        gl_FragColor = vec4(c,cls/16.);
      }`,
  });
  const g = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0); g.rotateX(-Math.PI / 2); g.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  return new THREE.Mesh(g, m);
}

function bladeWind(s) {
  s.uniforms.uT = time;
  s.vertexShader = 'uniform float uT;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    float ph = instanceMatrix[3].x*.34+instanceMatrix[3].z*.22;
    float gust = sin(uT*.75-ph)*.5+.5;
    transformed.x += (sin(uT*1.6+ph*2.)*.28+gust*.6)*.22*position.y*position.y;`);
}
function leafWind(s) {
  s.uniforms.uT = time;
  s.vertexShader = 'uniform float uT;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    float ph = instanceMatrix[3].x*.9+instanceMatrix[3].z*.7+instanceMatrix[3].y*.8;
    transformed.y += sin(uT*2.1+ph)*.035;
    transformed += vec3(1.,0.,.4)*sin(uT*.8+instanceMatrix[3].x*.22)*.06;`);
}

async function buildGrass(scene) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-.045, 0, 0, .045, 0, 0, .012, .6, 0, -.045, 0, 0, .012, .6, 0, 0, 1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(18).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  const N = 130000, im = new THREE.InstancedMesh(g, tag(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), CLS.grass, bladeWind), N);
  const o = new THREE.Object3D(), c = new THREE.Color();
  let i = 0, guard = 0;
  while (i < N && guard++ < 4e6) {
    if (guard % 250000 === 0) await yieldFrame();
    const x = -36 + rnd() * 72, z = -36 + rnd() * 66, y = H(x, z);
    if (y < .5 || pathD(x, z) < 1.5 || Math.abs(riverZ(x) - z) < 2.2 || nearHouse(x, z, 2.4)) continue;
    const tk = terraceK(x, z);
    o.position.set(x, y - .02, z); o.rotation.y = rnd() * 6.28;
    const s = (.3 + rnd() * .3) * (tk > .5 ? .7 : 1); o.scale.set(1.5, s, 1.5); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
    const v = .55 + rnd() * .75, tone = fbm(x * .16 + 5, z * .16);
    const dk = .55 + 1.1 * tone;
    if (tk > .5 && Math.floor(y / .62) % 2) c.setRGB(.42 * v * dk, .4 * v * dk, .06 * v * dk);
    else c.setRGB((.13 * v + tone * .1) * dk, .4 * v * dk, .05 * v * dk);
    im.setColorAt(i++, c);
  }
  im.count = i; im.receiveShadow = true; scene.add(im);
}
async function buildFlowers(scene) {
  const g = new THREE.PlaneGeometry(.14, .14); g.rotateX(-Math.PI / 2 + .25);
  const N = 40000, im = new THREE.InstancedMesh(g, tag(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), CLS.flower, bladeWind), N);
  const o = new THREE.Object3D(), c = new THREE.Color();
  let i = 0, guard = 0;
  while (i < N && guard++ < 4e6) {
    if (guard % 250000 === 0) await yieldFrame();
    const x = -34 + rnd() * 68, z = -34 + rnd() * 60, y = H(x, z);
    const ff = flowerField(x, z);
    if (ff < .565 + rnd() * .05 || y < .8 || pathD(x, z) < 2 || terraceK(x, z) > .3 || Math.abs(riverZ(x) - z) < 3 || nearHouse(x, z, 2.6)) continue;
    if (fbm(x * .9, z * .9) < .47) continue;
    o.position.set(x, y + .2 + rnd() * .16, z); o.rotation.y = rnd() * 6.28; o.scale.setScalar(.8 + rnd() * .9); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
    const r = rnd(); c.setRGB(.9 + r * .05, r < .35 ? .5 : .85, r < .35 ? .3 : .8); im.setColorAt(i++, c);
  }
  im.count = i; im.receiveShadow = true; scene.add(im);
}

async function buildTrees(scene, barkTex) {
  const spots = [];
  const push = (x, z, s, kind) => spots.push({ x, z, s, kind });
  let guard = 0;
  while (spots.length < 120 && guard++ < 12000) {
    const x = -36 + rnd() * 72, z = -40 + rnd() * 26;
    if (pathD(x, z) < 4.5 || spots.some(s => (s.x - x) ** 2 + (s.z - z) ** 2 < 7) || nearHouse(x, z, 4)) continue;
    push(x, z, .8 + rnd() * .5, rnd() < .06 ? 'red' : rnd() < .72 ? 'green' : 'gold');
  }
  guard = 0;
  while (spots.length < 150 && guard++ < 12000) {
    const x = -36 + rnd() * 72, z = -14 + rnd() * 42;
    if (pathD(x, z) < 5 || Math.abs(riverZ(x) - z) < 3.5 || terraceK(x, z) > .3 || spots.some(s => (s.x - x) ** 2 + (s.z - z) ** 2 < 14) || nearHouse(x, z, 4.2)) continue;
    push(x, z, .7 + rnd() * .5, rnd() < .1 ? 'red' : rnd() < .6 ? 'green' : 'gold');
  }
  const leaves = [], pal = {
    gold: [[.98, .68, .1], [.86, .52, .05], [1, .78, .2], [.7, .55, .1], [.6, .5, .14]],
    red: [[.82, .1, .04], [.95, .2, .05], [.6, .05, .04], [1, .35, .1]],
    green: [[.2, .42, .1], [.3, .5, .12], [.14, .3, .09], [.45, .55, .15]],
  };
  const trunks = [];
  for (const [ti, t] of spots.entries()) {
    if (ti % 30 === 29) await yieldFrame();
    const y0 = H(t.x, t.z), H0 = 5.3 * t.s;
    const tg = new THREE.CylinderGeometry(.09 * t.s, .22 * t.s, H0, 7); tg.translate(t.x, y0 + H0 / 2, t.z);
    trunks.push(tg);
    for (let b = 0; b < 3; b++) { const a = rnd() * 6.28; const bg = new THREE.CylinderGeometry(.03 * t.s, .08 * t.s, 2.2 * t.s, 5); bg.rotateZ(.8); bg.rotateY(a); bg.translate(t.x + Math.cos(a) * .6 * t.s, y0 + H0 * .72, t.z - Math.sin(a) * .6 * t.s); trunks.push(bg); }
    for (let l = 0; l < 10; l++) {
      const a = rnd() * 6.28, r = rnd() ** .6 * 2.5 * t.s, lx = t.x + Math.cos(a) * r, lz = t.z + Math.sin(a) * r, ly = y0 + H0 * .8 + (rnd() - .35) * 1.8 * t.s + (1 - r / (2.6 * t.s)) * 1.3 * t.s;
      const lr = (.75 + rnd() * .55) * t.s, n = 120;
      for (let i = 0; i < n; i++) {
        const u = rnd() * 2 - 1, th = rnd() * 6.28, q = Math.sqrt(1 - u * u), rr = lr * Math.cbrt(rnd());
        const p = pal[t.kind][(rnd() * pal[t.kind].length) | 0], lit = .72 + .6 * clamp(u * .5 + .5);
        leaves.push(lx + q * Math.cos(th) * rr, ly + u * rr * .75, lz + q * Math.sin(th) * rr, p[0] * lit, p[1] * lit, p[2] * lit);
      }
    }
  }
  const barkMat = tag(new THREE.MeshLambertMaterial({ map: barkTex, color: '#e8dfd2' }), CLS.wood);
  const trunk = new THREE.Mesh(mergeGeometries(trunks), barkMat); trunk.castShadow = true; scene.add(trunk);
  const g = new THREE.PlaneGeometry(.3, .24);
  const count = leaves.length / 6, im = new THREE.InstancedMesh(g, tag(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), CLS.leaf, leafWind), count);
  const o = new THREE.Object3D(), c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    if (i % 40000 === 39999) await yieldFrame();
    o.position.set(leaves[i * 6], leaves[i * 6 + 1], leaves[i * 6 + 2]); o.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
    c.setRGB(leaves[i * 6 + 3], leaves[i * 6 + 4], leaves[i * 6 + 5]); im.setColorAt(i, c);
  }
  im.castShadow = true; im.receiveShadow = true; scene.add(im);
}

function buildHouses(scene) {
  const n = HOUSES.length;
  const wallGeo = mergeGeometries([new THREE.BoxGeometry(2.8, 1.6, 2.2).translate(0, .8, 0), new THREE.BoxGeometry(3, 1.2, 2.4).translate(0, -.5, 0)]);
  const wallMat = tag(new THREE.MeshLambertMaterial({ map: tex('clay_plaster', 1, 1), color: '#f1e3c6' }), CLS.wall);
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, n);
  const shape = new THREE.Shape(); shape.moveTo(-1.75, 0); shape.lineTo(1.75, 0); shape.lineTo(0, 1.05); shape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: 2.9, bevelEnabled: false });
  roofGeo.translate(0, 1.52, -1.45);
  const ridge = new THREE.BoxGeometry(.16, .14, 3.1).translate(0, 2.58, 0).toNonIndexed();
  const roofAll = mergeGeometries([roofGeo, ridge]);
  const roofMat = tag(new THREE.MeshLambertMaterial({ map: tex('clay_roof_tiles_02', .45, .45), color: '#ff4a2a', emissive: '#5a1206', emissiveIntensity: .45, side: THREE.DoubleSide }), CLS.roof);
  const roofs = new THREE.InstancedMesh(roofAll, roofMat, n);
  const o = new THREE.Object3D();
  HOUSES.forEach((h, i) => {
    o.position.set(h.x, h.y - .05, h.z); o.rotation.set(0, h.rot, 0); o.scale.setScalar(h.s); o.updateMatrix();
    walls.setMatrixAt(i, o.matrix); roofs.setMatrixAt(i, o.matrix);
  });
  walls.castShadow = walls.receiveShadow = roofs.castShadow = roofs.receiveShadow = true;
  scene.add(walls, roofs);
}
function buildPosts(scene) {
  const g = new THREE.BoxGeometry(.13, .95, .13).translate(0, .45, 0);
  const n = Math.floor(pathLen / 1.5), im = new THREE.InstancedMesh(g, tag(new THREE.MeshLambertMaterial({ color: '#b08a5c' }), CLS.wood), n * 2), o = new THREE.Object3D();
  let c = 0;
  for (let i = 0; i < n; i++) {
    const u = (i + .5) / n, p = pathCurve.getPointAt(u), t = pathCurve.getTangentAt(u);
    if (u < .08 || u > .92) continue;
    for (const s of [-1, 1]) {
      const x = p.x - t.z * s * 1.95, z = p.z + t.x * s * 1.95, y = H(x, z);
      if (y < .3) continue;
      o.position.set(x, y - .05, z); o.rotation.y = rnd() * .3; o.scale.setScalar(.9 + rnd() * .3); o.updateMatrix(); im.setMatrixAt(c++, o.matrix);
    }
  }
  im.count = c; im.castShadow = true; scene.add(im);
}
function buildBridge(scene) {
  let a = -1, b = -1;
  pathS.forEach((s, i) => { if (rawH(s.x, s.z) < .05) { if (a < 0) a = i; b = i; } });
  if (a < 0) return;
  const A = pathS[Math.max(0, a - 8)], B = pathS[Math.min(pathS.length - 1, b + 8)];
  const dx = B.x - A.x, dz = B.z - A.z, len = Math.hypot(dx, dz), ang = Math.atan2(dx, dz);
  const g = new THREE.Group();
  const wood = tag(new THREE.MeshLambertMaterial({ color: '#8a6238' }), CLS.wood);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.3, .2, len), wood); deck.position.y = .5; g.add(deck);
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(.1, .08, len), wood); rail.position.set(s * 1.05, 1.1, 0); g.add(rail);
    for (let k = -len / 2 + .4; k < len / 2; k += 1.2) { const p = new THREE.Mesh(new THREE.BoxGeometry(.1, .7, .1), wood); p.position.set(s * 1.05, .85, k); g.add(p); }
  }
  g.position.set((A.x + B.x) / 2, 0, (A.z + B.z) / 2); g.rotation.y = ang;
  g.traverse(m => { m.castShadow = m.receiveShadow = true; }); scene.add(g);
}
function buildRocks(scene) {
  const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i), k = .72 + fbm(v.x * 1.7 + 4, v.y * 1.7 + v.z) * .6; p.setXYZ(i, v.x * k, v.y * k * .7, v.z * k); }
  g.scale(1, .62, 1); g.computeVertexNormals();
  const im = new THREE.InstancedMesh(g, tag(new THREE.MeshLambertMaterial({ map: tex('aerial_rocks_02', 1.5, 1.5), color: new THREE.Color(.72, .76, .8) }), CLS.rock), ROCKS.length), o = new THREE.Object3D();
  ROCKS.forEach(([x, z, r], i) => { o.position.set(x, Math.max(H(x, z), 0) + r * .1, z); o.rotation.y = rnd() * 6; o.scale.setScalar(r * .95); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
  im.castShadow = true; im.receiveShadow = true; scene.add(im);
}
function buildFigure(scene) {
  const g = new THREE.Group();
  const mat = (c) => tag(new THREE.MeshBasicMaterial({ color: new THREE.Color(c) }), CLS.figure);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(.16, .5, .16), mat(0x2a2e5a)); legL.position.set(-.12, .25, 0);
  const legR = legL.clone(); legR.position.x = .12;
  const body = new THREE.Mesh(new THREE.BoxGeometry(.44, .55, .3), mat(0x3b4fb0)); body.position.y = .78;
  const head = new THREE.Mesh(new THREE.SphereGeometry(.15, 8, 6), mat(0xe8b58a)); head.position.y = 1.2;
  const hat = new THREE.Mesh(new THREE.ConeGeometry(.42, .26, 10), mat(0xf5e2a8)); hat.position.y = 1.34;
  g.add(legL, legR, body, head, hat);
  g.traverse(m => { m.castShadow = true; });
  scene.add(g);
  return { g, legL, legR };
}

const GLYPHS = " .'`,:;-~=+*oOsS$%&8#@/\\|_^v\u2014";
const GI = Object.fromEntries([...GLYPHS].map((c, i) => [c, i]));
const gg = (c) => GI[c].toFixed(1);
function buildAtlas() {
  const tw = 64, th = 120, c = document.createElement('canvas');
  c.width = tw * GLYPHS.length; c.height = th;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = 'bold 100px "JetBrains Mono", Menlo, Consolas, monospace';
  [...GLYPHS].forEach((ch, i) => { if (ch === '\u2014') x.fillRect(i * tw, th * .44, tw, th * .12); else x.fillText(ch, (i + .5) * tw, th * .52); });
  const t = new THREE.CanvasTexture(c); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4; t.flipY = false;
  return t;
}
const asciiFrag = `
precision highp float;
uniform sampler2D uScene, uAtlas; uniform vec2 uGrid; uniform float uTime, uN;
in vec2 vUv; out vec4 outColor;
float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
float lum(vec3 c){ return dot(c,vec3(.25,.6,.15)); }
vec3 grade(vec3 c){
  c = max(c,0.); c = c/(1.+c*.12); c = pow(c,vec3(1./2.2));
  c = mix(c,c*c*(3.-2.*c),.5);
  float l = lum(c); c = mix(vec3(l),c,1.22);
  return clamp(c,0.,1.);
}
void main(){
  vec2 g = vUv*uGrid, cell = floor(g), cuv = (cell+.5)/uGrid;
  ivec2 sz = textureSize(uScene,0);
  float lodC = log2(float(sz.x)/uGrid.x)+.05;
  vec3 col = grade(textureLod(uScene,cuv,lodC).rgb);
  float cls = floor(texelFetch(uScene,ivec2(cuv*vec2(sz)),0).a*16.+.5);
  float L = lum(col);
  vec2 e = 1./uGrid;
  float lx0=lum(grade(textureLod(uScene,cuv-vec2(e.x,0),lodC).rgb)), lx1=lum(grade(textureLod(uScene,cuv+vec2(e.x,0),lodC).rgb));
  float ly0=lum(grade(textureLod(uScene,cuv-vec2(0,e.y),lodC).rgb)), ly1=lum(grade(textureLod(uScene,cuv+vec2(0,e.y),lodC).rgb));
  vec2 grad = vec2(lx1-lx0,(ly1-ly0)*.55); float mag = length(grad);
  float a4 = mod(atan(grad.y,grad.x)+.3927,3.14159)/.7854;
  float edgeG = a4<1.?${gg('|')}:a4<2.?${gg('\\')}:a4<3.?${gg('\u2014')}:${gg('/')};
  float w = vn(cell*vec2(.05,.09)+vec2(-uTime*.28,uTime*.07))*2.-1.;
  float gl = ${gg('.')};
  if(cls<1.5){
    gl = L<.1?${gg('.')}:L<.17?${gg(':')}:(w<-.2?${gg('\\')}:w>.2?${gg('/')}:${gg('|')});
  } else if(cls<2.5){
    gl = L<.12?${gg('.')}:L<.24?${gg(':')}:L<.38?${gg('*')}:L<.5?${gg('+')}:${gg('o')};
  } else if(cls<3.5){
    gl = L<.34?${gg(':')}:L<.55?${gg('*')}:L<.76?${gg('%')}:${gg('#')};
  } else if(cls<4.5){
    gl = L<.22?${gg(':')}:L<.42?${gg('%')}:${gg('#')};
    if(mag>.16) gl = edgeG;
  } else if(cls<5.5){
    gl = L<.12?${gg(':')}:L<.24?${gg('=')}:L<.5?${gg('\u2014')}:${gg('#')};
  } else if(cls<6.5){
    gl = L<.14?${gg(':')}:L<.4?${gg('=')}:${gg('\u2014')};
    if(mag>.24) gl = edgeG;
  } else if(cls<7.5){
    gl = L<.2?${gg(':')}:L<.5?${gg('%')}:${gg('#')};
    if(mag>.2) gl = edgeG;
  } else if(cls<8.5){
    gl = L<.14?${gg('.')}:L<.3?${gg(':')}:L<.5?${gg(';')}:(w>.1?${gg('~')}:${gg('=')});
  } else if(cls<9.5){
    gl = L<.22?${gg('-')}:L<.45?(w>0.?${gg('~')}:${gg('-')}):L<.72?${gg('~')}:${gg('=')};
  } else if(cls<10.5){
    gl = L<.6?${gg('*')}:L<.82?${gg('%')}:${gg('#')};
  } else if(cls<11.5){
    gl = L<.4?${gg('&')}:${gg('$')};
  } else if(cls<12.5){
    gl = L<.14?${gg(':')}:(mag>.1?edgeG:(L<.34?${gg('|')}:${gg('#')}));
  } else {
    gl = L<.12?${gg('.')}:L<.26?${gg(':')}:L<.42?${gg('%')}:${gg('#')};
    if(mag>.2) gl = edgeG;
  }
  vec2 gv = g-cell, dx = dFdx(g), dy = dFdy(g);
  float ink = smoothstep(.12,.78,textureGrad(uAtlas,vec2((gl+gv.x)/uN,1.-gv.y),dx/uN,dy).r);
  vec3 blur = grade(textureLod(uScene,vUv,lodC+1.2).rgb);
  outColor = vec4(mix(blur*.45,col*1.32+.012,ink),mix(.08,1.,ink));
}`;
const tiltFrag = `
precision highp float;
uniform sampler2D uA; uniform vec2 uRes;
in vec2 vUv; out vec4 outColor;
void main(){
  float dy = abs(vUv.y-.45);
  float r = pow(smoothstep(.28,.6,dy),1.6)*12.;
  vec4 c = vec4(0.);
  if(r<.2){ outColor = texture(uA,vUv); return; }
  float lod = max(log2(r/4.),0.);
  for(int i=0;i<24;i++){
    float t = float(i)+.5, a = t*2.39996, rr = sqrt(t/24.)*r;
    vec2 o = vec2(cos(a),sin(a))*rr/uRes;
    c += textureLod(uA,vUv+o,lod);
  }
  outColor = c/24.;
}`;

async function main() {
  const canvas = document.getElementById('diorama');
  if (!canvas || !canvas.getContext('webgl2') || !window.__dioramaTex) return;
  THREE = await import('three');
  ({ mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js'));
  initPath();
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches || innerWidth < 720;
  const size = () => {
    const w = Math.min(1600, document.documentElement.clientWidth), h = Math.min(1000, document.documentElement.clientHeight);
    return { w, h, cols: clamp(Math.round(w / 7.5), 48, 220), rows: clamp(Math.round(h / 15), 40, 110) };
  };
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, premultipliedAlpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight('#ffe7c4', 3.2); sun.position.set(-30, 44, 24); sun.target.position.set(0, 3, 0);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 5, far: 140 });
  sun.shadow.bias = -.0005; sun.shadow.normalBias = .03;
  scene.add(sun, sun.target, new THREE.HemisphereLight('#efe6d8', '#6d6236', 1.0));

  await bakeFields();
  placeHouses();
  scene.add(await buildTerrain(), buildRiver());
  await buildGrass(scene); await buildFlowers(scene);
  await buildTrees(scene, tex('bark_brown_02', 1, 2));
  buildHouses(scene); buildPosts(scene); buildBridge(scene); buildRocks(scene);
  const fig = buildFigure(scene);

  const petals = new THREE.InstancedMesh(new THREE.PlaneGeometry(.09, .09), tag(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.3, 1.1), side: THREE.DoubleSide }), CLS.flower), 110);
  scene.add(petals);
  const petalS = Array.from({ length: 110 }, () => [rnd(), rnd(), rnd(), rnd()]);

  const camera = new THREE.PerspectiveCamera(23, 1, 5, 400);
  const TARGET = new THREE.Vector3(0, 3.5, 0);
  function placeCamera(t) {
    const k = .5 - .5 * Math.cos(Math.PI * t / DURATION), az = THREE.MathUtils.degToRad(-7 + 14 * k), el = THREE.MathUtils.degToRad(54 + 1.4 * Math.sin(k * 3.14)), R = 98 - 3 * k;
    camera.position.set(TARGET.x + Math.sin(az) * Math.cos(el) * R, TARGET.y + Math.sin(el) * R, TARGET.z + Math.cos(az) * Math.cos(el) * R);
    camera.lookAt(TARGET); camera.updateMatrixWorld();
  }

  await document.fonts.ready;
  let S = size();
  const rt = new THREE.WebGLRenderTarget(S.w, S.h, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  const art = new THREE.WebGLRenderTarget(S.w, S.h, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  const vtx = `in vec3 position; in vec2 uv; out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }`;
  const ascii = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vtx, fragmentShader: asciiFrag, depthTest: false, depthWrite: false, transparent: false,
    uniforms: { uScene: { value: rt.texture }, uAtlas: { value: buildAtlas() }, uGrid: { value: new THREE.Vector2(S.cols, S.rows) }, uTime: time, uN: { value: GLYPHS.length } } });
  const tilt = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vtx, fragmentShader: tiltFrag, depthTest: false, depthWrite: false, transparent: false,
    uniforms: { uA: { value: art.texture }, uRes: { value: new THREE.Vector2(S.w, S.h) } } });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ascii); quad.frustumCulled = false;
  const post = new THREE.Scene(); post.add(quad); const postCam = new THREE.Camera();

  const fit = () => {
    S = size();
    renderer.setSize(S.w, S.h, false);
    rt.setSize(S.w, S.h); art.setSize(S.w, S.h);
    camera.aspect = S.w / S.h;
    camera.fov = Math.min(60, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(11.5)) * Math.max(1, 1.5 / camera.aspect))));
    camera.updateProjectionMatrix();
    ascii.uniforms.uGrid.value.set(S.cols, S.rows); tilt.uniforms.uRes.value.set(S.w, S.h);
  };
  fit();
  await renderer.compileAsync(scene, camera);
  await yieldFrame();

  const dummy = new THREE.Object3D(), SPEED = .7, U0 = .14, U1 = .72;
  function drawFrame(t) {
    time.value = t; placeCamera(t);
    const span = (U1 - U0) * pathLen, ph = (t * SPEED) % (span * 2), fwd = ph < span, s = fwd ? ph : span * 2 - ph;
    const u = U0 + s / pathLen, p = pathCurve.getPointAt(u), tg = pathCurve.getTangentAt(u);
    fig.g.position.set(p.x, samp(fY, p.x, p.z) + .02, p.z); fig.g.rotation.y = Math.atan2(tg.x, tg.z) + (fwd ? 0 : Math.PI);
    const sw = Math.sin(t * 7) * .5; fig.legL.rotation.x = sw; fig.legR.rotation.x = -sw;
    fig.g.position.y += Math.abs(Math.sin(t * 7)) * .04;
    petalS.forEach((s, i) => {
      const k = fract(s[0] + t * (.016 + s[3] * .012));
      const x = -24 + k * 48 + Math.sin(t * .6 + s[1] * 9) * .5, z = -26 + s[2] * 44;
      dummy.position.set(x, H(x, z) + 1.2 + s[1] * 5 + Math.sin(t * .9 + s[3] * 12) * .35, z);
      dummy.rotation.set(t + s[0] * 9, t * .7, s[1]); dummy.scale.setScalar(.8 + s[3] * .8); dummy.updateMatrix(); petals.setMatrixAt(i, dummy.matrix);
    });
    petals.instanceMatrix.needsUpdate = true;
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, camera);
    quad.material = ascii; renderer.setRenderTarget(art); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(post, postCam);
    quad.material = tilt; renderer.setRenderTarget(null); renderer.clear(); renderer.render(post, postCam);
  }

  const swarmBusy = () => { const s = window.__swarmRebuild; return !!(s && s.app && !s.app.dead); };
  let clock = 0, last = performance.now(), lastDraw = 0, resizeTimer = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { fit(); if (still) drawFrame(clock); }, 300);
  });
  drawFrame(0);
  canvas.classList.add('ready');
  if (still) return;
  const loop = (now) => {
    requestAnimationFrame(loop);
    if (document.hidden || swarmBusy()) { last = now; return; }
    if (now - lastDraw < 32) return;
    clock += Math.min(.1, (now - last) / 1000);
    last = now; lastDraw = now;
    drawFrame(clock);
  };
  requestAnimationFrame(loop);
}

const boot = () => setTimeout(() => main().catch(() => {}), 500);
if (document.readyState === 'complete') boot(); else addEventListener('load', boot, { once: true });
})();
