"""python3 -m gen.icon — draws the Android app icon: "RQ" in white on the brand primary
(primarySolid in lib/ds/tokens.g.dart), in Inter ExtraBold. Writes the legacy and round
icons for Android 7 and the adaptive layers (foreground, monochrome; the background is a
colour) at every density. Needs Pillow (pip install pillow); the PNGs are committed."""
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .spec import ROOT

RES = ROOT / "android/app/src/main/res"
FONT = ROOT / "assets/fonts/Inter-ExtraBold.ttf"
TEXT = "RQ"
DENSITY = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
SS = 4  # drawn this many times larger, then scaled down: smooth edges


def primary() -> str:
    tokens = (ROOT / "lib/ds/tokens.g.dart").read_text()
    m = re.search(r"primarySolid: Color\(0xFF([0-9A-Fa-f]{6})\)", tokens)
    if not m:
        raise SystemExit("primarySolid not found in lib/ds/tokens.g.dart")
    return "#" + m.group(1).upper()


def letters(draw: ImageDraw.ImageDraw, size: int, width: float, colour: str) -> None:
    """The letters centred, [width] of the image wide."""
    font = ImageFont.truetype(str(FONT), 100)
    l, t, r, b = draw.textbbox((0, 0), TEXT, font=font)
    font = ImageFont.truetype(str(FONT), int(100 * size * width / (r - l)))
    l, t, r, b = draw.textbbox((0, 0), TEXT, font=font)
    draw.text(((size - (r - l)) / 2 - l, (size - (b - t)) / 2 - t), TEXT, font=font, fill=colour)


def legacy(px: int, colour: str, round_: bool) -> Image.Image:
    big = px * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = big * 0.08
    box = (pad, pad, big - pad, big - pad)
    if round_:
        d.ellipse(box, fill=colour)
    else:
        d.rounded_rectangle(box, radius=big * 0.2, fill=colour)
    letters(d, big, 0.5 if round_ else 0.56, "#FFFFFF")
    return img.resize((px, px), Image.LANCZOS)


def foreground(px: int) -> Image.Image:
    """108 dp layer; the letters stay inside the 66 dp circle every launcher shows."""
    big = px * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    letters(ImageDraw.Draw(img), big, 0.42, "#FFFFFF")
    return img.resize((px, px), Image.LANCZOS)


def write(path: Path, img: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    print(path.relative_to(ROOT))


def main() -> None:
    colour = primary()
    for name, k in DENSITY.items():
        d = RES / f"mipmap-{name}"
        write(d / "ic_launcher.png", legacy(round(48 * k), colour, False))
        write(d / "ic_launcher_round.png", legacy(round(48 * k), colour, True))
        fg = foreground(round(108 * k))
        write(d / "ic_launcher_foreground.png", fg)
        write(d / "ic_launcher_monochrome.png", fg)
    (RES / "values").mkdir(parents=True, exist_ok=True)
    (RES / "values/ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        f'    <!-- primarySolid in lib/ds/tokens.g.dart (python3 -m gen.icon) -->\n'
        f'    <color name="ic_launcher_background">{colour}</color>\n</resources>\n'
    )
    adaptive = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/ic_launcher_background"/>\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n'
        '</adaptive-icon>\n'
    )
    (RES / "mipmap-anydpi-v26").mkdir(parents=True, exist_ok=True)
    for n in ("ic_launcher", "ic_launcher_round"):
        (RES / f"mipmap-anydpi-v26/{n}.xml").write_text(adaptive)
    print(f"background {colour}")


if __name__ == "__main__":
    main()
