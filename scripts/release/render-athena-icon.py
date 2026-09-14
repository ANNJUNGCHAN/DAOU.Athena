"""Export ATHENA icons from the approved raster master.

Run ``python scripts/release/render-athena-icon.py`` for app assets. Pass
``--website-public-dir <path>`` to also export the website icon files.
"""

from __future__ import annotations

import argparse
import base64
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "app" / "data"
SOURCE_PATH = DATA_DIR / "athena-icon-source.png"
APP_SIZES = (16, 24, 32, 48, 64, 128, 256)
WEBSITE_SIZES = (32, 192, 512, 180)


def resize(source: Image.Image, size: int) -> Image.Image:
    return source.resize((size, size), Image.Resampling.LANCZOS)


def save_png(source: Image.Image, path: Path, size: int) -> None:
    resize(source, size).save(path, format="PNG")


def save_ico(source: Image.Image, path: Path) -> None:
    icons = [resize(source, size) for size in APP_SIZES]
    icons[-1].save(
        path,
        format="ICO",
        sizes=[(size, size) for size in APP_SIZES],
        append_images=icons[:-1],
    )


def save_svg(png_path: Path, svg_path: Path) -> None:
    encoded_png = base64.b64encode(png_path.read_bytes()).decode("ascii")
    svg_path.write_text(
        "\n".join(
            (
                '<?xml version="1.0" encoding="UTF-8"?>',
                '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">',
                "  <!-- Raster companion: embeds the approved ATHENA app icon without redrawing it. -->",
                f'  <image width="256" height="256" href="data:image/png;base64,{encoded_png}"/>',
                "</svg>",
                "",
            )
        ),
        encoding="utf-8",
        newline="\n",
    )


def export_app(source: Image.Image) -> None:
    png_path = DATA_DIR / "athena-icon.png"
    ico_path = DATA_DIR / "athena-icon.ico"
    svg_path = DATA_DIR / "athena-icon.svg"
    save_png(source, png_path, 256)
    save_ico(source, ico_path)
    save_svg(png_path, svg_path)
    for path in (png_path, ico_path, svg_path):
        print(path)


def export_website(source: Image.Image, public_dir: Path) -> None:
    brand_dir = public_dir / "brand"
    brand_dir.mkdir(parents=True, exist_ok=True)
    for size in WEBSITE_SIZES:
        path = brand_dir / f"athena-app-icon-{size}.png"
        save_png(source, path, size)
        print(path)
    favicon_path = public_dir / "favicon.ico"
    save_ico(source, favicon_path)
    print(favicon_path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--website-public-dir",
        type=Path,
        help="Optional website public directory that receives favicon and brand PNGs.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    with Image.open(SOURCE_PATH) as opened:
        source = opened.convert("RGBA")
    export_app(source)
    if args.website_public_dir is not None:
        export_website(source, args.website_public_dir.resolve())


if __name__ == "__main__":
    main()
