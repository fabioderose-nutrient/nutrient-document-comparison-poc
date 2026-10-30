"""Generate the sample documents of the comparison demo.

- A fictitious service agreement in two versions. Version 2 has realistic edits:
  a changed payment term, changed amounts and dates, a deleted clause, a new clause,
  a reworded obligation and a paragraph moved to another place.
- A simple floor plan drawing in two revisions for the visual comparison.
- expected-changes.json: the list of edits made, used to check what the comparison detects.

Every party, person, address and figure is invented.

Usage:
    python tools/generate_samples.py [output-folder]

Default output folder: public/samples
"""

import json
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4, A3, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

SUPPLIER = "Brackenfield Data Services Ltd"
CUSTOMER = "Quarrymoor Logistics Ltd"

INK = colors.HexColor("#1f2933")
MUTED = colors.HexColor("#616e7c")

STYLES = {
    "title": ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=18, leading=22, alignment=TA_CENTER, textColor=INK),
    "subtitle": ParagraphStyle("subtitle", fontName="Helvetica", fontSize=10, leading=14, alignment=TA_CENTER, textColor=MUTED),
    "h": ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=11.5, leading=15, spaceBefore=10, spaceAfter=4, textColor=INK),
    "p": ParagraphStyle("p", fontName="Helvetica", fontSize=10, leading=14, spaceAfter=6, textColor=INK),
    "clause": ParagraphStyle("clause", fontName="Helvetica", fontSize=10, leading=14, spaceAfter=6, leftIndent=26, firstLineIndent=-26, textColor=INK),
}

# Each edit: what changes between version 1 and version 2.
# "original" is text found only in version 1, "changed" only in version 2.
EDITS = [
    {"id": "effective-date", "kind": "replacement", "page": 1,
     "description": "Effective date moved by one month",
     "original": "1 March 2026", "changed": "1 April 2026"},
    {"id": "moved-paragraph", "kind": "move", "page": 1,
     "description": "Background paragraph about service levels moved from the end to the start of the section",
     "original": "Both parties want the service levels", "changed": "Both parties want the service levels"},
    {"id": "monthly-fee", "kind": "replacement", "page": 2,
     "description": "Monthly service fee increased",
     "original": "USD 12,500", "changed": "USD 13,750"},
    {"id": "payment-term", "kind": "replacement", "page": 2,
     "description": "Payment term extended from 30 to 45 days",
     "original": "thirty (30) days", "changed": "forty-five (45) days"},
    {"id": "deleted-clause", "kind": "deletion", "page": 2,
     "description": "Annual price review clause removed",
     "original": "Price review. Once in each Contract Year", "changed": None},
    {"id": "end-date", "kind": "replacement", "page": 3,
     "description": "Initial term end date moved by one month",
     "original": "28 February 2029", "changed": "31 March 2029"},
    {"id": "liability-cap", "kind": "replacement", "page": 3,
     "description": "Liability cap raised",
     "original": "USD 250,000", "changed": "USD 400,000"},
    {"id": "new-clause", "kind": "insertion", "page": 3,
     "description": "New clause on the location of Customer Data",
     "original": None, "changed": "Data location. The Supplier stores and processes Customer Data only"},
    {"id": "reworded-obligation", "kind": "replacement", "page": 4,
     "description": "Effort standard changed from reasonable to best endeavours",
     "original": "reasonable endeavours", "changed": "best endeavours"},
]


def P(text, style="p"):
    return Paragraph(text, STYLES[style])


def clause(number, text):
    return Paragraph("<b>%s</b>&nbsp;&nbsp;%s" % (number, text), STYLES["clause"])


