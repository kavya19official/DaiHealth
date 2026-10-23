import * as THREE from '../vendor/three/build/three.module.js';
import { FBXLoader } from '../vendor/three/examples/jsm/loaders/FBXLoader.js';

// The supplied Doctor FBX is Z-up; the Mixamo exports are Y-up.
// Animate the first occurrence of each bone: the original FBX contains identity
// helper bones with duplicate names beneath it, which must not be animated twice.
export function prepareClip(sourceClip, model) {
  const clip=sourceClip.clone();
  const names=new Set(); model.traverse(o=>{if(o.isBone)names.add(o.name);});
  clip.tracks=clip.tracks.filter(track=>track.name.endsWith('.quaternion') && names.has(track.name.split('.')[0]));
  const root=clip.tracks.find(t=>t.name==='Bip001.quaternion');
  if(root){
    const convert=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2);
    const q=new THREE.Quaternion();
    for(let i=0;i<root.values.length;i+=4){q.fromArray(root.values,i).premultiply(convert);q.toArray(root.values,i);}
  }
  return clip;
}

export async function createAvatar(host, base) {
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(32,1,.01,100);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff,0x806789,2.2));
  const key=new THREE.DirectionalLight(0xfff6ed,2.6);key.position.set(2,4,4);scene.add(key);
  const fill=new THREE.DirectionalLight(0xe4dcff,1.4);fill.position.set(-3,2,2);scene.add(fill);
  const url=path=>new URL(path,base).href;
  const assets=url('assets/dr-daya/');
  const manager=new THREE.LoadingManager();
  const textureNames={
    'doc-bod_DefaultMaterial_BaseColor.png':'Doc-D-1024.png',
    'doc-bod_DefaultMaterial_Roughness.png':'Doc-R-1024.png',
    'doc-bod_DefaultMaterial_Normal.png':'Doc-N-1024.png',
    'doc-head_Midsection_BaseColor.png':'Doc-head-D-512.png',
    'doc-head_Midsection_Roughness.png':'Doc-head-R-512.png',
    'doc-head_Midsection_Normal.png':'Doc-head-N-512.png'
  };
  manager.setURLModifier(value=>{const name=value.split(/[\\/]/).pop();return textureNames[name]?assets+'textures/'+textureNames[name]:value;});
  const loader=new FBXLoader(manager);
  let model;
  try {model=await loader.loadAsync(assets+'Doctor.fbx');}catch(error){renderer.dispose();renderer.domElement.remove();throw error;}
  const textureLoader=new THREE.TextureLoader();
  const textures=await Promise.all(['Doc-D-1024.png','Doc-N-1024.png','Doc-R-1024.png','Doc-head-D-512.png','Doc-head-N-512.png','Doc-head-R-512.png'].map(n=>textureLoader.loadAsync(assets+'textures/'+n)));
  textures[0].colorSpace=textures[3].colorSpace=THREE.SRGBColorSpace;
  const body=new THREE.MeshStandardMaterial({map:textures[0],normalMap:textures[1],roughnessMap:textures[2],roughness:.85,metalness:0,side:THREE.DoubleSide});
  const head=new THREE.MeshStandardMaterial({map:textures[3],normalMap:textures[4],roughnessMap:textures[5],roughness:.9,side:THREE.DoubleSide});
  const originalMaterials=new Set();
  model.traverse(o=>{
    if(!o.isMesh)return;
    (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>originalMaterials.add(m));
    // Props were placed for the original tablet animation, not the new gestures.
    if(/^(pad|pen|glass)$/.test(o.name)){o.visible=false;return;}
    o.material=o.name==='head'?head:body;o.frustumCulled=false;
  });
  const anchor=new THREE.Group();anchor.add(model);scene.add(anchor);
  const mixer=new THREE.AnimationMixer(model);
  const actions={};
  const clips=await Promise.all(['idle.fbx','Talking.fbx'].map(n=>loader.loadAsync(assets+n)));
  for(let i=0;i<clips.length;i++){
    if(!clips[i].animations[0])throw new Error('Animation file contains no clip');
    const action=mixer.clipAction(prepareClip(clips[i].animations[0],model));
    action.setLoop(THREE.LoopRepeat);actions[i===0?'idle':'talking']=action;
  }
  actions.idle.play();mixer.update(.01);model.updateMatrixWorld(true);
  // Skinned geometry bounds must be measured after sampling the first pose.
  const bounds=new THREE.Box3().setFromObject(model,true);
  const size=bounds.getSize(new THREE.Vector3());
  if(!Number.isFinite(size.y)||size.y<=0)throw new Error('Invalid avatar bounds');
  anchor.scale.setScalar(2.6/size.y);
  const centre=bounds.getCenter(new THREE.Vector3());
  model.position.x-=centre.x;model.position.y-=bounds.min.y;model.position.z-=centre.z;
  camera.position.set(0,1.4,6);camera.lookAt(0,1.35,0);
  let current=actions.idle,visible=true,talking=false,disposed=false,last=performance.now(),frame;
  const resize=()=>{
    const w=host.clientWidth||260,h=host.clientHeight||440;
    renderer.setSize(w,h,false);camera.aspect=w/h;
    // Fit both the full body height and shoulder width, including narrow phones.
    camera.position.z=Math.max(5.6,2.2/camera.aspect);camera.updateProjectionMatrix();
  };
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const loop=now=>{
    if(disposed)return;frame=requestAnimationFrame(loop);
    const delta=Math.min((now-last)/1000,.05);last=now;
    if(!visible || document.hidden)return;
    if(!reduced.matches)mixer.update(delta);
    renderer.render(scene,camera);
  };frame=requestAnimationFrame(loop);
  host.dataset.avatarReady='true';
  return {
    setTalking(value){talking=Boolean(value);const next=actions[talking?'talking':'idle'];if(next===current)return;current.fadeOut(.25);next.reset().fadeIn(.25).play();current=next;host.dataset.animation=talking?'talking':'idle';},
    setVisible(value){visible=value;},
    dispose(){disposed=true;cancelAnimationFrame(frame);observer.disconnect();mixer.stopAllAction();model.traverse(o=>o.geometry?.dispose());originalMaterials.forEach(m=>m.dispose());body.dispose();head.dispose();textures.forEach(t=>t.dispose());renderer.dispose();renderer.domElement.remove();}
  };
}
