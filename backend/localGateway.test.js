'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { registerLocalGateway } = require('./localGateway');
const listen = server => new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const close = server => new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});

test('same-origin gateway streams auth and uploads, isolates cookies, and leaves patient API alone',async()=>{
  const upstream = http.createServer((req,res)=>{
    let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
      res.setHeader('content-type','application/json');
      res.setHeader('set-cookie','dai_refresh=synthetic-test; HttpOnly; Path=/api/auth; SameSite=Strict');
      res.end(JSON.stringify({path:req.url,method:req.method,body}));
    });
  });
  const port=await listen(upstream);
  const app=express();
  registerLocalGateway(app,{DAI_LOCAL:'true',DAI_PORTAL_API_ORIGIN:`http://127.0.0.1:${port}`,DAI_PORTAL_WEB_ORIGIN:`http://127.0.0.1:${port}`});
  app.use(express.json());app.get('/api/auth/me',(req,res)=>res.json({role:'mother'}));
  const server=http.createServer(app);const gateway=await listen(server);
  try {
    const response=await fetch(`http://127.0.0.1:${gateway}/hospital-admin/api/auth/otp`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:'123456'})});
    assert.deepEqual(await response.json(),{path:'/api/auth/otp',method:'POST',body:'{"code":"123456"}'});
    assert.match(response.headers.get('set-cookie'),/Path=\/hospital-admin\/api\/auth/);
    assert.deepEqual(await (await fetch(`http://127.0.0.1:${gateway}/api/auth/me`)).json(),{role:'mother'});
    assert.equal((await(await fetch(`http://127.0.0.1:${gateway}/hospital-admin/_next/test.js`)).json()).path,'/hospital-admin/_next/test.js');
    assert.equal((await fetch(`http://127.0.0.1:${gateway}/hospital-administrator`)).status,404);
  } finally {await close(server);await close(upstream);}
});

test('gateway is disabled in normal hosted mode',()=>{
  const app=express();assert.equal(registerLocalGateway(app,{}),undefined);
});
