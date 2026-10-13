#!/usr/bin/env python3
"""diagram_writer の Copilot キット起動スクリプト（標準ライブラリだけ、Python 3.8 以上）。

Copilot Chat のサンドボックスは版が変わりうるので、Node・Chromium・フォントの場所は毎回ここで探す。
  python run.py env                    環境の確認（Node / Chromium / フォント）
  python run.py selftest [出力.png]    日本語フォントで描いた SVG を Chromium で PNG にし、描画経路を確認
  python run.py validate <ディレクトリ>...  物理構成モデル YAML の検証（node dw.js validate）
  python run.py build <図.yaml>... [--out-dir DIR]  図の記述 → .drawio と機械チェック（node dw.js build）
  python run.py preview <図.yaml>... [--out-dir DIR]  build に加えて、確認用の PNG も出力する（Chromium）
"""
import glob
import re
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SEARCH_DIRS = [HERE, os.getcwd(), "/mnt/data", "/mnt/user-data", os.path.expanduser("~")]
FONT_FAMILIES = ["BIZ UDPGothic", "BIZ UDGothic"]
FONT_INSTALL_DIR = os.path.expanduser("~/.local/share/fonts/diagram_writer")
MIN_NODE_MAJOR = 16
CHROME_NAMES = [
    "chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "chrome",
    "chrome-headless-shell", "headless_shell", "microsoft-edge", "microsoft-edge-stable",
]
CHROME_GLOBS = [
    "~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome",
    "~/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux*/headless_shell",
    "/ms-playwright/chromium-*/chrome-linux*/chrome",
    "/ms-playwright/chromium_headless_shell-*/chrome-linux*/headless_shell",
    "/opt/google/chrome/chrome",
]


def run(cmd, timeout=60):
    """(終了コード, 標準出力+標準エラー) を返す。起動できなければ (None, 理由)。"""
    try:
        p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
        return p.returncode, p.stdout.decode("utf-8", "replace").strip()
    except (OSError, subprocess.SubprocessError) as e:
        return None, "{}: {}".format(type(e).__name__, e)


def find_kit_file(name):
    for base in SEARCH_DIRS:
        for depth in ("", "*", "*/*"):
            hits = sorted(glob.glob(os.path.join(base, depth, name)))
            if hits:
                return hits[0]
    return None


def find_node():
    for name in ("node", "nodejs"):
        path = shutil.which(name)
        if path:
            code, out = run([path, "--version"])
            if code == 0:
                major = int(out.lstrip("v").split(".")[0])
                return path, out, major
    return None, None, None


def find_chrome():
    candidates = [os.environ.get("CHROME_PATH", "")]
    candidates += [shutil.which(n) or "" for n in CHROME_NAMES]
    patterns = list(CHROME_GLOBS)
    if os.environ.get("PLAYWRIGHT_BROWSERS_PATH"):
        root = os.environ["PLAYWRIGHT_BROWSERS_PATH"]
        patterns += [root + "/chromium-*/chrome-linux*/chrome", root + "/chromium_headless_shell-*/chrome-linux*/headless_shell"]
    for pattern in patterns:
        candidates += sorted(glob.glob(os.path.expanduser(pattern)), reverse=True)
    for path in candidates:
        if path and os.access(path, os.X_OK):
            code, out = run([path, "--version"], timeout=30)
            if code == 0:
                return path, out
    return None, None


def install_fonts():
    """添付された BIZ UD の TTF/OTF をユーザーのフォントフォルダに入れる。入れたファイル数を返す。"""
    found = []
    for base in SEARCH_DIRS:
        for depth in ("", "*"):
            for ext in ("ttf", "otf", "ttc"):
                found += glob.glob(os.path.join(base, depth, "*.{}".format(ext)))
    fonts = sorted({os.path.realpath(f) for f in found if "biz" in os.path.basename(f).lower()})
    if not fonts:
        return 0
    os.makedirs(FONT_INSTALL_DIR, exist_ok=True)
    for f in fonts:
        dest = os.path.join(FONT_INSTALL_DIR, os.path.basename(f))
        if os.path.realpath(dest) != f:
            shutil.copyfile(f, dest)
    if shutil.which("fc-cache"):
        run(["fc-cache", "-f", FONT_INSTALL_DIR], timeout=120)
    return len(fonts)


def font_status():
    """{ファミリー名: 実際に使われるフォントファイル or None}。fontconfig が無ければ None を返す。"""
    if not shutil.which("fc-match"):
        return None
    status = {}
    for family in FONT_FAMILIES:
        code, out = run(["fc-match", "-f", "%{family}\t%{file}", family])
        matched_family, _, path = out.partition("\t")
        status[family] = path if code == 0 and family in matched_family.split(",") else None
    return status


