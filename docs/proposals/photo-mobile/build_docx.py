"""Builds the editable DOCX version of the proposal from kp-photoagent.html.

Uses the customer's KP template (template.docx) as the base, so the document
keeps its fonts, heading styles, header and footer. Run build.mjs first: it
produces diagram-to-be.png used here.

Usage: python3 docs/proposals/photo-mobile/build_docx.py
Needs: python-docx, beautifulsoup4.
"""
import copy
import re
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString, Tag
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Emu, Mm, Pt, RGBColor

DIR = Path(__file__).resolve().parent
SRC = DIR / "kp-photoagent.html"
TEMPLATE = DIR / "template.docx"
OUT = DIR / "KP-PhotoAgent-Photo-mobile.docx"
DIAGRAM = DIR / "diagram-to-be.png"
DOC_NO = "КП-PM-2026-01"

NAVY, BLUE, TEAL = "172B4D", "235789", "0B7A75"
INK, MUTED, LINE = "18212B", "526273", "D5DDE8"
ALT, CELL = "F3F6FA", "E8EEF6"
BOXES = {  # class -> (background, title colour)
    "green": ("E7F3F0", TEAL),
    "yellow": ("FFF3DA", "B7791F"),
    "blue": ("EAF1F8", BLUE),
    "red": ("FDECEC", "A33A3A"),
}

PAGE_W, MARGIN = Mm(210), Mm(19)
CONTENT_W = PAGE_W - 2 * MARGIN


def rgb(hex_):
    return RGBColor.from_string(hex_)


