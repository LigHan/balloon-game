"""Static integrity checks; does not claim browser rendering validation."""
from html.parser import HTMLParser
from pathlib import Path
import re

WEB = Path(__file__).resolve().parents[1] / "web"


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.links = []
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            assert attrs["id"] not in self.ids, f"Duplicate id: {attrs['id']}"
            self.ids.add(attrs["id"])
        for key in ["src", "href"]:
            if attrs.get(key):
                self.links.append(attrs[key])
        if tag == "script" and attrs.get("src"):
            self.scripts.append(attrs["src"])


routes = {"/": "/index.html", "/admin": "/admin.html", "/presentation": "/presentation.html"}
count = 0
for file in WEB.glob("*.html"):
    page = Page()
    page.feed(file.read_text())
    for link in page.links:
        if link.startswith(("http:", "https:", "#", "data:")):
            continue
        link = routes.get(link, link)
        assert (WEB / link.lstrip("/")).is_file(), f"Missing asset: {file.name}: {link}"
        count += 1
    for script in page.scripts:
        source = (WEB / script.lstrip("/")).read_text()
        if file.name != "admin.html":  # Admin inputs are deliberately generated from schema.
            for element_id in re.findall(r"(?:\$|getElementById)\(['\"]([^'\"]+)['\"]\)", source):
                assert element_id in page.ids, f"Unknown element in {script}: {element_id}"
                count += 1
    assert 'lang="ru"' in file.read_text()
    assert 'name="viewport"' in file.read_text()
print(f"PASS: {count} local links and literal element references across 3 HTML entrypoints")
