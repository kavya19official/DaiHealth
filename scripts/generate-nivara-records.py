"""Render archival demo PDFs from the existing synthetic cohort; never infer doses."""
import json
import sqlite3
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'scripts/fixtures/nivara-records'

def generate():
    OUT.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(ROOT / 'synthetic_data/output/dai.db') as db:
        db.row_factory = sqlite3.Row
        visits = list(db.execute('SELECT * FROM anc_visits WHERE pregnancy_id=? ORDER BY visit_date', ('PREGNANCIES-SYN-0000001',)))
        selected = [visits[0], visits[len(visits)//2], visits[-1]]
        manifest = []
        for v in selected:
            doctor = dict(db.execute('SELECT * FROM doctors WHERE doctor_id=?', (v['doctor_id'],)).fetchone())
            facility = dict(db.execute('SELECT * FROM hospitals WHERE hospital_id=?', (v['hospital_id'],)).fetchone())
            for prescription in (True, False):
                kind = 'prescription' if prescription else 'lab_report'
                title = ('Prescription & medicines supplied' if prescription else 'ANC measurements & blood report') + ' - ' + v['visit_date']
                filename = f"nivara-{kind}-{v['visit_date']}.pdf"
                styles = getSampleStyleSheet()
                styles.add(ParagraphStyle(name='DAITitle', fontName='Helvetica-Bold', fontSize=23, leading=29, textColor=colors.HexColor('#51317e'), spaceAfter=18))
                story = [Paragraph('DAI | My care records', styles['DAITitle']), Paragraph(title, styles['Heading2']), Spacer(1, 15)]
                def p(text): return Paragraph(str(text), styles['BodyText'])
                rows = [[p('Patient'), p('Nivara Sethi | MOTHER-SYN-0000001')], [p('Recorded on'), p(v['visit_date'])], [p('Facility (fictional)'), p(facility['name'])], [p('Recorded clinician (fictional)'), p(doctor['name'])], [p('Source visit'), p(v['visit_id'])]]
                table = Table(rows, colWidths=[140, 340], hAlign='LEFT')
                table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#f4f0fa')),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
                story += [table, Spacer(1,22)]
                if prescription:
                    story += [Paragraph('Medication / supplement record', styles['Heading2'])]
                    for label, key in [('Iron and folic acid', 'ifa_given'), ('Calcium', 'calcium_given')]:
                        story += [p(f"<b>{label}</b>: {'Supplied at this visit' if v[key] else 'Not recorded as supplied at this visit'}"), Spacer(1,12)]
                    story += [p('Dose, frequency and duration are not specified in the source dataset. They have not been invented. Confirm the actual prescription with your clinician.'), Spacer(1,18),p('This archival demo reproduces the medicines-supplied fields in the synthetic visit. It is not a signed prescription and must not be used to start, stop or change treatment.')]
                else:
                    story += [Paragraph('Recorded measurements', styles['Heading2'])]
                    for label,value in [('Haemoglobin',f"{v['hb']} g/dL"),('Blood pressure',f"{v['bp_systolic']}/{v['bp_diastolic']} mmHg"),('Weight',f"{v['weight_kg']} kg"),('Urine albumin',v['urine_albumin']),('Urine sugar',v['urine_sugar'])]:
                        story += [p(f'<b>{label}</b>: {value}'),Spacer(1,12)]
                    story += [p('Values copied from the existing synthetic visit. DAI does not interpret these measurements or generate a clinical verdict.')]
                story += [Spacer(1,24),p('<b>Synthetic demonstration document</b> - all people and facilities are fictional. Not a clinical certificate. No clinician signature or verification is implied.')]
                SimpleDocTemplate(str(OUT / filename), title=title, author='DAI synthetic demo', rightMargin=56,leftMargin=56,topMargin=50,bottomMargin=50).build(story)
                manifest.append(dict(title=title, doc_type=kind, filename=filename, report_date=v['visit_date'], facility_name=facility['name'], report_category='general' if prescription else 'blood', notes='Synthetic archival demo copied from '+v['visit_id']+'. Not valid for treatment.'))
        (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
        print(f'Generated {len(manifest)} PDFs from existing synthetic visits.')
if __name__ == '__main__': generate()
