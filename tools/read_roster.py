"""读取名单工作簿，打印工作表、表头和前若干行，供后续匹配使用。"""
from pathlib import Path
import sys

from openpyxl import load_workbook

path = Path(sys.argv[1])
wb = load_workbook(path, data_only=True, read_only=True)
print("sheets:", wb.sheetnames)
for ws in wb.worksheets:
    print(f"\n=== {ws.title}  ({ws.max_row} 行 x {ws.max_column} 列) ===")
    for index, row in enumerate(ws.iter_rows(values_only=True)):
        if index >= 30:
            print("...")
            break
        cells = ["" if cell is None else str(cell).strip() for cell in row]
        if not any(cells):
            continue
        print(f"{index + 1:>3} | " + " | ".join(cells))
