import * as THREE from '../vendor/three/build/three.module.js';
import {OrbitControls} from '../vendor/three/examples/jsm/controls/OrbitControls.js';
// Original, simplified teaching geometry; not fitted to any person's anatomy.
export function createUterusLearningScene(host,{onProject=()=>{}}={}){
 const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power',preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.localClippingEnabled=true;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
 const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Educational uterus anatomy; drag to rotate, pinch to zoom');host.append(canvas);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,1,.1,40);camera.position.set(0,.1,6.7);
 const controls=new OrbitControls(camera,canvas);controls.enablePan=false;controls.enableDamping=true;controls.dampingFactor=.065;controls.minDistance=2.8;controls.maxDistance=12;controls.autoRotateSpeed=.35;
 scene.add(new THREE.HemisphereLight(0xfff5ee,0x7f6d93,2.1));const key=new THREE.DirectionalLight(0xffeee7,2.5);key.position.set(-3,4,5);scene.add(key);const rim=new THREE.DirectionalLight(0xe0c8f5,2);rim.position.set(3,1,-2);scene.add(rim);
 const anatomy=new THREE.Group();scene.add(anatomy);
 const mat=(color,opacity=1)=>new THREE.MeshPhysicalMaterial({color,roughness:.55,clearcoat:.18,transparent:opacity<1,opacity,side:THREE.DoubleSide,depthWrite:opacity===1});
 const wallMat=mat('#c58a9d'),innerMat=mat('#e8b7ba'),tubeMat=mat('#c994a6'),ovaryMat=mat('#d7afbb');const plane=new THREE.Plane(new THREE.Vector3(0,0,-1),.9);wallMat.clippingPlanes=[plane];
 function ellipsoid(group,position,scale,material){const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,32,22),material);mesh.position.set(...position);mesh.scale.set(...scale);group.add(mesh);return mesh;}
 function tube(group,points,radius,material){const mesh=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),40,radius,8,false),material);group.add(mesh);return mesh;}
 const profile=[new THREE.Vector2(0,-1.27),new THREE.Vector2(.18,-1.24),new THREE.Vector2(.21,-.95),new THREE.Vector2(.25,-.65),new THREE.Vector2(.44,-.2),new THREE.Vector2(.69,.45),new THREE.Vector2(.75,.8),new THREE.Vector2(.61,1.06),new THREE.Vector2(.34,1.19),new THREE.Vector2(0,1.24)];
 const smooth=new THREE.CatmullRomCurve3(profile.map(p=>new THREE.Vector3(p.x,p.y,0))).getPoints(80).map(p=>new THREE.Vector2(Math.max(0,p.x),p.y));
 const outer=new THREE.Mesh(new THREE.LatheGeometry(smooth,64),wallMat);outer.scale.z=.64;anatomy.add(outer);const wallVertices=outer.geometry.attributes.position.array.slice();
 // Independent inner lining and cavity make the clipping/transparency controls informative.
 const lining=new THREE.Mesh(new THREE.LatheGeometry(smooth,56),innerMat);lining.scale.set(.77,.83,.36);lining.position.y=.06;anatomy.add(lining);
 const cavity=ellipsoid(anatomy,[0,.26,.02],[.2,.65,.17],mat('#9e667e'));
 const cervix=ellipsoid(anatomy,[0,-1.09,0],[.235,.23,.19],tubeMat);ellipsoid(anatomy,[0,-1.25,.11],[.075,.035,.04],mat('#976478'));
 const tubeGroup=new THREE.Group(),ovaries=new THREE.Group();anatomy.add(tubeGroup,ovaries);
 for(const side of [-1,1]){
  tube(tubeGroup,[[side*.58,.83,0],[side*.95,1.02,.02],[side*1.43,1.0,.02],[side*1.63,.73,.06]],.07,tubeMat);
  for(let i=0;i<5;i++)tube(tubeGroup,[[side*1.61,.77,.05],[side*(1.67+i*.025),.65,.04+(i-2)*.05],[side*(1.55+i*.04),.51,.04+(i-2)*.065]],.016,tubeMat);
  ellipsoid(ovaries,[side*1.37,.39,.06],[.25,.16,.17],ovaryMat);
  for(let i=0;i<7;i++){const a=i/7*Math.PI*2;ellipsoid(ovaries,[side*1.37+Math.sin(a)*.17,.39+Math.cos(a)*.1,.2],[.035,.027,.025],innerMat);}
 }
 const halo=new THREE.Mesh(new THREE.RingGeometry(1.75,1.77,80),new THREE.MeshBasicMaterial({color:'#b99acb',transparent:true,opacity:.18,side:THREE.DoubleSide}));halo.rotation.x=-Math.PI/2;halo.position.y=-1.55;scene.add(halo);
 let disposed=false,frame=null,visible=true,selected='fundus',cut=0,ghost=false,spin=false,pulse=false,reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,focus=null,last=0,touched=0,inTick=false,wasPulsing=false;
 const points={fundus:[0,1.18,.28],muscle:[-.6,.05,.38],lining:[.17,.36,.23],cervix:[0,-1.16,.2],tubes:[1.05,.99,.1],ovaries:[-1.4,.4,.24]};
 function project(){anatomy.updateMatrixWorld(true);const result={};for(const [id,coords]of Object.entries(points)){const p=anatomy.localToWorld(new THREE.Vector3(...coords)).project(camera);result[id]={x:(p.x+1)*50,y:(1-p.y)*50,visible:p.z<1&&p.x>-.97&&p.x<.97&&p.y>-.95&&p.y<.9};}onProject(result);}
 function draw(){if(disposed||!visible)return;renderer.render(scene,camera);project();}
 function tick(time){frame=null;if(disposed||!visible)return;inTick=true;const delta=Math.min((time-last)/1000,.05);last=time;
  controls.autoRotate=spin&&!reduced&&!focus&&time-touched>3500;
  if(focus){const t=reduced?1:1-Math.exp(-delta*7);camera.position.lerp(focus.position,t);controls.target.lerp(focus.target,t);if(camera.position.distanceTo(focus.position)<.008){camera.position.copy(focus.position);controls.target.copy(focus.target);focus=null;}}
  const pulsing=pulse&&!reduced;
  if(pulsing||wasPulsing){const positions=outer.geometry.attributes.position;for(let i=0;i<positions.count;i++){const y=wallVertices[i*3+1],factor=pulsing?1-.025*Math.pow((1+Math.sin(time*.002-y*2))/2,3):1;positions.setXYZ(i,wallVertices[i*3]*factor,y,wallVertices[i*3+2]*factor);}positions.needsUpdate=true;outer.geometry.computeVertexNormals();}wasPulsing=pulsing;
  const changed=controls.update();draw();inTick=false;if(changed||focus||((spin||pulse)&&!reduced))frame=requestAnimationFrame(tick);
 }
 function wake(){if(!disposed&&visible&&!frame&&!inTick){last=performance.now();frame=requestAnimationFrame(tick);}}
 controls.addEventListener('start',()=>{touched=performance.now();focus=null;wake();});controls.addEventListener('change',()=>{if(!inTick){draw();wake();}});controls.addEventListener('end',()=>{touched=performance.now();});
 canvas.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();focus=null;camera.position.applyAxisAngle(new THREE.Vector3(e.key.includes('Left')||e.key.includes('Right')?0:1,e.key.includes('Left')||e.key.includes('Right')?1:0,0),e.key==='ArrowLeft'||e.key==='ArrowUp'?.12:-.12);controls.update();draw();}});
 function resize(){if(!host.clientWidth||!host.clientHeight)return;camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();renderer.setSize(host.clientWidth,host.clientHeight,false);if(!focus){camera.position.set(0,.1,Math.max(6.5,4.8/camera.aspect));controls.target.set(0,0,0);}draw();}
 const ro=new ResizeObserver(resize);ro.observe(host);const io=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting&&!document.hidden;if(visible)wake();else{cancelAnimationFrame(frame);frame=null;}});io.observe(host);const visibility=()=>{visible=!document.hidden;if(visible)wake();else{cancelAnimationFrame(frame);frame=null;}};document.addEventListener('visibilitychange',visibility);
 function update(options={}){({cut=cut,ghost=ghost,spin=spin,pulse=pulse,reducedMotion:reduced=reduced}=options);plane.constant=.9-cut*1.35;wallMat.opacity=ghost?.23:1;wallMat.transparent=ghost;wallMat.depthWrite=!ghost;draw();wake();}
 function focusPart(id){selected=id;if(!points[id])return;if(id==='lining'){cut=Math.max(cut,.62);update({cut});}const target=new THREE.Vector3(...points[id]);focus={target,position:target.clone().add(new THREE.Vector3(0,.1,4.2))};for(const m of [wallMat,innerMat,tubeMat,ovaryMat]){m.emissive.set('#000000');m.emissiveIntensity=0;}const material=id==='lining'?innerMat:id==='ovaries'?ovaryMat:id==='tubes'||id==='cervix'?tubeMat:wallMat;material.emissive.set('#7c3aed');material.emissiveIntensity=.08;wake();}
 resize();wake();return {canvas,update,focus:focusPart,zoom(f){focus=null;const v=camera.position.clone().sub(controls.target);v.setLength(THREE.MathUtils.clamp(v.length()*f,2.8,12));camera.position.copy(controls.target).add(v);controls.update();draw();},reset(){focus={target:new THREE.Vector3(),position:new THREE.Vector3(0,.1,Math.max(6.5,4.8/camera.aspect))};wake();},dispose(){disposed=true;cancelAnimationFrame(frame);ro.disconnect();io.disconnect();document.removeEventListener('visibilitychange',visibility);controls.dispose();const geometries=new Set(),materials=new Set();scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());renderer.dispose();renderer.forceContextLoss();canvas.remove();}};
}