def contract_story(v2):
    effective = "1 April 2026" if v2 else "1 March 2026"
    end_date = "31 March 2029" if v2 else "28 February 2029"
    fee = "USD 13,750" if v2 else "USD 12,500"
    days = "forty-five (45) days" if v2 else "thirty (30) days"
    cap = "USD 400,000" if v2 else "USD 250,000"
    endeavours = "best endeavours" if v2 else "reasonable endeavours"

    s = []
    # Page 1 -------------------------------------------------------------
    s += [P("MANAGED DATA SERVICES AGREEMENT", "title"),
          P("Agreement reference MDS-2026-014 &middot; Version %s" % ("2" if v2 else "1"), "subtitle"),
          Spacer(1, 14)]
    s += [P("This Agreement is made on %s (the <b>Effective Date</b>) between:" % effective)]
    s += [clause("(1)", "<b>%s</b>, a company registered under number 08814257, whose registered office is at "
                        "Unit 4, Millbrook Business Park, Eastford, EF4 2QL (the <b>Supplier</b>); and" % SUPPLIER),
          clause("(2)", "<b>%s</b>, a company registered under number 11290463, whose registered office is at "
                        "22 Canal Wharf, Northwick, NW7 5RD (the <b>Customer</b>)." % CUSTOMER)]
    s += [P("Background", "h")]
    moved = P("Both parties want the service levels, the fees and the responsibilities for Customer Data to be "
              "set out in one document that both of them can rely on for the whole term.")
    background = [
        P("The Customer operates a regional freight network and needs a managed platform to collect, store "
          "and report on shipment and fleet data from its depots."),
        P("The Supplier provides managed data services, including hosting, data integration, reporting and "
          "support, to logistics and distribution companies."),
        P("The Customer has selected the Supplier after a competitive tender, on the basis of the proposal "
          "dated 12 January 2026."),
    ]
    s += ([moved] + background) if v2 else (background + [moved])
    s += [P("1. Definitions", "h"),
          clause("1.1", "<b>Contract Year</b> means each period of twelve months starting on the Effective Date or on an anniversary of it."),
          clause("1.2", "<b>Customer Data</b> means all data supplied by the Customer or collected by the Services on its behalf."),
          clause("1.3", "<b>Services</b> means the managed data services described in Schedule 1."),
          clause("1.4", "<b>Service Levels</b> means the availability and response targets set out in Schedule 2."),
          PageBreak()]

    # Page 2 -------------------------------------------------------------
    s += [P("2. Services", "h"),
          clause("2.1", "The Supplier shall provide the Services from the Effective Date in accordance with this "
                        "Agreement and the Service Levels."),
          clause("2.2", "The Supplier shall assign a named service manager who is the Customer's first point of "
                        "contact for all operational matters."),
          clause("2.3", "The Customer shall give the Supplier timely access to the systems, data and people "
                        "reasonably needed to deliver the Services.")]
    s += [P("3. Fees and payment", "h"),
          clause("3.1", "The Customer shall pay a monthly service fee of %s, exclusive of sales tax, for the "
                        "Services described in Schedule 1." % fee),
          clause("3.2", "The Supplier shall invoice the monthly service fee in advance on the first business day "
                        "of each month."),
          clause("3.3", "The Customer shall pay each undisputed invoice within %s of the invoice date, by bank "
                        "transfer to the account stated on the invoice." % days),
          clause("3.4", "If an amount is not paid when due, the Supplier may charge interest at 2% per year above "
                        "the base rate from the due date until payment.")]
    if not v2:
        s += [clause("3.5", "<b>Price review.</b> Once in each Contract Year, the Supplier may increase the monthly "
                            "service fee by giving the Customer at least sixty (60) days' written notice. An increase "
                            "shall not exceed the change in the consumer price index over the previous twelve months.")]
    s += [PageBreak()]

    # Page 3 -------------------------------------------------------------
    s += [P("4. Term", "h"),
          clause("4.1", "This Agreement starts on the Effective Date and continues until %s (the <b>Initial "
                        "Term</b>), unless terminated earlier under clause 8." % end_date),
          clause("4.2", "After the Initial Term, this Agreement renews for successive periods of twelve months "
                        "unless either party gives at least ninety (90) days' notice before the end of the "
                        "current term.")]
    s += [P("5. Liability", "h"),
          clause("5.1", "Nothing in this Agreement limits liability for death or personal injury caused by "
                        "negligence, or for fraud."),
          clause("5.2", "Subject to clause 5.1, the total liability of each party in each Contract Year shall "
                        "not exceed %s." % cap),
          clause("5.3", "Neither party is liable for any indirect or consequential loss, or for loss of profit, "
                        "revenue or goodwill.")]
    s += [P("6. Data protection", "h"),
          clause("6.1", "The Supplier shall process Customer Data only on the documented instructions of the "
                        "Customer and for the purpose of providing the Services."),
          clause("6.2", "The Supplier shall keep Customer Data confidential and protect it with appropriate "
                        "technical and organisational measures."),
          clause("6.3", "The Supplier shall notify the Customer without undue delay, and in any case within "
                        "forty-eight (48) hours, after becoming aware of a breach affecting Customer Data.")]
    if v2:
        s += [clause("6.4", "<b>Data location.</b> The Supplier stores and processes Customer Data only in data "
                            "centres located in the country where the Customer has its registered office, unless "
                            "the Customer agrees otherwise in writing.")]
    s += [PageBreak()]

    # Page 4 -------------------------------------------------------------
    s += [P("7. Service continuity", "h"),
          clause("7.1", "The Supplier shall maintain a business continuity plan for the Services and test it at "
                        "least once in each Contract Year."),
          clause("7.2", "The Supplier shall use %s to restore the Services within the recovery times set "
                        "out in Schedule 2 after any incident." % endeavours)]
    s += [P("8. Termination", "h"),
          clause("8.1", "Either party may terminate this Agreement by written notice if the other party commits a "
                        "material breach that is not remedied within thirty (30) days of notice of the breach."),
          clause("8.2", "On termination, the Supplier shall return all Customer Data in a commonly used format and "
                        "then delete it from its systems.")]
    s += [P("9. General", "h"),
          clause("9.1", "This Agreement is the entire agreement between the parties about its subject matter."),
          clause("9.2", "This Agreement is governed by the laws of the jurisdiction of the Customer's registered "
                        "office.")]
    s += [Spacer(1, 18)]
    sign = Table(
        [["Signed for the Supplier", "Signed for the Customer"],
         ["Name: Helena Marsh", "Name: Tobias Lindqvist"],
         ["Title: Managing Director", "Title: Chief Operating Officer"],
         ["Date:", "Date:"]],
        colWidths=[82 * mm, 82 * mm],
    )
    sign.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 10),
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 10),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("LINEABOVE", (0, 1), (-1, 1), 0.6, MUTED),
    ]))
    s += [sign]
    return s


