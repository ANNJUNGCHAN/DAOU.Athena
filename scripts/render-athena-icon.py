"""Rasterize app/data/athena-icon.svg into PNG and ICO for Electron/Windows."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "app" / "data"
BLUE = (14, 32, 178, 255)
WHITE = (255, 255, 255, 255)
PINK = (238, 19, 123, 255)
SIZES = (16, 24, 32, 48, 64, 128, 256)


def draw_mark(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    radius = max(2, round(size * 52 / 256))
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=BLUE)

    def pt(x: float, y: float) -> tuple[int, int]:
        return (round(x * size / 256), round(y * size / 256))

    draw.polygon(
        [pt(128, 46), pt(206, 214), pt(168.5, 214), pt(152.2, 172.4), pt(103.8, 172.4), pt(87.5, 214), pt(50, 214)],
        fill=WHITE,
    )
    draw.polygon([pt(128, 92), pt(109.6, 140.8), pt(146.4, 140.8)], fill=BLUE)
    draw.polygon([pt(176, 40), pt(228, 40), pt(228, 92)], fill=PINK)
    return image


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    master = draw_mark(256)
    png_path = OUT_DIR / "athena-icon.png"
    ico_path = OUT_DIR / "athena-icon.ico"
    master.save(png_path, format="PNG")
    icons = [draw_mark(size) for size in SIZES]
    icons[-1].save(ico_path, format="ICO", sizes=[(size, size) for size in SIZES], append_images=icons[:-1])
    print(png_path)
    print(ico_path)


if __name__ == "__main__":
    main()
