import * as THREE from '../vendor/three/build/three.module.js';

// Deliberately schematic, original geometry. Not a scan or a growth measurement.
export function createMirrorScene(host){
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(34,1,.1,30);camera.position.z=6;
 const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true,powerPreference:'low-power'});
 renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.setSize(512,512,false);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
 renderer.domElement.setAttribute('aria-label','Schematic 3D pregnancy illustration');renderer.domElement.setAttribute('role','img');host.append(renderer.domElement);
 scene.add(new THREE.HemisphereLight(0xfff5ed,0x796875,2.0));const light=new THREE.DirectionalLight(0xffeee0,2.6);light.position.set(-2,4,5);scene.add(light);
 const root=new THREE.Group();scene.add(root);root.rotation.y=-.12;
 const color=getComputedStyle(host).getPropertyValue('--brand').trim()||'#7c3aed';
 const mat=(c,opacity=1)=>new THREE.MeshStandardMaterial({color:c,roughness:.82,metalness:0,transparent:opacity<1,opacity,side:THREE.DoubleSide,depthWrite:opacity===1});
 const skin=mat('#e9bdad'),limb=mat('#ddb09f'),crease=mat('#ac7474'),wallMat=mat('#ce9099',.36),placentaMat=mat('#ad6471'),cordMat=mat('#d8b3ad'),vesselMat=mat('#91546a');
 const textures=[];
 function tissueTexture(seed){const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d'),image=ctx.createImageData(256,256);for(let y=0;y<256;y++)for(let x=0;x<256;x++){const u=x/256,v=y/256,value=128+24*Math.sin(u*29+seed)*Math.sin(v*37)+15*Math.sin(u*91+v*77+seed)+7*Math.sin(u*181-v*133);const i=(y*256+x)*4;image.data[i]=image.data[i+1]=image.data[i+2]=value;image.data[i+3]=255;}ctx.putImageData(image,0,0);const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;textures.push(t);return t;}
 skin.bumpMap=limb.bumpMap=tissueTexture(1);skin.bumpScale=.009;limb.bumpScale=.009;placentaMat.bumpMap=tissueTexture(3);placentaMat.bumpScale=.035;wallMat.bumpMap=tissueTexture(5);wallMat.bumpScale=.018;cordMat.bumpMap=tissueTexture(7);cordMat.bumpScale=.008;

 const groups={uterus:new THREE.Group(),sac:new THREE.Group(),fluid:new THREE.Group(),placenta:new THREE.Group(),cord:new THREE.Group(),baby:new THREE.Group()};Object.values(groups).forEach(g=>root.add(g));
 function ellipsoid(parent,position,scale,material){const m=new THREE.Mesh(new THREE.SphereGeometry(1,32,22),material);m.position.set(...position);m.scale.set(...scale);parent.add(m);return m;}
 function tube(parent,points,radius,material){const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));const m=new THREE.Mesh(new THREE.TubeGeometry(curve,40,radius,8,false),material);parent.add(m);return m;}
 // Open-front cutaway: a soft posterior wall and a continuous tissue-coloured rim.
 const wallGeometry=new THREE.SphereGeometry(1,56,32,Math.PI,Math.PI);
 const womb=new THREE.Mesh(wallGeometry,wallMat);womb.position.set(0,0,-.16);womb.scale.set(1.03,1.32,.68);groups.uterus.add(womb);
 const rimPoints=[];for(let i=0;i<=100;i++){const t=i/100*Math.PI*2,width=.95+.045*Math.cos(t);rimPoints.push([Math.sin(t)*width,Math.cos(t)*1.28,-.13]);}
 tube(groups.uterus,rimPoints,.035,mat('#c78e94',.8));
 // Separate membrane and fluid learning layers; these do not represent measured thickness or volume.
 const sacMat=mat('#e9d5df',.19);sacMat.roughness=.3;
 const sac=ellipsoid(groups.sac,[0,0,-.08],[.91,1.19,.63],sacMat);
 const membraneRim=[];for(let i=0;i<=80;i++){const t=i/80*Math.PI*2;membraneRim.push([Math.sin(t)*.87,Math.cos(t)*1.16,-.04]);}
 tube(groups.sac,membraneRim,.014,mat('#dfbfcd',.7));
 const fluidMat=mat('#d4b9dc',.075);fluidMat.roughness=.2;
 ellipsoid(groups.fluid,[0,0,-.05],[.84,1.1,.58],fluidMat);
 const fluidContours=new THREE.Group();groups.fluid.add(fluidContours);
 for(const y of [-.64,-.1,.48]){const radius=Math.sqrt(1-(y/1.1)**2),points=[];for(let i=0;i<=48;i++){const t=i/48*Math.PI*2;points.push([Math.sin(t)*.82*radius,y,Math.cos(t)*.54*radius]);}tube(fluidContours,points,.006,mat('#d7bfdc',.2));}
 const placenta=ellipsoid(groups.placenta,[.68,.3,-.2],[.29,.59,.16],placentaMat);placenta.rotation.z=-.3;
 const positions=placenta.geometry.attributes.position;for(let i=0;i<positions.count;i++){const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i),n=1+.025*Math.sin(x*19+y*13)*Math.sin(z*17-y*11);positions.setXYZ(i,x*n,y*n,z*n);}placenta.geometry.computeVertexNormals();
 // Branching surface vessels converge near the illustrative cord insertion.
 const vessels=new THREE.Group();vessels.position.copy(placenta.position);vessels.rotation.copy(placenta.rotation);groups.placenta.add(vessels);
 const surface=(x,y)=>[x,y,.16*Math.sqrt(Math.max(.02,1-(x/.29)**2-(y/.59)**2))+.008],insertion=surface(-.12,-.05);
 for(let i=0;i<9;i++){const t=i/9*Math.PI*2,tip=surface(Math.cos(t)*.22,Math.sin(t)*.48),mid=surface((insertion[0]+tip[0])/2,(insertion[1]+tip[1])/2);tube(vessels,[insertion,mid,tip],.009,vesselMat);for(const side of [-1,1])tube(vessels,[mid,surface((mid[0]+tip[0])/2+side*.025,(mid[1]+tip[1])/2),surface(tip[0]+side*.015,tip[1]-side*.025)],.0045,vesselMat);}
 function umbilical(parent,points,radius=.041){const bundle=new THREE.Group();parent.add(bundle);tube(bundle,points,radius,cordMat);const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),frames=curve.computeFrenetFrames(80,false);for(let strand=0;strand<2;strand++){const spiral=[];for(let i=0;i<=80;i++){const t=i/80,angle=t*Math.PI*14+strand*Math.PI,p=curve.getPoint(t).addScaledVector(frames.normals[i],Math.cos(angle)*radius*.78).addScaledVector(frames.binormals[i],Math.sin(angle)*radius*.78);spiral.push(p.toArray());}tube(bundle,spiral,.007,strand?vesselMat:mat('#e0c6bc'));}return bundle;}
 umbilical(groups.cord,[[.57,.25,.1],[.26,.27,.37],[.08,-.04,.44],[-.1,-.1,.33]]);
 const twinCord=umbilical(groups.cord,[[.59,.05,.1],[.42,-.12,.34],[.2,-.4,.42],[.29,-.3,.3]],.033);
 function fetus(parent,mirror=false){const g=new THREE.Group();parent.add(g);
  ellipsoid(g,[-.23,.48,.1],[.37,.43,.34],skin);ellipsoid(g,[-.31,.25,.24],[.25,.2,.25],skin);
  ellipsoid(g,[-.43,.37,.37],[.06,.055,.06],limb);ellipsoid(g,[-.53,.5,.15],[.07,.1,.05],limb);ellipsoid(g,[-.55,.5,.17],[.03,.065,.025],crease);
  tube(g,[[-.45,.52,.37],[-.35,.49,.42],[-.29,.5,.4]],.012,crease);
  tube(g,[[-.39,.33,.43],[-.33,.31,.45],[-.28,.33,.43]],.009,crease);
  const body=ellipsoid(g,[-.03,-.13,.03],[.32,.44,.26],skin);body.rotation.z=.28;
  tube(g,[[-.18,.1,.19],[-.43,-.06,.33],[-.4,.24,.4]],.08,limb);ellipsoid(g,[-.4,.26,.39],[.09,.12,.07],skin);
  tube(g,[[.15,.05,.16],[.34,-.14,.28],[.04,-.11,.36]],.075,skin);
  tube(g,[[.1,-.4,.04],[.37,-.43,.18],[.23,-.09,.29]],.105,skin);ellipsoid(g,[.23,-.04,.3],[.1,.14,.075],skin);
  tube(g,[[-.13,-.44,.07],[-.31,-.59,.22],[-.03,-.52,.35]],.1,limb);ellipsoid(g,[.03,-.51,.36],[.15,.08,.07],skin);
  for(let finger=0;finger<4;finger++){const x=-.46+finger*.028;tube(g,[[x,.26,.43],[x-.01,.34,.44],[x+.01,.37,.42]],.013,skin);}tube(g,[[-.46,.26,.42],[-.5,.29,.43],[-.48,.31,.43]],.017,skin);
  for(let toe=0;toe<5;toe++)ellipsoid(g,[.12-toe*.032,-.5,.41],[.026-toe*.002,.028,.025],skin);
  g.rotation.z=mirror?.22:-.18;return g;
 }
 const baby1=fetus(groups.baby),baby2=fetus(groups.baby,true);baby2.visible=false;
 // Give each structure its own materials so selection never changes another structure.
 const discarded=new Set();
 for(const group of Object.values(groups)){const copies=new Map();group.traverse(o=>{if(!o.material)return;const old=o.material;if(!copies.has(old)){const copy=old.clone();copy.userData.baseOpacity=old.opacity;copies.set(old,copy);discarded.add(old);}o.material=copies.get(old);});}
 discarded.forEach(material=>material.dispose());
 // Cache vertices in structure coordinates so vessels and their tissue curl together.
 scene.updateMatrixWorld(true);
 const peelKeys=['uterus','sac','fluid','placenta','cord'],peels={};
 for(const key of peelKeys){const group=groups[key],meshes=[];
  group.traverse(mesh=>{if(!mesh.geometry)return;
   const toGroup=new THREE.Matrix4().copy(group.matrixWorld).invert().multiply(mesh.matrixWorld);
   meshes.push({mesh,base:mesh.geometry.attributes.position.array.slice(),toGroup,fromGroup:toGroup.clone().invert()});
  });
  peels[key]={value:0,start:0,target:0,started:0,meshes};
 }
 let config={week:28,layer:'all',twins:false,revealDepth:0},disposed=false,animationFrame=null;
 const duration=1100,point=new THREE.Vector3();
 function deform(key,progress){const group=groups[key],state=peels[key];
  group.visible=progress<.999;group.position.set(key==='fluid'?0:-1.0*progress,key==='fluid'?0:.24*progress,key==='fluid'?0:.65*progress);group.rotation.z=key==='fluid'?0:-.32*progress;
  for(const {mesh,base,toGroup,fromGroup} of state.meshes){const positions=mesh.geometry.attributes.position;
   for(let i=0;i<positions.count;i++){
    point.fromArray(base,i*3).applyMatrix4(toGroup);
    // A moving fold travels from the upper edge down through the structure.
    const folded=Math.max(0,progress*3.7-(1.4-point.y)),radius=.52,angle=Math.min(Math.PI*1.3,folded/radius);
    if(key==='fluid'){point.multiplyScalar(1-progress*.12);}else{point.y+=folded-radius*Math.sin(angle);point.z+=radius*(1-Math.cos(angle));}
    point.applyMatrix4(fromGroup);positions.setXYZ(i,point.x,point.y,point.z);
   }
   positions.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.frustumCulled=false;
   const m=mesh.material,fade=1-THREE.MathUtils.smoothstep(progress,key==='fluid'?0:.65,1);
   m.opacity=m.userData.displayOpacity*fade;m.transparent=m.opacity<1;m.depthWrite=!m.transparent;
  }
 }
 function animate(time){animationFrame=null;if(disposed)return;let moving=false;
  for(const key of peelKeys){const state=peels[key];
   if(state.value!==state.target){const t=Math.max(0,Math.min(1,(time-state.started)/duration)),eased=t*t*(3-2*t);
    state.value=t===1?state.target:state.start+(state.target-state.start)*eased;deform(key,state.value);moving ||= t<1;
   }
  }
  host.dataset.peelAnimating=String(moving);draw();if(moving)animationFrame=requestAnimationFrame(animate);
 }
 function transitionPeels(){const time=performance.now(),instant=config.reducedMotion??matchMedia('(prefers-reduced-motion: reduce)').matches;
  for(const [index,key]of peelKeys.entries()){const state=peels[key],target=index<(config.revealDepth||0)?1:0;
   if(target!==state.target){state.start=state.value;state.target=target;state.started=time+index*65;}
   if(instant){state.value=state.target;deform(key,state.value);}else deform(key,state.value);
  }
  if(instant){cancelAnimationFrame(animationFrame);animationFrame=null;host.dataset.peelAnimating='false';}
  else if(!animationFrame&&peelKeys.some(key=>peels[key].value!==peels[key].target)){host.dataset.peelAnimating='true';animationFrame=requestAnimationFrame(animate);}
 }

 function draw(){if(!disposed)renderer.render(scene,camera);}
 function update(next={}){config={...config,...next};
  const size=.54+(config.week-12)/28*.4;
  for(const [i,b] of [baby1,baby2].entries()){b.scale.setScalar(config.twins?size*.67:size);b.position.set(config.twins?(i===0?-.34:.34):-.1,config.twins?(i===0?.2:-.25):-.08,0);}
  baby2.visible=config.twins;
  twinCord.visible=config.twins;
  for(const [key,g]of Object.entries(groups)){g.traverse(o=>{if(!o.material)return;const selected=config.layer===key,dim=config.layer!=='all'&&!selected,m=o.material;m.opacity=m.userData.baseOpacity*(dim?.2:1);if(key==='uterus'&&selected&&o===womb)m.opacity=.55;m.userData.displayOpacity=m.opacity;m.transparent=m.opacity<1;m.depthWrite=!m.transparent;if(m.emissive){m.emissive.set(selected?color:'#000000');m.emissiveIntensity=selected?.06:0;}});}
  transitionPeels();draw();
 }
 function hotspots(){scene.updateMatrixWorld(true);camera.updateMatrixWorld();const points={uterus:[-.8,.64,0],sac:[-.67,-.62,.18],fluid:[.5,-.7,.28],placenta:[.72,.35,.12],cord:[.25,.04,.47],baby:[-.43,-.2,.35]},result={};for(const [key,point]of Object.entries(points)){const p=root.localToWorld(new THREE.Vector3(...point)).project(camera);result[key]={x:(p.x+1)*50,y:(1-p.y)*50};}const b=baby1.localToWorld(new THREE.Vector3(0,-.05,.3)).project(camera);result.baby={x:(b.x+1)*50,y:(1-b.y)*50};return result;}
 update();return {canvas:renderer.domElement,update,draw,hotspots,rotate(delta){root.rotation.y=Math.max(-.65,Math.min(.65,root.rotation.y+delta));draw();},dispose(){disposed=true;cancelAnimationFrame(animationFrame);host.dataset.peelAnimating='false';const geometries=new Set(),materials=new Set();scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();}};
}
