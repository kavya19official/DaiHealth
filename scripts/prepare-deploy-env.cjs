'use strict';
// Private local artifact only. Never print credentials or include them in Vercel output.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'.local/deployment'),file=path.join(folder,'render.env');
if(fs.existsSync(file)){console.log('Existing private environment preserved: '+file);process.exit(0);}
const secret=()=>crypto.randomBytes(48).toString('base64url'),hex=()=>crypto.randomBytes(32).toString('hex');
const env={JWT_SECRET:secret(),DAI_DEMO_PASSWORD:secret(),DAI_DEMO_ACCESS_KEY:secret(),DAI_STATE_DIR:'/var/data',
 DAI_SEED_NIVARA_DEMO:'true',ML_ENABLED:'true',PATIENT_ML_RANKING_ENABLED:'true',PENDING_CARE_ASSISTANT:'true',PENDING_CARE_PLANNER:'true',
 DAI_ULTRASOUND_ENABLED:'true',DAI_ULTRASOUND_IMAGE_KEY:hex(),DAI_ULTRASOUND_GATEWAY_TOKEN:secret(),DAI_ULTRASOUND_SERVICE_TOKEN:secret(),
 DAI_CARE_CAPSULE_KEYS:crypto.randomBytes(32).toString('base64url'),DAI_RECORD_CONNECTIONS_KEY:hex(),TIMELINE_AUDIT_KEY:secret(),CONSENT_AUDIT_KEY:secret(),
 GEMINI_TTS_MODEL:'gemini-2.5-flash-preview-tts',GEMINI_TTS_VOICE:'Charon',DAI_CONSULTATION_AI_ENABLED:'false',DAI_VISIT_PREP_AI_ENABLED:'false'};
// Copy only explicitly deployment-relevant provider configuration, never local DB URLs.
const allow=['GEMINI_API_KEY','GEMINI_TTS_MODEL','GEMINI_TTS_VOICE','SARVAM_API_KEY','DAI_CONSULTATION_AI_ENABLED','DAI_CONSULTATION_AI_MODEL',
 'DAI_VISIT_PREP_AI_ENABLED','DAICARE_AI_ENABLED','DAICARE_AI_MODEL','DAI_COMPLEX_AI_ENABLED','DAI_COMPLEX_AI_MODEL',
 'DAI_TURN_URL','DAI_TURN_USERNAME','DAI_TURN_PASSWORD','GOOGLE_CLIENT_ID','RESEND_API_KEY','EMAIL_FROM','RESEND_TEST_EMAIL','SIGNUP_OTP_SECRET','EMAIL_LOGO_URL',
 'SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','MAIL_FROM','WEB_PUSH_PUBLIC_KEY','WEB_PUSH_PRIVATE_KEY','WEB_PUSH_SUBJECT'];
const source=path.join(root,'backend/.env');
if(fs.existsSync(source)){
 const dotenv=require('../backend/node_modules/dotenv');const local=dotenv.parse(fs.readFileSync(source));
 for(const key of allow)if(local[key]?.trim())env[key]=local[key];
}
fs.mkdirSync(folder,{recursive:true,mode:0o700});fs.chmodSync(folder,0o700);
fs.writeFileSync(file,Object.entries(env).map(([key,value])=>key+'='+JSON.stringify(value)).join('\n')+'\n',{mode:0o600,flag:'wx'});
console.log('Created private Render environment: '+file+'\nContains generated secrets and any configured provider settings. Values were not printed.');
