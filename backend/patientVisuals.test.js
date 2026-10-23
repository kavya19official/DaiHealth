'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const V=require('../frontend/js/patient-visuals');
test('recorded trends omit missing measurements, sort dates and preserve actual values',()=>{
 const rows=[{visit_date:'2026-02-01',hb:11.2},{visit_date:'2026-01-01',hb:9.8},{visit_date:'2026-03-01',hb:null},{visit_date:'2026-04-01',hb:'bad'}];
 assert.deepEqual(V.series(rows,'hb').values,[9.8,11.2]);assert.equal(V.series([{visit_date:'2026-01-01',hb:10}],'hb'),null);
 const html=V.trendMarkup(rows,'hb','unsafe"id');assert.match(html,/not a lab reference range/);assert.doesNotMatch(html,/id="unsafe"id/);assert.match(html,/9.8, 11.2/);
 assert.ok(V.series([{visit_date:'2026-01-01',hb:10},{visit_date:'2026-02-01',hb:10}],'hb').points.every(p=>Number.isFinite(p[1])));
});
test('visual metadata cannot inject markup or new category classes',()=>{
 assert.equal(V.reportCategory({report_category:'blood" onclick="bad',doc_type:'lab_report'}),'general');
 assert.equal(V.reportCategory({report_category:'blood'}),'blood');
 assert.match(V.skeleton('<img>'),/&lt;img&gt;/);assert.doesNotMatch(V.skeleton('<img>'),/<img>/);
});
