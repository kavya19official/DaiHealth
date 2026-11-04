'use strict';
// Additive local-only archival PDFs. Never grants sharing, validates results or changes care gaps.
const fs = require('node:fs');
const path = require('node:path');
const fixtures = path.join(__dirname, 'fixtures/nivara-records');
const VERSION = 'nivara-pdf-records-v1';
async function seedPatientRecords(client, {uploadDir=process.env.PATIENT_DOCS_DIR || path.join(__dirname, '../backend/data/patient-documents')}={}) {
  if ((await client.query('SELECT 1 FROM dai_local_seed WHERE version=$1', [VERSION])).rows.length) return {alreadySeeded:true};
  const mother = (await client.query("SELECT target_id FROM dai_local_source_link WHERE entity='mother' AND source_id='MOTHER-SYN-0000001'")).rows[0];
  if (!mother) return {skipped:true};
  const files = JSON.parse(fs.readFileSync(path.join(fixtures,'manifest.json'),'utf8'));
  fs.mkdirSync(uploadDir, {recursive:true});
  await client.query('BEGIN');
  try {
    for (const file of files) {
      // The live API installer and launcher use the same filename to avoid duplicates.
      if ((await client.query('SELECT id FROM patient_documents WHERE mother_id=$1 AND original_filename=$2', [mother.target_id,file.filename])).rows.length) continue;
      const bytes=fs.readFileSync(path.join(fixtures,file.filename));
      if (!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))) throw new Error('Invalid fixture PDF');
      const storageKey=VERSION+'-'+file.filename;
      fs.writeFileSync(path.join(uploadDir,storageKey),bytes);
      const row=(await client.query(`INSERT INTO patient_documents(mother_id,title,doc_type,original_filename,mime_type,size_bytes,storage_key,notes,report_date,facility_name,report_category) VALUES($1,$2,$3,$4,'application/pdf',$5,$6,$7,$8,$9,$10) RETURNING id`,[mother.target_id,file.title,file.doc_type,file.filename,bytes.length,storageKey,file.notes,file.report_date,file.facility_name,file.report_category])).rows[0];
      await client.query("INSERT INTO patient_document_events(document_id,actor_id,event_type,detail) VALUES($1,$2,'upload',$3::jsonb)",[row.id,mother.target_id,JSON.stringify({seed:VERSION,synthetic:true})]);
    }
    await client.query('INSERT INTO dai_local_seed(version,source_sha256,counts) VALUES($1,$2,$3)',[VERSION,'existing-synthetic-anc-visits',JSON.stringify({documents:files.length})]);
    await client.query('COMMIT');
    return {documents:files.length};
  } catch(error) { await client.query('ROLLBACK'); throw error; }
}
module.exports={seedPatientRecords};