def cmd_env():
    print("python  {} ({})".format(sys.version.split()[0], sys.platform))
    node, node_version, major = find_node()
    if node is None:
        print("node    なし（validate/build は動かない）")
    else:
        note = "" if major >= MIN_NODE_MAJOR else "  ※ v{} 未満。動かない可能性あり".format(MIN_NODE_MAJOR)
        print("node    {} {}{}".format(node, node_version, note))
    chrome, chrome_version = find_chrome()
    print("chrome  {}".format("{} ({})".format(chrome, chrome_version) if chrome else "なし（PNG プレビューは作れない）"))
    dw = find_kit_file("dw.js")
    print("dw.js   {}".format(dw or "見つからない（キットの dw.js を添付する）"))
    installed = install_fonts()
    status = font_status()
    if status is None:
        print("fonts   fontconfig なし（フォントの確認不可）")
    else:
        for family, path in status.items():
            print("font    {}: {}".format(family, path or "なし（代替フォントで描かれる。TTF を添付する）"))
    if installed:
        print("        添付フォント {} 個を {} に導入".format(installed, FONT_INSTALL_DIR))
    return 0 if node and dw else 1


SELFTEST_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}">
<rect x="0" y="0" width="{w}" height="{h}" fill="#ffffff"/>
<rect x="20" y="20" width="440" height="60" fill="#f5f5f5" stroke="#666666"/>
<text x="36" y="58" font-family="BIZ UDPGothic" font-size="20" font-weight="bold">ストレージ ntap01-01（HA ペア A 系）</text>
<rect x="20" y="100" width="440" height="60" fill="#dae8fc" stroke="#6c8ebf"/>
<text x="36" y="138" font-family="BIZ UDGothic" font-size="18">Eth1/49 e0a vmnic0 192.0.2.11/24</text>
</svg>"""


def screenshot(chrome, html_path, png_path, width, height):
    cmd = [chrome, "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars",
           "--force-device-scale-factor=1", "--window-size={},{}".format(width, height),
           "--screenshot={}".format(os.path.abspath(png_path)), "file://" + os.path.abspath(html_path)]
    code, out = run(cmd, timeout=120)
    ok = code == 0 and os.path.isfile(png_path) and os.path.getsize(png_path) > 0
    return ok, out


def cmd_selftest(args):
    out_png = os.path.abspath(args[0] if args else "selftest.png")
    install_fonts()
    chrome, _ = find_chrome()
    if chrome is None:
        print("Chromium が見つからない")
        return 1
    w, h = 480, 180
    with tempfile.TemporaryDirectory() as tmp:
        html = os.path.join(tmp, "selftest.html")
        with open(html, "w", encoding="utf-8") as f:
            f.write('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0">')
            f.write(SELFTEST_SVG.format(w=w, h=h))
            f.write("</body></html>")
        ok, log = screenshot(chrome, html, out_png, w, h)
    if not ok:
        print("PNG を書き出せなかった:\n" + log)
        return 1
    print("PNG: {}".format(out_png))
    status = font_status() or {}
    for family in FONT_FAMILIES:
        print("font {}: {}".format(family, status.get(family) or "なし（画像は代替フォント）"))
    return 0


def cmd_node(command, args):
    node, _, _ = find_node()
    dw = find_kit_file("dw.js")
    if node is None or dw is None:
        print("node または dw.js が見つからない。python run.py env で確認する。")
        return 1
    return subprocess.call([node, dw, command] + args)


def svg_size(path):
    """SVG の width / height（整数）。読めなければ None。"""
    with open(path, encoding="utf-8") as f:
        head = f.read(400)
    m = re.search(r'width="(\d+)" height="(\d+)"', head)
    return (int(m.group(1)), int(m.group(2))) if m else None


def cmd_preview(args):
    """図の記述から .drawio と確認用の PNG を出力する（PNG は独自に描いた SVG を Chromium で画像にしたもの。正は .drawio）。"""
    install_fonts()
    code = cmd_node("build", args + ["--svg"])
    if code != 0:
        return code
    chrome, _ = find_chrome()
    if chrome is None:
        print("Chromium が見つからないので PNG は作らない（.drawio はできている）")
        return 1
    out_dir = args[args.index("--out-dir") + 1] if "--out-dir" in args else None
    files = [a for i, a in enumerate(args) if a != "--out-dir" and (i == 0 or args[i - 1] != "--out-dir")]
    failed = 0
    for yaml_path in files:
        name = re.sub(r"\.ya?ml$", "", os.path.basename(yaml_path))
        svg = os.path.join(out_dir or os.path.dirname(os.path.abspath(yaml_path)), name + ".svg")
        size = svg_size(svg) if os.path.isfile(svg) else None
        if size is None:
            continue
        png = svg[:-4] + ".png"
        with tempfile.TemporaryDirectory() as tmp:
            html = os.path.join(tmp, "preview.html")
            with open(html, "w", encoding="utf-8") as f, open(svg, encoding="utf-8") as s:
                f.write('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0">')
                f.write(s.read())
                f.write("</body></html>")
            ok, log = screenshot(chrome, html, png, size[0], size[1])
        if ok:
            print("PNG: {}".format(png))
        else:
            failed += 1
            print("PNG を書き出せなかった（{}）:\n{}".format(svg, log))
    return 1 if failed else 0


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    command, args = argv[0], argv[1:]
    if command == "env":
        return cmd_env()
    if command == "selftest":
        return cmd_selftest(args)
    if command in ("validate", "build"):
        return cmd_node(command, args)
    if command == "preview" and args:
        return cmd_preview(args)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