def shade(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    for old in tc_pr.findall(qn("w:shd")):
        tc_pr.remove(old)
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def cell_borders(cell, **sides):
    """sides: top/left/bottom/right = (size_eighths, colour) or None for none."""
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = OxmlElement("w:tcBorders")
    for side in ("top", "left", "bottom", "right"):
        el = OxmlElement(f"w:{side}")
        spec = sides.get(side)
        if spec:
            el.set(qn("w:val"), "single")
            el.set(qn("w:sz"), str(spec[0]))
            el.set(qn("w:color"), spec[1])
        else:
            el.set(qn("w:val"), "nil")
        borders.append(el)
    tc_pr.append(borders)


def table_borders(table, colour=LINE, size=4):
    tbl_pr = table._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:val"), "single" if colour else "nil")
        if colour:
            el.set(qn("w:sz"), str(size))
            el.set(qn("w:color"), colour)
        borders.append(el)
    tbl_pr.append(borders)


def cell_margins(table, top=50, bottom=50, left=90, right=90):
    tbl_pr = table._tbl.tblPr
    mar = OxmlElement("w:tblCellMar")
    for side, val in (("top", top), ("left", left), ("bottom", bottom), ("right", right)):
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:w"), str(val))
        el.set(qn("w:type"), "dxa")
        mar.append(el)
    tbl_pr.append(mar)


def repeat_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    el = OxmlElement("w:tblHeader")
    el.set(qn("w:val"), "true")
    tr_pr.append(el)
    no_split = OxmlElement("w:cantSplit")
    tr_pr.append(no_split)


def keep_row_together(row):
    row._tr.get_or_add_trPr().append(OxmlElement("w:cantSplit"))


def fmt(par, before=0, after=4, line=None, keep_next=False):
    pf = par.paragraph_format
    pf.space_before, pf.space_after = Pt(before), Pt(after)
    if line:
        pf.line_spacing = line
    if keep_next:
        pf.keep_with_next = True


# ---------- inline content ----------

def add_inline(par, node, size=None, color=None, bold=False, italic=False):
    """Append runs for an HTML node's inline content to a paragraph."""
    if isinstance(node, NavigableString):
        text = re.sub(r"\s+", " ", str(node))
        if not text:
            return
        run = par.add_run(text)
        run.bold = bold or None
        run.italic = italic or None
        if size:
            run.font.size = Pt(size)
        if color:
            run.font.color.rgb = rgb(color)
        return
    if not isinstance(node, Tag):
        return
    if node.name == "br":
        par.add_run().add_break()
        return
    cls = node.get("class", [])
    b, i, c, s = bold, italic, color, size
    if node.name in ("b", "strong"):
        b = True
    if node.name in ("i", "em"):
        i = True
    if "kbd" in cls:
        b, c = True, NAVY
    if "small" in cls:
        s, c = (size or 9) - 1.5, MUTED
    if "ok" in cls:
        b, c = True, TEAL
    if "no" in cls:
        b, c = True, "A33A3A"
    if "kbd" in cls:
        run = par.add_run(f"[{node.get_text(strip=True)}]")
        run.bold, run.font.color.rgb = True, rgb(NAVY)
        if s:
            run.font.size = Pt(s)
        return
    for child in node.children:
        add_inline(par, child, s, c, b, i)


def strip_edges(par):
    if par.runs:
        par.runs[0].text = par.runs[0].text.lstrip()
        par.runs[-1].text = par.runs[-1].text.rstrip()


def para(container, node=None, text=None, style=None, size=None, color=None,
         bold=False, italic=False, align=None, **spacing):
    par = container.add_paragraph(style=style)
    if text is not None:
        run = par.add_run(text)
        run.bold, run.italic = bold or None, italic or None
        if size:
            run.font.size = Pt(size)
        if color:
            run.font.color.rgb = rgb(color)
    if node is not None:
        add_inline(par, node, size, color, bold, italic)
        strip_edges(par)
    if align:
        par.alignment = align
    fmt(par, **spacing)
    return par


# ---------- blocks ----------

def emit_list(container, node, size=9):
    ordered = node.name == "ol"
    for n, li in enumerate(node.find_all("li", recursive=False), 1):
        if ordered:
            par = container.add_paragraph(style="Normal")
            par.paragraph_format.left_indent = Mm(6)
            par.paragraph_format.first_line_indent = Mm(-6)
            par.add_run(f"{n}.\t").font.size = Pt(size)
            par.paragraph_format.tab_stops.add_tab_stop(Mm(6))
        else:
            par = container.add_paragraph(style="List Bullet")
        add_inline(par, li, size)
        strip_edges(par)
        fmt(par, after=2)


def col_widths(table_node, ncols):
    first = table_node.find("tr")
    explicit = []
    for cell in first.find_all(["th", "td"], recursive=False):
        m = re.search(r"width:\s*(\d+)%", cell.get("style", ""))
        explicit.append(int(m.group(1)) if m else None)
    if "kv" in table_node.get("class", []) and not any(explicit):
        explicit = [32, None]
    explicit += [None] * (ncols - len(explicit))
    fixed = sum(w for w in explicit if w)
    free = [i for i, w in enumerate(explicit) if not w]
    rest = (100 - fixed) / len(free) if free else 0
    return [Emu(int(CONTENT_W * ((w or rest) / 100))) for w in explicit]


def emit_table(container, node, toc=False):
    rows = node.find_all("tr")
    if toc:  # page numbers differ between PDF and DOCX pagination
        for r in rows:
            r.find_all(["th", "td"])[-1].decompose()
    ncols = max(len(r.find_all(["th", "td"])) for r in rows)
    table = container.add_table(rows=0, cols=ncols)
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.autofit = False
    table_borders(table)
    cell_margins(table)
    widths = col_widths(node, ncols)
    for j, w in enumerate(widths):
        table.columns[j].width = w
    kv = "kv" in node.get("class", [])
    body_index = 0
    for r in rows:
        cells = r.find_all(["th", "td"])
        is_head = all(c.name == "th" for c in cells)
        is_total = "total" in r.get("class", [])
        row = table.add_row()
        if is_head:
            repeat_header(row)
        else:
            keep_row_together(row)
            body_index += 1
        for j, src in enumerate(cells):
            cell = row.cells[j]
            cell.width = widths[j]
            par = cell.paragraphs[0]
            fill = None
            color = None
            bold = False
            if is_head:
                fill, color, bold = NAVY, "FFFFFF", True
            elif is_total:
                fill, bold = CELL, True
            elif kv and j == 0:
                fill, color, bold = CELL, "3A465C", True
            elif body_index % 2 == 0 and not kv:
                fill = ALT
            if fill:
                shade(cell, fill)
            add_inline(par, src, 8.5, color, bold)
            strip_edges(par)
            if "num" in src.get("class", []):
                par.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            fmt(par, after=0, line=1.1)
    spacer = container.add_paragraph()
    fmt(spacer, after=2)
    spacer.paragraph_format.line_spacing = Pt(6)


def emit_box(container, node):
    kind = next((k for k in BOXES if k in node.get("class", [])), "blue")
    bg, title_colour = BOXES[kind]
    table = container.add_table(rows=1, cols=1)
    table_borders(table, colour=None)
    cell_margins(table, 110, 110, 160, 160)
    cell = table.rows[0].cells[0]
    cell.width = CONTENT_W
    keep_row_together(table.rows[0])
    shade(cell, bg)
    first = True
    for child in node.children:
        if not isinstance(child, Tag):
            continue
        par = cell.paragraphs[0] if first else cell.add_paragraph()
        first = False
        if "t" in child.get("class", []):
            run = par.add_run(child.get_text(strip=True).upper())
            run.bold, run.font.size, run.font.color.rgb = True, Pt(8), rgb(title_colour)
            fmt(par, after=2, keep_next=True)
        elif child.name in ("ul", "ol"):
            par._p.getparent().remove(par._p)
            emit_list(cell, child)
        else:
            add_inline(par, child, 9)
            strip_edges(par)
            fmt(par, after=2)
    spacer = container.add_paragraph()
    spacer.paragraph_format.line_spacing = Pt(6)
    fmt(spacer, after=2)


def emit_stats(container, node):
    items = node.find_all("div", recursive=False)
    table = container.add_table(rows=1, cols=len(items))
    table_borders(table, colour=None)
    cell_margins(table, 90, 90, 110, 110)
    for j, item in enumerate(items):
        cell = table.rows[0].cells[j]
        cell.width = Emu(int(CONTENT_W / len(items)))
        shade(cell, ALT)
        cell_borders(cell, top=(18, TEAL))
        p1 = cell.paragraphs[0]
        run = p1.add_run(item.find("b").get_text(strip=True))
        run.bold, run.font.size, run.font.color.rgb = True, Pt(14), rgb(NAVY)
        fmt(p1, after=1)
        p2 = cell.add_paragraph()
        run = p2.add_run(item.find("span").get_text(strip=True))
        run.font.size, run.font.color.rgb = Pt(7.5), rgb(MUTED)
        fmt(p2, after=0)
    spacer = container.add_paragraph()
    fmt(spacer, after=4)


def emit_section(doc, sec, first):
    for node in sec.children:
        if not isinstance(node, Tag):
            continue
        cls = node.get("class", [])
        if "kicker" in cls:
            par = para(doc, text=node.get_text(strip=True).upper(), size=8, color=TEAL,
                       bold=True, after=2, keep_next=True)
            par.paragraph_format.page_break_before = not first
        elif node.name == "h1":
            par = doc.add_paragraph(style="Heading 1")
            add_inline(par, node)
            strip_edges(par)
        elif node.name == "h2":
            par = doc.add_paragraph(style="Heading 2")
            add_inline(par, node)
            strip_edges(par)
        elif node.name == "h3":
            para(doc, node, size=10.5, color=NAVY, bold=True, before=6, after=3, keep_next=True)
        elif "lead" in cls:
            para(doc, node, size=9.5, color=MUTED, italic=True, after=8)
        elif "note" in cls or "small" in cls:
            para(doc, node, size=8, color=MUTED, italic="note" in cls, after=6)
        elif node.name == "p":
            para(doc, node, size=9, after=5)
        elif node.name in ("ul", "ol"):
            emit_list(doc, node)
        elif node.name == "table":
            emit_table(doc, node, toc="toc" in cls)
        elif "box" in cls:
            emit_box(doc, node)
        elif "stat" in cls:
            emit_stats(doc, node)
        elif node.name == "svg":
            par = doc.add_paragraph()
            par.add_run().add_picture(str(DIAGRAM), width=CONTENT_W)
            fmt(par, after=6)
        else:
            raise ValueError(f"Unhandled element: <{node.name} class={cls}>")


def emit_cover(doc, sec):
    brand = sec.find(class_="brand").get_text(strip=True)
    para(doc, text=brand, size=11, color=TEAL, bold=True, before=40, after=60)
    title = doc.add_paragraph()
    run = title.add_run("КОММЕРЧЕСКОЕ")
    run.add_break()
    run2 = title.add_run("ПРЕДЛОЖЕНИЕ")
    for r in (run, run2):
        r.bold, r.font.size, r.font.color.rgb = True, Pt(34), rgb(NAVY)
        r.font.name = "Aptos Display"
    fmt(title, after=10, line=1.05)
    para(doc, text=sec.find(class_="sub").get_text(strip=True), size=16, color=BLUE,
         bold=True, after=12)
    para(doc, text=sec.find(class_="desc").get_text(" ", strip=True), size=10.5,
         color=MUTED, after=36)
    emit_table(doc, sec.find("table"))
    para(doc, text=sec.find(class_="place").get_text(" ", strip=True), size=8.5,
         color=MUTED, bold=True, before=30)


def reset_body(doc):
    body = doc.element.body
    sect = body.find(qn("w:sectPr"))
    for child in list(body):
        if child is not sect:
            body.remove(child)
    s = doc.sections[0]
    s.page_width, s.page_height = PAGE_W, Mm(297)
    s.left_margin = s.right_margin = MARGIN
    s.top_margin, s.bottom_margin = Mm(18), Mm(17)


def replace_in(paragraphs, old, new):
    for par in paragraphs:
        for run in par.runs:
            if old in run.text:
                run.text = run.text.replace(old, new)


def main():
    soup = BeautifulSoup(SRC.read_text(encoding="utf-8"), "html.parser")
    doc = Document(str(TEMPLATE))
    reset_body(doc)
    hdr, ftr = doc.sections[0].header, doc.sections[0].footer
    replace_in(hdr.paragraphs, "[НАЗВАНИЕ КОМПАНИИ]", "NORO")
    replace_in(hdr.paragraphs, "КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ", "КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ · PHOTOAGENT")
    replace_in(ftr.paragraphs, "[НОМЕР ДОКУМЕНТА]", DOC_NO)

    sections = soup.find_all("section")
    emit_cover(doc, sections[0])
    for sec in sections[1:]:
        emit_section(doc, sec, first=False)

    props = doc.core_properties
    props.title = "Коммерческое предложение PhotoAgent — Photo-mobile"
    props.author = "NORO"
    props.subject = DOC_NO
    doc.save(str(OUT))
    print(f"DOCX: {OUT}")


if __name__ == "__main__":
    main()
