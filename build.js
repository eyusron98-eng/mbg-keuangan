// Build: src/index.html (sumber: JSX + Tailwind CDN, bisa dibuka langsung untuk pengembangan)
//     → index.html (yang dipakai pengguna): JSX sudah diterjemahkan dan CSS Tailwind sudah jadi,
//       sehingga browser tidak lagi mengunduh Babel (~600 KB gzip) dan Tailwind CDN, dan tidak menerjemahkan kode di HP.
// Jalankan: npm install && npm run build
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Babel = require('@babel/standalone');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src', 'index.html');
const OUT = path.join(ROOT, 'index.html');
const TAILWIND_TAG = '<script src="https://cdn.tailwindcss.com"></script>\n';
const BABEL_TAG = '<script src="https://unpkg.com/@babel/standalone@7.24.0/babel.min.js"></script>\n';

function ganti(teks, cari, isi) {
  const n = teks.split(cari).length - 1;
  if (n !== 1) throw new Error('Build gagal: penanda "' + cari.trim().slice(0, 60) + '" ditemukan ' + n + 'x (harus 1x) di src/index.html');
  return teks.replace(cari, function () { return isi; });
}

const src = fs.readFileSync(SRC, 'utf8');

// 1. CSS Tailwind dari kelas yang dipakai di sumber
const cssFile = path.join(os.tmpdir(), 'mbg-tailwind-' + process.pid + '.css');
execFileSync(path.join(ROOT, 'node_modules', '.bin', 'tailwindcss'),
  ['-c', 'tailwind.config.js', '-i', 'src/tailwind.css', '-o', cssFile, '--minify'], { cwd: ROOT, stdio: 'pipe' });
const css = fs.readFileSync(cssFile, 'utf8');
fs.unlinkSync(cssFile);

// 2. JSX → JavaScript biasa (hanya preset react; sintaks modern lainnya dibiarkan)
const m = src.match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/);
if (!m) throw new Error('Build gagal: <script type="text/babel"> tidak ditemukan');
const js = Babel.transform(m[1], { presets: ['react'], sourceType: 'script', comments: false }).code;
if (/<\/script/i.test(js)) throw new Error('Build gagal: hasil JavaScript memuat "</script"');

// 3. Rakit index.html
let out = src;
out = ganti(out, '<!DOCTYPE html>\n', '<!DOCTYPE html>\n<!-- FILE HASIL BUILD — jangan diedit langsung. Ubah src/index.html lalu jalankan: npm run build -->\n');
out = ganti(out, TAILWIND_TAG, '<link rel="preconnect" href="https://unpkg.com" crossorigin>\n');
out = ganti(out, BABEL_TAG, '');
out = ganti(out, m[0], '<script>\n' + js + '\n</script>');
out = ganti(out, '</head>', '<style id="tailwind">' + css + '</style>\n</head>');
if (/text\/babel|cdn\.tailwindcss\.com|babel\.min\.js/.test(out)) throw new Error('Build gagal: sisa Babel/Tailwind CDN masih ada');

fs.writeFileSync(OUT, out);
console.log('index.html dibangun: ' + Math.round(out.length / 1024) + ' KB (JS ' + Math.round(js.length / 1024) + ' KB, CSS ' + Math.round(css.length / 1024) + ' KB)');
