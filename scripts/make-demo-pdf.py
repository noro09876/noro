"""Renders a demo text document into a PDF with a real (selectable) text layer."""
import sys
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

src, dst = sys.argv[1], sys.argv[2]
pdfmetrics.registerFont(TTFont('DejaVu', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuB', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))
c = canvas.Canvas(dst, pagesize=A4, invariant=1)
c.setTitle('Счёт на оплату № 418 (демо NORO)')
c.setAuthor('NORO demo')
w, h = A4
y = h - 56
for line in open(src, encoding='utf-8').read().splitlines():
    bold = line.startswith('СЧЁТ') or line.startswith('Всего')
    c.setFont('DejaVuB' if bold else 'DejaVu', 12 if bold else 10)
    c.drawString(48, y, line)
    y -= 17 if bold else 14
    if y < 48:
        c.showPage()
        y = h - 56
c.setFont('DejaVu', 7)
c.drawString(48, 30, 'Демонстрационный документ NORO. Все реквизиты вымышлены.')
c.save()
