/**
 * Собирает иконки Windows из одного исходника — build/icon.png.
 *
 * Зачем это нужно. В .ico кладут не одну картинку, а набор размеров: 256 px для
 * крупной плитки, 16 px для списка в проводнике. Если размер один, Windows
 * ужимает его сама и мелкие иконки мылятся. Здесь каждый размер уменьшается
 * усреднением по площади с учётом альфы — края остаются чистыми.
 *
 * На выходе:
 *   build/icon.ico       иконка приложения (exe, установщик, ярлык, окно)
 *   build/file-icon.ico   иконка файлов .bgproj
 *
 * Исходник build/icon.png не перезаписывается никогда — это ваша картинка.
 * Всё делается без внешних пакетов и без сети.
 *
 * Запуск: npm run icon
 */
import { deflateSync, inflateSync } from "node:zlib";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "build", "icon.png");
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/* ------------------------------------------------------------------ */
/* Чтение PNG                                                          */
/* ------------------------------------------------------------------ */

/** @returns {{width: number, height: number, data: Uint8ClampedArray}} RGBA */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("это не PNG");

  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  if (depth !== 8) throw new Error(`поддерживается только 8 бит на канал (в файле ${depth})`);
  if (interlace !== 0) throw new Error("чересстрочный PNG не поддерживается — пересохраните без interlace");
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`тип цвета ${colorType} не поддерживается (нужен RGB, RGBA или серый)`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);

  // Каждая строка PNG закодирована одним из пяти фильтров — разворачиваем.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const line = pixels.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prior ? prior[x] : 0;
      const c = prior && x >= channels ? prior[x - channels] : 0;
      let value = src[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = value & 0xff;
    }
  }

  // Приводим к RGBA независимо от исходного типа цвета.
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const s = i * channels;
    const d = i * 4;
    if (channels >= 3) {
      data[d] = pixels[s]; data[d + 1] = pixels[s + 1]; data[d + 2] = pixels[s + 2];
      data[d + 3] = channels === 4 ? pixels[s + 3] : 255;
    } else {
      data[d] = data[d + 1] = data[d + 2] = pixels[s];
      data[d + 3] = channels === 2 ? pixels[s + 1] : 255;
    }
  }
  return { width, height, data };
}

/* ------------------------------------------------------------------ */
/* Масштабирование                                                     */
/* ------------------------------------------------------------------ */

/**
 * Уменьшение усреднением по площади. Цвет складывается домноженным на альфу:
 * иначе прозрачные пиксели по краям затянули бы контур своим цветом.
 */
function resize(img, size) {
  const out = new Uint8ClampedArray(size * size * 4);
  const fx = img.width / size;
  const fy = img.height / size;
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * fy);
    const y1 = Math.max(y0 + 1, Math.ceil((y + 1) * fy));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * fx);
      const x1 = Math.max(x0 + 1, Math.ceil((x + 1) * fx));
      let r = 0, g = 0, b = 0, alpha = 0, count = 0;
      for (let sy = y0; sy < y1 && sy < img.height; sy++) {
        for (let sx = x0; sx < x1 && sx < img.width; sx++) {
          const i = (sy * img.width + sx) * 4;
          const a = img.data[i + 3] / 255;
          r += img.data[i] * a; g += img.data[i + 1] * a; b += img.data[i + 2] * a;
          alpha += a;
          count++;
        }
      }
      const d = (y * size + x) * 4;
      out[d] = alpha > 0 ? r / alpha : 0;
      out[d + 1] = alpha > 0 ? g / alpha : 0;
      out[d + 2] = alpha > 0 ? b / alpha : 0;
      out[d + 3] = (alpha / count) * 255;
    }
  }
  return { size, data: out };
}

/* ------------------------------------------------------------------ */
/* Запись PNG и ICO                                                    */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

function encodePng({ size, data }) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // фильтр строки: None
    Buffer.from(data.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 32-битный BMP-кадр: BGRA снизу вверх плюс пустая AND-маска. */
function encodeIcoBmp({ size, data }) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR и AND маски вместе
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14); // с альфа-каналом
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = ((size - 1 - y) * size + x) * 4;
      const d = (y * size + x) * 4;
      pixels[d] = data[s + 2];
      pixels[d + 1] = data[s + 1];
      pixels[d + 2] = data[s];
      pixels[d + 3] = data[s + 3];
    }
  }
  const maskRow = Math.ceil(size / 8 / 4) * 4;
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]);
}

function buildIco(frames) {
  const encoded = frames.map((frame) => ({
    size: frame.size,
    // 256 px принято хранить сжатым в PNG, меньшие размеры — в BMP.
    body: frame.size >= 256 ? encodePng(frame) : encodeIcoBmp(frame),
  }));
  const dir = Buffer.alloc(6 + 16 * encoded.length);
  dir.writeUInt16LE(1, 2); // тип: иконка
  dir.writeUInt16LE(encoded.length, 4);
  let offset = dir.length;
  encoded.forEach((frame, i) => {
    const p = 6 + i * 16;
    dir[p] = frame.size >= 256 ? 0 : frame.size; // 0 означает 256
    dir[p + 1] = frame.size >= 256 ? 0 : frame.size;
    dir.writeUInt16LE(1, p + 4);
    dir.writeUInt16LE(32, p + 6);
    dir.writeUInt32LE(frame.body.length, p + 8);
    dir.writeUInt32LE(offset, p + 12);
    offset += frame.body.length;
  });
  return Buffer.concat([dir, ...encoded.map((f) => f.body)]);
}

/* ------------------------------------------------------------------ */

if (!existsSync(SOURCE)) {
  // Не роняем npm install: без иконки соберётся всё, кроме установщика.
  console.warn(`[icon] нет ${SOURCE} — иконки не пересобраны`);
  process.exit(0);
}

const source = decodePng(readFileSync(SOURCE));
if (source.width !== source.height) {
  console.warn(`[icon] исходник не квадратный (${source.width}×${source.height}) — иконка может исказиться`);
}

const frames = ICO_SIZES.map((size) => resize(source, size));
const ico = buildIco(frames);

writeFileSync(join(ROOT, "build", "icon.ico"), ico);
// Файлы проекта носят ту же марку, что и приложение.
writeFileSync(join(ROOT, "build", "file-icon.ico"), ico);

// Тот же знак нужен внутри приложения: на заставке и в шапке списка проектов.
// Держим их файлами, а не генерируем на лету, чтобы `npm run dev` работал
// без предварительной сборки иконок.
const byName = new Map(frames.map((f) => [f.size, f]));
writeFileSync(join(ROOT, "electron", "app-icon.png"), encodePng(byName.get(128)));
writeFileSync(join(ROOT, "frontend", "src", "assets", "logo.png"), encodePng(byName.get(256)));

console.log(`[icon] из ${source.width}×${source.height}: build/icon.ico, build/file-icon.ico `
  + `(${ICO_SIZES.join(", ")} px, 32 бита с альфой), electron/app-icon.png, frontend/src/assets/logo.png`);
