import * as THREE from '../vendor/three/three.module.js';
import { FBXLoader } from '../vendor/three/examples/jsm/loaders/FBXLoader.js';

export function initDaiVrDoctor(target) {
  const container = typeof target === 'string' ? document.querySelector(target) : target;
  if (!container || container.dataset.viewerReady) return;
  container.dataset.viewerReady = '1';

  const status = container.querySelector('[data-vr-status]');
  const canvasHost = container.querySelector('[data-vr-canvas]') || container;
  const clock = new THREE.Clock();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
  camera.position.set(0, 1.45, 4.25);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  canvasHost.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8c5de, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(3, 4, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xf3d8ef, 1.15);
  fill.position.set(-4, 2, 3);
  scene.add(fill);

  let model = null;
  let mixer = null;
  let talkAction = null;
  let speaking = false;
  let fallbackMotion = false;
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(function (url) {
    const normalized = String(url || '').replace(/\\/g, '/');
    const basename = normalized.split('/').pop();
    if (/\.png($|\?)/i.test(basename)) return 'assets/vr-doctor/textures/' + basename;
    return url;
  });
  const textureLoader = new THREE.TextureLoader(manager);

  function loadTexture(name) {
    const texture = textureLoader.load('assets/vr-doctor/textures/' + name);
    texture.colorSpace = name.indexOf('BaseColor') >= 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  const doctorTextures = {
    body: {
      map: loadTexture('doc-bod_DefaultMaterial_BaseColor.png'),
      normalMap: loadTexture('doc-bod_DefaultMaterial_Normal.png')
    },
    head: {
      map: loadTexture('doc-head_Midsection_BaseColor.png'),
      normalMap: loadTexture('doc-head_Midsection_Normal.png')
    }
  };

  function setStatus(text) {
    if (status) status.textContent = text || '';
  }

  function resize() {
    const rect = canvasHost.getBoundingClientRect();
    const w = Math.max(1, rect.width || 320);
    const h = Math.max(1, rect.height || 220);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function fitModel(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const targetHeight = 2.45;
    const scale = size.y ? targetHeight / size.y : 1;
    object.scale.multiplyScalar(scale);
    object.position.sub(center.multiplyScalar(scale));
    object.position.y -= 1.1;
    object.rotation.y = -0.08;
  }

  function polishMaterials(object) {
    object.traverse(function (child) {
      if (!child.isMesh) return;
      child.frustumCulled = false;
      child.castShadow = false;
      child.receiveShadow = false;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(function (mat) {
        if (!mat) return;
        const label = String(child.name + ' ' + (mat.name || '')).toLowerCase();
        const tex = /head|midsection|face|skin/.test(label) ? doctorTextures.head : doctorTextures.body;
        mat.map = tex.map;
        mat.normalMap = tex.normalMap;
        mat.side = THREE.DoubleSide;
        if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
        if ('roughness' in mat) mat.roughness = Math.max(mat.roughness || 0.5, 0.72);
        mat.needsUpdate = true;
      });
    });
  }

  const loader = new FBXLoader(manager);
  loader.setPath('assets/vr-doctor/');
  loader.setResourcePath('assets/vr-doctor/textures/');

  loader.load('Doctor.fbx', function (object) {
    model = object;
    polishMaterials(model);
    fitModel(model);
    scene.add(model);
    mixer = new THREE.AnimationMixer(model);
    setStatus('');

    loader.load('Talking.fbx', function (animObject) {
      if (animObject.animations && animObject.animations.length) {
        const clip = animObject.animations[0];
        talkAction = mixer.clipAction(clip, model);
        talkAction.enabled = true;
        talkAction.setLoop(THREE.LoopRepeat);
        talkAction.clampWhenFinished = false;
      } else {
        fallbackMotion = true;
      }
    }, undefined, function () {
      fallbackMotion = true;
    });
  }, undefined, function () {
    setStatus('3D doctor could not load');
    container.classList.add('has-vr-error');
  });

  function startTalking() {
    speaking = true;
    fallbackMotion = fallbackMotion || !talkAction;
    if (talkAction) {
      talkAction.reset();
      talkAction.fadeIn(0.16);
      talkAction.play();
    }
  }

  function stopTalking() {
    speaking = false;
    if (talkAction) talkAction.fadeOut(0.22);
  }

  window.addEventListener('dai-companion-speech-start', startTalking);
  window.addEventListener('dai-companion-speech-end', stopTalking);

  const observer = new ResizeObserver(resize);
  observer.observe(canvasHost);
  resize();

  function tick() {
    const delta = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;
    if (mixer) mixer.update(delta);
    if (model) {
      model.rotation.y += (Math.sin(time * 0.6) * 0.06 - model.rotation.y) * 0.02;
      if (speaking && fallbackMotion) {
        model.position.y = -1.1 + Math.sin(time * 9) * 0.025;
        model.rotation.z = Math.sin(time * 7) * 0.012;
      } else {
        model.position.y += (-1.1 - model.position.y) * 0.08;
        model.rotation.z += (0 - model.rotation.z) * 0.08;
      }
    }
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();
}
