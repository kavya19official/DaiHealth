// Decode supplied files and check that the animations can drive the doctor rig.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FBXLoader} from '../frontend/vendor/three/examples/jsm/loaders/FBXLoader.js';
import * as THREE from '../frontend/vendor/three/build/three.module.js';
import {prepareClip} from '../frontend/js/daya-avatar.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../frontend/assets/dr-daya');
// Texture decoding is checked visually in-browser; only geometry/rig data is needed here.
globalThis.window=globalThis;
globalThis.document={createElementNS(){return {addEventListener(){},removeEventListener(){},set src(value){}};}};
function load(name){const bytes=fs.readFileSync(path.join(root,name));return new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');}
const model=load('Doctor.fbx');let skins=0;model.traverse(o=>{if(o.isSkinnedMesh)skins++;});assert.ok(skins>0);
const bones=new Set();model.traverse(o=>{if(o.isBone)bones.add(o.name);});
for(const name of ['idle.fbx','Talking.fbx']){
 const source=load(name);assert.ok(source.animations.length);
 const clip=prepareClip(source.animations[0],model);assert.ok(clip.tracks.length>15);
 assert.ok(clip.tracks.every(t=>bones.has(t.name.split('.')[0])));
 assert.ok(clip.tracks.every(t=>t.name.endsWith('.quaternion')),'root translation must not move avatar out of frame');
 const mixer=new THREE.AnimationMixer(model);const action=mixer.clipAction(clip);action.play();
 const arm=model.getObjectByName('Bip001_R_UpperArm');assert.ok(arm);
 mixer.setTime(.1);const first=arm.quaternion.clone();mixer.setTime(1.5);assert.ok(first.angleTo(arm.quaternion)>.001,'arm gesture must animate');
 for(const time of [.01,1,2,3]){
  mixer.setTime(time);model.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(model,true),size=bounds.getSize(new THREE.Vector3());
  assert.ok(Number.isFinite(size.y)&&size.y>0);assert.ok(size.x/size.y<2,'no exploding rig');
 }
 mixer.stopAllAction();mixer.uncacheRoot(model);
 console.log(`PASS ${name}: ${clip.tracks.length} matching rotation tracks; animated arms; finite full-body bounds.`);
}
for(const name of ['Doc-D-1024.png','Doc-N-1024.png','Doc-R-1024.png','Doc-head-D-512.png','Doc-head-N-512.png','Doc-head-R-512.png'])assert.ok(fs.statSync(path.join(root,'textures',name)).size>0);
console.log('PASS model, textures and animations; visual/voice checks remain browser dependent.');
