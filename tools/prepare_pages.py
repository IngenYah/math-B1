"""把扫描件摆正、剥掉 EXIF、按扫描顺序重命名为 01.jpg / 02.jpg …，再交给 build.mjs。

这批试卷的照片有两种存法：一部分 EXIF 写了旋转（8），另一部分像素本身就是躺着的，
直接放进网页会有大半张是横着的。这里统一处理成「横向两页平摊、文字朝上」。

用法：
  python tools/prepare_pages.py --source "C:\\...\\试卷" --out 试卷_摆正
  python tools/prepare_pages.py --source "..." --out "..." --no-rotate   # 不许自动转 90°
  python tools/prepare_pages.py --source "..." --out "..." --max-width 1800 --quality 80
"""
import argparse
import sys
from pathlib import Path

from PIL import Image, ImageOps

EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--quality", type=int, default=82)
    parser.add_argument("--max-width", type=int, default=0)
    parser.add_argument("--no-rotate", action="store_true")
    args = parser.parse_args()

    source = Path(args.source)
    target = Path(args.out)
    if not source.is_dir():
        print(f"找不到源目录 {source}", file=sys.stderr)
        return 1

    total_before = 0
    total_after = 0
    rotated_total = 0
    pages_total = 0

    for folder in sorted(p for p in source.iterdir() if p.is_dir()):
        files = sorted(
            (p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in EXTS),
            key=lambda p: (p.stat().st_mtime, p.name),
        )
        if not files:
            print(f"  ! {folder.name}: 没有图片")
            continue

        out_dir = target / folder.name
        out_dir.mkdir(parents=True, exist_ok=True)
        rotated = 0
        before = 0
        after = 0

        for index, path in enumerate(files, start=1):
            with Image.open(path) as image:
                before += path.stat().st_size
                upright = ImageOps.exif_transpose(image)
                if not args.no_rotate and upright.height > upright.width:
                    upright = upright.rotate(90, expand=True)
                    rotated += 1
                if args.max_width and upright.width > args.max_width:
                    ratio = args.max_width / upright.width
                    upright = upright.resize(
                        (args.max_width, round(upright.height * ratio)), Image.LANCZOS
                    )
                destination = out_dir / f"{index:02d}.jpg"
                upright.convert("RGB").save(
                    destination, "JPEG", quality=args.quality, optimize=True
                )
                after += destination.stat().st_size

        pages_total += len(files)
        rotated_total += rotated
        total_before += before
        total_after += after
        print(
            f"  {folder.name}\t{len(files)} 页\t转正 {rotated}\t"
            f"{before / 1024:.0f} KB → {after / 1024:.0f} KB"
        )

    print(
        f"\n共 {pages_total} 页，自动转正 {rotated_total} 页；"
        f"总计 {total_before / 1048576:.1f} MB → {total_after / 1048576:.1f} MB"
    )
    print(f"输出：{target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
