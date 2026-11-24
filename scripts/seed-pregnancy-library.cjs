'use strict';

const { readFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { addDays } = require('../backend/pregnancyLibrary');
const { normalize } = require('../backend/pregnancyLibraryMedia');

module.exports = async function seedPregnancyLibrary(db) {
  if (process.env.DAI_LOCAL !== 'true' || process.env.DAI_DEMO !== 'true' ||
      process.env.DAI_PREGNANCY_LIBRARY_DEMO !== 'true') return;
  const sample = (await db.query(`SELECT u.id,p.lmp_date::text,p.edd_date::text FROM users u
    JOIN dai_local_source_link s ON s.target_id=u.id AND s.entity='mother'
    JOIN mother_profiles p ON p.user_id=u.id
    WHERE s.source_id='MOTHER-SYN-0000085' AND u.role='mother' AND u.closed_at IS NULL
      AND u.email='mother-syn-0000085@dai-synthetic.invalid'
      AND p.pregnancy_status='pregnant' AND p.lmp_date IS NOT NULL`, [])).rows[0];
  if (!sample) return;
  await db.query('BEGIN');
  try {
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[sample.id]);
    const prior = await db.query('SELECT id FROM pregnancy_library_journeys WHERE mother_id=$1',[sample.id]);
    if (!prior.rows.length) {
      const journey = randomUUID();
      const dateInWeek = week => addDays(sample.lmp_date, (week - 1) * 7 + 2);
      const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
      const records = [
        [6,'diary','Giving the news time to sink in','I made tea and wrote down the little things I want to remember about today.'],
        [11,'memory','A first glimpse','I carried this little picture home in an envelope.',['First Ultrasound'],'ultrasound-demo/profile_14.png'],
        [17,'letter','To my little one','Dear little one, we already have a favorite song for you. I wonder if you’ll like hearing it when you get here.'],
        [19,'memory','A little corner of our home','We started making space for the tiniest new member of our family.',['Family Moments'],'baby-feet.png'],
        [21,'memory','Saving the small things','Today we picked out the first things we want to keep in your memory box.',['Special Memories']],
      ].filter(([week]) => dateInWeek(week) <= today);
      await db.query(`INSERT INTO pregnancy_library_journeys (id,mother_id,start_date,due_date,demo_seeded,updated_at)
        VALUES ($1,$2,$3,$4,true,now())`,[journey,sample.id,sample.lmp_date,sample.edd_date || addDays(sample.lmp_date,280)]);
      for (const [week,kind,title,body,tags = [],asset] of records) {
        const id = randomUUID();
        await db.query(`INSERT INTO pregnancy_library_entries
          (id,mother_id,journey_id,kind,title,body,entry_date,week,tags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id,sample.id,journey,kind,title,body,dateInWeek(week),week,tags]);
        if (asset) {
          const bytes = await readFile(path.join(__dirname,'../frontend/assets',asset));
          const photo = await normalize(new File([bytes],asset,{type:'image/png'}));
          await db.query(`INSERT INTO pregnancy_library_media (id,entry_id,mother_id,mime_type,position,data)
            VALUES ($1,$2,$3,$4,0,$5)`,[randomUUID(),id,sample.id,photo.type,photo.bytes]);
        }
      }
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
};
