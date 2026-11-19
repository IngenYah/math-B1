"""把名单工作簿转成 build.mjs 需要的 roster.csv（学号,姓名,区队）。

用法：
  python tools/xlsx_to_csv.py "C:\\...\\2026级中科大交流生名单.xlsx" roster.csv
"""
import csv
import re
import sys
from pathlib import Path

from openpyxl import load_workbook

SID = re.compile(r"^[A-Za-z0-9]{4,}$")


def main() -> int:
    source = Path(sys.argv[1])
    target = Path(sys.argv[2] if len(sys.argv) > 2 else "roster.csv")

    wb = load_workbook(source, data_only=True, read_only=True)
    sheet = wb["交流生名单"] if "交流生名单" in wb.sheetnames else wb.worksheets[0]
    rows = [list(row) for row in sheet.iter_rows(values_only=True)]

    header_index = None
    for index, row in enumerate(rows):
        cells = [str(cell).strip() if cell is not None else "" for cell in row]
        if "学号" in cells and "姓名" in cells:
            header_index = index
            break
    if header_index is None:
        print("没有找到含「学号」「姓名」的表头行", file=sys.stderr)
        return 1

    header = [str(cell).strip() if cell is not None else "" for cell in rows[header_index]]

    def column(*names: str) -> int:
        for name in names:
            if name in header:
                return header.index(name)
        return -1

    sid_col = column("学号")
    name_col = column("姓名")
    team_col = column("区队", "班级")
    score_col = column("期中", "成绩")

    out = []
    for row in rows[header_index + 1:]:
        cells = ["" if cell is None else str(cell).strip() for cell in row]

        def pick(index: int) -> str:
            return cells[index] if 0 <= index < len(cells) else ""

        sid = pick(sid_col)
        name = pick(name_col)
        if not SID.match(sid) or not name:
            continue
        out.append({
            "学号": sid,
            "姓名": name,
            "区队": pick(team_col),
            "成绩": pick(score_col),
        })

    with target.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["学号", "姓名", "区队", "成绩"])
        writer.writeheader()
        writer.writerows(out)

    print(f"写出 {len(out)} 人 → {target}")
    for item in out:
        print(f"  {item['学号']}  {item['姓名']}  {item['区队']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
