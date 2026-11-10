"""
Иконки и заставка Android из одного исходника — build/icon.png.

Что делает:
  * адаптивная иконка (Android 8+): самоцвет на переднем слое, тёмно-синий фон
    отдельным цветом — система сама вырезает круг, сквиркл или квадрат;
  * обычная и круглая иконки для старых лаунчеров;
  * заставка запуска: самоцвет по центру на фоне приложения.

Запуск (нужен Pillow):  python3 scripts/make-android-icons.py
Готовые PNG лежат в репозитории, так что для обычной сборки скрипт не нужен —
только если поменяли build/icon.png.
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "build" / "icon.png"
RES = ROOT / "frontend" / "android" / "app" / "src" / "main" / "res"

ICON_BG = (3, 14, 34)        # тон фона самого значка (#030E22)
APP_BG = (10, 10, 15)        # фон приложения (#0A0A0F)

DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def gem_tile(size: int) -> Image.Image:
    """Внутренний квадрат значка без скруглённых углов, с мягко растворённым
    краем — на любом фоне того же тона шва не видно."""
    icon = Image.open(SRC).convert("RGBA")
    w = icon.width
    inset = int(w * 0.09)
    tile = icon.crop((inset, inset, w - inset, w - inset)).resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    pad = int(size * 0.07)
    ImageDraw.Draw(mask).ellipse((pad, pad, size - pad, size - pad), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(size * 0.07))
    tile.putalpha(ImageChops.multiply(tile.getchannel("A"), mask))
    return tile


def foreground(px: int) -> Image.Image:
    # 108dp холст, безопасная зона — круг 66dp: самоцвет держим внутри неё.
    canvas = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    tile = gem_tile(int(px * 0.78))
    off = (px - tile.width) // 2
    canvas.alpha_composite(tile, (off, off))
    return canvas


def legacy(px: int, round_mask: bool) -> Image.Image:
    full = Image.new("RGBA", (px * 4, px * 4), ICON_BG + (255,))
    fg = foreground(px * 4)
    full.alpha_composite(fg)
    mask = Image.new("L", full.size, 0)
    d = ImageDraw.Draw(mask)
    if round_mask:
        d.ellipse((0, 0, full.width - 1, full.height - 1), fill=255)
    else:
        d.rounded_rectangle((0, 0, full.width - 1, full.height - 1), radius=int(full.width * 0.22), fill=255)
    full.putalpha(mask)
    return full.resize((px, px), Image.LANCZOS)


def splash(w: int, h: int) -> Image.Image:
    img = Image.new("RGBA", (w, h), APP_BG + (255,))
    side = int(min(w, h) * 0.34)
    tile = gem_tile(side)
    img.alpha_composite(tile, ((w - side) // 2, (h - side) // 2))
    return img.convert("RGB")


def main():
    for name, k in DENSITIES.items():
        folder = RES / f"mipmap-{name}"
        folder.mkdir(parents=True, exist_ok=True)
        foreground(round(108 * k)).save(folder / "ic_launcher_foreground.png", optimize=True)
        legacy(round(48 * k), False).save(folder / "ic_launcher.png", optimize=True)
        legacy(round(48 * k), True).save(folder / "ic_launcher_round.png", optimize=True)

    for path in RES.glob("drawable*/splash.png"):
        w, h = Image.open(path).size
        splash(w, h).save(path, optimize=True)

    (RES / "values" / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        '    <color name="ic_launcher_background">#030E22</color>\n</resources>\n',
        encoding="utf-8",
    )
    print("android icons and splash written to", RES)


if __name__ == "__main__":
    main()
