"""python3 -m gen.fonts — cuts the web's Inter (apps/web/public/fonts) into the
static weights the app uses, so text on the phone looks like the web.
Run once when the web's font changes; the .ttf files are committed."""
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

from .spec import ROOT

SRC = ROOT.parent / "web/public/fonts/inter-latin.woff2"
OUT = ROOT / "assets/fonts"
WEIGHTS = {400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold"}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for w, name in WEIGHTS.items():
        font = TTFont(SRC)
        static = instantiateVariableFont(font, {"wght": w}, updateFontNames=False)
        static.flavor = None
        static.save(OUT / f"Inter-{name}.ttf")
        print(f"Inter-{name}.ttf")


if __name__ == "__main__":
    main()
