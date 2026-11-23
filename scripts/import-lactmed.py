#!/usr/bin/env python3
"""Build a read-only clinician reference from an authorised LactMed Bookshelf archive.
No files are extracted or executed. Records with unrecognised reuse restrictions are skipped.
"""
import argparse, datetime, hashlib, json, pathlib, re, sqlite3, tarfile, urllib.parse, xml.etree.ElementTree as ET

def text(node):
    return re.sub(r'\s+', ' ', ''.join(node.itertext())).strip() if node is not None else ''

def build(archive, output):
    archive, output = pathlib.Path(archive), pathlib.Path(output)
    digest = hashlib.sha256()
    with archive.open('rb') as f:
        for block in iter(lambda: f.read(1024*1024), b''): digest.update(block)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix('.building')
    if temporary.exists(): temporary.unlink()
    db = sqlite3.connect(temporary)
    try:
        db.executescript('CREATE TABLE records(id TEXT PRIMARY KEY,name TEXT NOT NULL,aliases_json TEXT NOT NULL,revised TEXT,sections_json TEXT NOT NULL,source_url TEXT NOT NULL,rights TEXT NOT NULL);CREATE VIRTUAL TABLE names USING fts5(name,aliases,record_id UNINDEXED,tokenize="unicode61 remove_diacritics 2");CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);')
        count, skipped = 0, 0
        with tarfile.open(archive, 'r:gz') as tar:
            license_member = next((m for m in tar.getmembers() if m.isfile() and pathlib.PurePosixPath(m.name).name == 'license.txt'), None)
            if not license_member or license_member.size > 100000: raise ValueError('Archive terms of use missing')
            terms = tar.extractfile(license_member).read().decode('utf-8')
            if 'then the document is in the public domain' not in terms: raise ValueError('Review archive terms before importing')
            for member in tar.getmembers():
                path = pathlib.PurePosixPath(member.name)
                if not member.isfile() or path.suffix != '.nxml': continue
                if path.is_absolute() or '..' in path.parts or member.size > 2*1024*1024: raise ValueError('Invalid archive member')
                raw = tar.extractfile(member).read()
                if b'<!ENTITY' in raw.upper(): raise ValueError('Entity declarations are not accepted')
                root = ET.fromstring(raw)
                rights = ' | '.join(text(e) for tag in ('license', 'copyright-statement') for e in root.findall('.//'+tag))
                if rights and 'public domain' not in rights.lower(): skipped += 1; continue
                part = root.find('book-part'); meta = part.find('book-part-meta') if part is not None else None
                if meta is None: skipped += 1; continue
                ident, name = text(meta.find('book-part-id')), text(meta.find('title-group/title'))
                if not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}',ident) or not name: skipped += 1; continue
                revised = meta.find("pub-history/date[@date-type='revised']")
                revision = None
                if revised is not None:
                    try: revision = datetime.date(int(text(revised.find('year'))),int(text(revised.find('month'))),int(text(revised.find('day')))).isoformat()
                    except (ValueError,TypeError): pass
                aliases = sorted(set(text(e) for e in meta.findall('kwd-group/kwd') if text(e)))
                sections = []
                for section in part.findall('body/sec'):
                    children = section.findall('sec') or [section]
                    for item in children:
                        heading = text(item.find('title'))
                        paragraphs = [text(p) for p in item.findall('p') if text(p)]
                        refs = [text(p) for p in item.findall('ref-list/ref') if text(p)]
                        if paragraphs or refs: sections.append({'heading':heading,'paragraphs':paragraphs+refs})
                if not sections: skipped += 1; continue
                source = 'https://www.ncbi.nlm.nih.gov/books/?term='+urllib.parse.quote(name+' LactMed')
                attribution = rights or 'Public domain under the archive terms; National Institute of Child Health and Human Development (NICHD), LactMed. LactMed is a registered trademark of the U.S. Department of Health and Human Services.'
                db.execute('INSERT INTO records VALUES(?,?,?,?,?,?,?)',(ident,name,json.dumps(aliases,ensure_ascii=False),revision,json.dumps(sections,ensure_ascii=False),source,attribution))
                db.execute('INSERT INTO names(name,aliases,record_id) VALUES(?,?,?)',(name,' '.join(aliases),ident)); count += 1
        if not count: raise ValueError('No reusable reference records found')
        metadata = {'source':'Drugs and Lactation Database (LactMed), NICHD / NCBI Bookshelf','bookshelf_id':'NBK501922','imported_on':datetime.date.today().isoformat(),'archive_sha256':digest.hexdigest(),'records':str(count),'skipped_restricted_or_invalid':str(skipped),'terms':terms,'scope':'Breastfeeding reference only. No automated drug interaction, pregnancy safety or dosing checks.'}
        db.executemany('INSERT INTO metadata VALUES(?,?)',metadata.items()); db.commit(); db.execute('VACUUM'); db.close(); temporary.replace(output)
        print(json.dumps({'records':count,'skipped':skipped,'bytes':output.stat().st_size,'output':str(output)}))
    except Exception:
        db.close(); temporary.unlink(missing_ok=True); raise

if __name__ == '__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('archive'); parser.add_argument('--output',default=str(pathlib.Path(__file__).resolve().parents[1]/'backend/reference-data/lactmed.sqlite')); args=parser.parse_args(); build(args.archive,args.output)
