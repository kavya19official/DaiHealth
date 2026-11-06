'use strict';
module.exports=function(app,{pool,authenticateToken,authorizeRole}){
 app.post('/api/patient/timeline/:id/centres',authenticateToken,authorizeRole(['mother']),async(req,res)=>{
 res.set('Cache-Control','no-store');const b=req.body||{};if(b.location_consent!==true||!require('./spatialFacilities').valid(b))return res.status(400).json({error:'Allow one location search and provide valid coordinates'});
 try{const row=(await pool.query('SELECT id,title FROM care_milestones WHERE id=$1 AND mother_id=$2',[req.params.id,req.user.id])).rows[0];if(!row)return res.status(404).json({error:'Care step not found'});
 const words=(row.title.toLowerCase().match(/[a-z]{3,}/g)||[]).filter(w=>!['your','first','care','week','visit','test','blood','work','screening','with','registration'].includes(w));
 await pool.query('INSERT INTO timeline_location_consents(mother_id,milestone_id) VALUES($1,$2)',[req.user.id,row.id]);
 const result=await require('./spatialFacilities').nearby(pool,b,words.map(w=>'%'+w+'%'));res.json({...result,notice:'Location used once, not stored. Matches are listed service names, not a clinical recommendation. Distance is not a route or ETA.'});
 }catch{res.status(503).json({error:'Centre search is unavailable. Use Nearby care or contact your care team.'});}
 });
};
