/* Separate encrypted private space. Passphrase/key never persisted or sent to an API. */
(function(root){'use strict';
 const DB='dai-sukoon-private-v1',STORE='vault',encoder=new TextEncoder();
 const encode=bytes=>{let out='';for(const byte of new Uint8Array(bytes))out+=String.fromCharCode(byte);return btoa(out);};
 const decode=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
 async function store(mode,work){const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(DB,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode);let result;work(tx.objectStore(STORE),value=>result=value,tx);tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||Error('Storage unavailable'));tx.onabort=()=>reject(Error('Private space changed in another tab. Lock and reopen it.'));});}finally{db.close();}}
 async function ownerHash(owner){return encode(await crypto.subtle.digest('SHA-256',encoder.encode(location.origin+'|sukoon|'+owner)));}
 async function derive(pass,salt){const material=await crypto.subtle.importKey('raw',encoder.encode(pass),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:decode(salt),iterations:400000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
 root.createSukoonVault=function(owner){let key=null,payload=null,envelope=null,hash=null,epoch=0,serial=Promise.resolve();
  const aad=()=>encoder.encode('sukoon|1|'+hash);
  async function read(){hash=await ownerHash(owner);return store('readonly',(s,done)=>{const r=s.get(hash);r.onsuccess=()=>done(r.result||null);});}
  async function unlock(pass,{create=false}={}){if(typeof pass!=='string'||pass.length<12)throw Error('Use a private passphrase of at least 12 characters.');const token=++epoch,record=await read();if(!record&&!create)throw Error('Create your private space first.');const salt=record?.salt||encode(crypto.getRandomValues(new Uint8Array(24))),nextKey=await derive(pass,salt);let data;
   if(record){if(record.version!==1||record.ownerHash!==hash)throw Error('This backup belongs to another private space.');try{data=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(record.iv),additionalData:aad()},nextKey,decode(record.cipher))));}catch{throw Error('Could not unlock. Check your passphrase.');}}else data=root.SukoonModel.fresh();
   if(token!==epoch)throw Error('Unlock cancelled.');key=nextKey;payload=data;envelope=record||{version:1,ownerHash:hash,salt};if(!record)await save(data);return structuredClone(payload);
  }
  function save(next){const token=epoch,copy=structuredClone(next);serial=serial.catch(()=>{}).then(async()=>{if(!key||token!==epoch)throw Error('Unlock Sukoon to save.');const iv=crypto.getRandomValues(new Uint8Array(12)),current=envelope,revision=crypto.randomUUID();const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad()},key,encoder.encode(JSON.stringify(copy)));if(token!==epoch)throw Error('Private space locked.');const updated={...current,iv:encode(iv),cipher:encode(cipher),revision};
    await store('readwrite',(s,done,tx)=>{const r=s.get(hash);r.onsuccess=()=>{if(token!==epoch||(r.result?.revision||null)!==(current.revision||null)){tx.abort();return;}s.put(updated,hash);done(true);};});if(token!==epoch)return;envelope=updated;payload=copy;
   });return serial;
  }
  function lock(){epoch++;key=null;payload=null;envelope=null;}
  return {exists:async()=>!!await read(),unlock,save,lock,isUnlocked:()=>!!key,snapshot:()=>payload?structuredClone(payload):null,encrypted:()=>envelope?.cipher?structuredClone(envelope):null,async restore(record){const expected=await ownerHash(owner);if(record?.version!==1||record.ownerHash!==expected||!record.salt||!record.iv||!record.cipher)throw Error('This backup belongs to another account or is invalid.');lock();hash=expected;await store('readwrite',(s,done)=>{s.put(structuredClone(record),hash);done(true);});},async remove(){lock();hash=await ownerHash(owner);await store('readwrite',(s,done)=>{s.delete(hash);done(true);});}};
 };
})(window);
