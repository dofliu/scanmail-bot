#!/usr/bin/env python3
"""把版號的「唯一來源」真的變成唯一 —— 從 main.py 同步到其他還留著版號的檔案。

版號的唯一來源是 main.py 的 version="x.y.z"（見 docs/DAILY_ROUTINE.md 的收尾契約），
但有兩個地方各自抄了一份，而且**從 v3.15.0 之後就沒人動過**，凍了十幾個版本：

  * static/index.html 每個 script 標籤上的 ?v=x.y.z —— 快取破壞參數。
    凍住等於機制失效：實務上靠 StaticFiles 的 ETag revalidation 補救，
    所以使用者不太會真的吃到舊 JS，但那個參數存在的意義就是不要依賴 revalidation。
  * mobile/package.json 的 "version" —— 不進 APK（versionName 由 build_mobile.py
    寫進 version.properties），純粹是 npm 顯示用，但錯的版號比沒有版號更誤導。

用法：改完 main.py 的版號之後跑一次

    python scripts/sync_version.py

不帶參數、可以重複跑（已同步就什麼都不改）。忘了跑也不會安靜地過 ——
tests/test_mobile_build.py 有一條守門測試在比對，落後就紅。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read_version() -> str:
    """跟 scripts/build_mobile.py 同一個定義：main.py 的 version="x.y.z"。"""
    m = re.search(r'version="(\d+\.\d+\.\d+)"', (ROOT / "main.py").read_text(encoding="utf-8"))
    if not m:
        sys.exit('在 main.py 找不到 version="x.y.z"')
    return m.group(1)


def sync_index_html(version: str) -> int:
    """index.html 的 ?v=。回傳改了幾處。"""
    path = ROOT / "static" / "index.html"
    html = path.read_text(encoding="utf-8")
    updated, n = re.subn(r"\?v=\d+\.\d+\.\d+", f"?v={version}", html)
    changed = sum(1 for a, b in zip(
        re.findall(r"\?v=(\d+\.\d+\.\d+)", html),
        re.findall(r"\?v=(\d+\.\d+\.\d+)", updated)) if a != b)
    if n == 0:
        sys.exit("static/index.html 裡一個 ?v= 都沒有 —— 快取破壞機制被拿掉了？")
    if changed:
        path.write_text(updated, encoding="utf-8")
    return changed


def sync_package_json(version: str) -> bool:
    path = ROOT / "mobile" / "package.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("version") == version:
        return False
    data["version"] = version
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return True


def main() -> None:
    version = read_version()
    n = sync_index_html(version)
    pkg = sync_package_json(version)
    if not n and not pkg:
        print(f"已經同步在 v{version}，沒有東西要改")
        return
    if n:
        print(f"static/index.html：{n} 個 ?v= → {version}")
    if pkg:
        print(f"mobile/package.json：version → {version}")


if __name__ == "__main__":
    main()