def footer(version):
    def draw(c, doc):
        c.saveState()
        c.setFont("Helvetica", 8)
        c.setFillColor(MUTED)
        c.drawString(20 * mm, 12 * mm, "MDS-2026-014. Fictitious sample document for a software demo.")
        c.drawRightString(A4[0] - 20 * mm, 12 * mm, "Page %d" % doc.page)
        c.restoreState()
    return draw


def build_contract(path, v2):
    doc = SimpleDocTemplate(str(path), pagesize=A4, leftMargin=22 * mm, rightMargin=22 * mm,
                            topMargin=20 * mm, bottomMargin=22 * mm,
                            title="Managed Data Services Agreement v%s" % ("2" if v2 else "1"),
                            author="Fictitious sample", subject="Sample contract for a comparison demo")
    version = "2" if v2 else "1"
    doc.build(contract_story(v2), onFirstPage=footer(version), onLaterPages=footer(version))


# Floor plan ---------------------------------------------------------------

def build_plan(path, rev_b):
    """A small office floor plan. Revision B moves a door, adds a partition, a window and changes labels."""
    page = landscape(A3)
    c = canvas.Canvas(str(path), pagesize=page)
    c.setTitle("Floor plan, revision %s" % ("B" if rev_b else "A"))
    c.setAuthor("Fictitious sample")
    ox, oy = 45 * mm, 70 * mm
    s = 0.9 * mm  # 1 unit = 0.9 mm on paper, plan is 330 x 180 units

    def X(u):
        return ox + u * s

    def Y(v):
        return oy + v * s

    def wall(x1, y1, x2, y2, w=2.2):
        c.setLineWidth(w)
        c.line(X(x1), Y(y1), X(x2), Y(y2))

    def door(x, y, width, horizontal=True, swing=1):
        c.setLineWidth(0.8)
        if horizontal:
            c.setStrokeColor(colors.white)
            c.setLineWidth(3)
            c.line(X(x), Y(y), X(x + width), Y(y))
            c.setStrokeColor(colors.black)
            c.setLineWidth(0.8)
            c.line(X(x), Y(y), X(x), Y(y + swing * width))
            c.arc(X(x - width), Y(y - width), X(x + width), Y(y + width), 0 if swing > 0 else -90, 90)
        else:
            c.setStrokeColor(colors.white)
            c.setLineWidth(3)
            c.line(X(x), Y(y), X(x), Y(y + width))
            c.setStrokeColor(colors.black)
            c.setLineWidth(0.8)
            c.line(X(x), Y(y), X(x + swing * width), Y(y))
            c.arc(X(x - width), Y(y - width), X(x + width), Y(y + width), 0 if swing > 0 else 90, 90)

    def window(x1, y1, x2, y2):
        c.setLineWidth(0.6)
        if y1 == y2:
            for d in (-1.2, 0, 1.2):
                c.line(X(x1), Y(y1 + d), X(x2), Y(y2 + d))
        else:
            for d in (-1.2, 0, 1.2):
                c.line(X(x1 + d), Y(y1), X(x2 + d), Y(y2))

    def label(x, y, text, size=11):
        c.setFont("Helvetica", size)
        c.drawCentredString(X(x), Y(y), text)

    c.setStrokeColor(colors.black)
    # Outer walls
    wall(0, 0, 330, 0, 3)
    wall(330, 0, 330, 180, 3)
    wall(330, 180, 0, 180, 3)
    wall(0, 180, 0, 0, 3)
    # Corridor wall and room partitions
    wall(0, 70, 330, 70)
    wall(110, 70, 110, 180)
    wall(220, 70, 220, 180)
    wall(120, 0, 120, 70)
    if rev_b:
        wall(260, 0, 260, 70)          # new partition: storage room
    # Doors
    door(40, 70, 18, True, 1)
    door(150, 70, 18, True, 1)
    door(228 if rev_b else 270, 70, 18, True, 1)   # meeting room door moved
    door(60, 0, 20, True, 1)                         # main entrance
    if rev_b:
        door(285, 70, 16, True, -1)                  # storage door
    # Windows
    window(20, 180, 90, 180)
    window(130, 180, 200, 180)
    window(240, 180, 310, 180)
    window(330, 100, 330, 160)
    if rev_b:
        window(0, 100, 0, 160)                       # new window, west wall
    # Labels
    label(55, 125, "OFFICE 1")
    label(55, 115, "18.2 m²", 9)
    label(165, 125, "OFFICE 2")
    label(165, 115, "18.2 m²", 9)
    label(275, 125, "MEETING ROOM")
    label(275, 115, "18.2 m²", 9)
    label(60, 35, "RECEPTION")
    if rev_b:
        label(190, 35, "OPEN PLAN")
        label(295, 35, "STORAGE")
    else:
        label(225, 35, "OPEN PLAN")
    # Dimension line
    c.setLineWidth(0.5)
    c.line(X(0), Y(-14), X(330), Y(-14))
    c.line(X(0), Y(-18), X(0), Y(-10))
    c.line(X(330), Y(-18), X(330), Y(-10))
    label(165, -12 + 3, "29 700", 9)
    # Title block
    c.setLineWidth(0.8)
    tb_x, tb_y = page[0] - 120 * mm, 12 * mm
    c.rect(tb_x, tb_y, 100 * mm, 28 * mm)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(tb_x + 4 * mm, tb_y + 20 * mm, "Level 2 office fit-out, floor plan")
    c.setFont("Helvetica", 9)
    c.drawString(tb_x + 4 * mm, tb_y + 13 * mm, "Drawing A-201  Scale 1:100  Fictitious sample")
    c.drawString(tb_x + 4 * mm, tb_y + 6 * mm, "Revision %s" % ("B, storage room added" if rev_b else "A, first issue"))
    c.showPage()
    c.save()


PLAN_EDITS = [
    "Meeting room door moved to the west end of its wall",
    "New partition wall and door create a storage room",
    "New window in the west wall of office 1",
    "Open plan label moved, storage label added",
    "Title block revision changed from A to B",
]


def main():
    root = Path(__file__).resolve().parent.parent
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "public" / "samples"
    out.mkdir(parents=True, exist_ok=True)
    build_contract(out / "service-agreement-v1.pdf", v2=False)
    build_contract(out / "service-agreement-v2.pdf", v2=True)
    build_plan(out / "floor-plan-rev-a.pdf", rev_b=False)
    build_plan(out / "floor-plan-rev-b.pdf", rev_b=True)
    (out / "expected-changes.json").write_text(json.dumps({
        "contract": {"original": "service-agreement-v1.pdf", "changed": "service-agreement-v2.pdf", "edits": EDITS},
        "floorPlan": {"original": "floor-plan-rev-a.pdf", "changed": "floor-plan-rev-b.pdf", "edits": PLAN_EDITS},
    }, indent=2) + "\n")
    for f in sorted(out.iterdir()):
        print("wrote %s (%d bytes)" % (f, f.stat().st_size))


if __name__ == "__main__":
    main()
