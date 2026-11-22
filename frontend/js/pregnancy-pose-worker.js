// Both optional computer-vision tasks run locally in one worker; no frame leaves this device.
let pose=null,hands=null,vision=null,HandLandmarker=null,handWanted=false,handLoading=false,frameCounter=0;
async function loadHands(){
 if(!handWanted||hands||handLoading||!vision)return;handLoading=true;
 try{
  const candidate=await HandLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:new URL('../vendor/mediapipe/hand_landmarker.task',self.location.href).href,delegate:'CPU'},runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.7,minHandPresenceConfidence:.7,minTrackingConfidence:.7});
  if(!handWanted){candidate.close();return;}hands=candidate;self.postMessage({type:'hands-ready'});
 }catch(error){self.postMessage({type:'hands-error',message:error.message});}
 finally{handLoading=false;}
}
self.onmessage=async({data})=>{
 try{
  if(data.type==='init'){handWanted=!!data.hands;
   const library=await import('../vendor/mediapipe/vision_bundle.mjs');HandLandmarker=library.HandLandmarker;
   vision=await library.FilesetResolver.forVisionTasks(new URL('../vendor/mediapipe/wasm/',self.location.href).href);
   pose=await library.PoseLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:new URL('../vendor/mediapipe/pose_landmarker_lite.task',self.location.href).href,delegate:'CPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.6,minPosePresenceConfidence:.6,minTrackingConfidence:.6,outputSegmentationMasks:false});
   self.postMessage({type:'ready'});loadHands();
  }else if(data.type==='hands'){
   handWanted=!!data.enabled;if(handWanted){if(hands)self.postMessage({type:'hands-ready'});else loadHands();}else{hands?.close();hands=null;}
  }else if(data.type==='frame'&&pose){
   try{
    const detectBody=data.pose!==false&&(!hands||++frameCounter%2===0);
    const result=detectBody?pose.detectForVideo(data.image,data.time):null;
    let hand=null;if(handWanted&&hands){try{hand=hands.detectForVideo(data.image,data.time).landmarks[0]||null;}catch(error){hands.close();hands=null;handWanted=false;self.postMessage({type:'hands-error',message:error.message});}}
    self.postMessage({type:'pose',points:result?.landmarks[0]||null,hand,handReady:!!hands&&handWanted});
   }finally{data.image.close();}
  }
 }catch(error){data.image?.close();self.postMessage({type:'error',message:error.message});}
};
