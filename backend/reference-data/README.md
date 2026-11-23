# LactMed clinician reference

`lactmed.sqlite` contains 1,966 drug/substance records from the user-supplied NCBI Bookshelf archive `lactmed_NBK501922.tar.gz`, imported on 2026-11-23. Ten supporting documents (glossary, contents, disclaimer and format documentation) are excluded from medicine search. The 202 MB archive and its PDFs are not included.

Source: **Drugs and Lactation Database (LactMed), National Institute of Child Health and Human Development, NCBI Bookshelf, NBK501922**. LactMed is a registered trademark of the U.S. Department of Health and Human Services.

Archive SHA-256: `7ede21f401ed149689e23636e4ba85ac239bb632829c50db78c1cb66ecca956a`.

The archive terms require checking each document's rights statement. All imported XML documents have no licence/copyright statement and therefore fall under the archive's public-domain provision. The original terms are preserved in `LACTMED-LICENSE.txt` and in the SQLite metadata. The importer skips records with unrecognised reuse restrictions.

This is a dated breastfeeding reference snapshot. It does not establish pregnancy safety, identify drug interactions, prescribe doses, match every Indian brand or provide a clinical safety verdict. The UI preserves source wording and revision dates, links to a current NCBI search, and never changes a prescription. No reference content is sent to an AI model.

Rebuild using Python's standard library:

```sh
python3 scripts/import-lactmed.py /path/to/lactmed_NBK501922.tar.gz
```

The importer reads XML directly from the archive without extracting or executing its files. The server queries the read-only SQLite reference on demand with a bounded page cache; it does not load the full database into memory. Access is restricted to authenticated, verified doctors. Name/alias searches are POST requests so the search text is not included in request URL logs. Patient identifiers and records are not part of this reference database.
