/* Reviewed educational responses. No generative model, diagnosis or private-record retrieval. */
(function(root,factory){ const api=factory(); if(typeof module==='object' && module.exports) module.exports=api; else root.DaiDayaKnowledge=api; })(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const faqs = [
  {
    "id": "timeline",
    "category": "app",
    "question": {
      "en": "Where can I see my care timeline?",
      "hi": "मेरा केयर टाइमलाइन कहाँ दिखेगा?"
    },
    "answer": {
      "en": "In the Patient workspace, choose Care Timeline. It shows recorded milestones and pending items. Sign in to view your own records.",
      "hi": "Patient workspace में Care Timeline खोलें। यहाँ दर्ज पड़ाव और लंबित काम दिखते हैं। अपने रिकॉर्ड देखने के लिए साइन इन करें।"
    },
    "pattern": "timeline|टाइमलाइन|care journey",
    "sources": [],
    "navigation": "timeline"
  },
  {
    "id": "upload",
    "category": "app",
    "question": {
      "en": "How do I upload a report or prescription?",
      "hi": "मैं रिपोर्ट या प्रिस्क्रिप्शन कैसे अपलोड करूँ?"
    },
    "answer": {
      "en": "Open Records in the Patient workspace, choose a document and upload it. Select its type and sharing preference. Uploading a report does not mean a clinician has reviewed it.",
      "hi": "Patient workspace में Records खोलें, फ़ाइल चुनें और अपलोड करें। दस्तावेज़ का प्रकार और शेयर करने की अनुमति चुनें। अपलोड होने का अर्थ डॉक्टर द्वारा समीक्षा होना नहीं है।"
    },
    "pattern": "upload|prescription|अपलोड|report.*kaise|report.*कैसे",
    "sources": [],
    "navigation": "records"
  },
  {
    "id": "language",
    "category": "app",
    "question": {
      "en": "How do I change the language?",
      "hi": "मैं हिंदी या अपनी क्षेत्रीय भाषा कैसे चुनूँ?"
    },
    "answer": {
      "en": "For Dhruv, use the English / हिंदी switch above. For the app, open Settings → Language and choose an available language. Other regional languages are not supported by this assistant yet.",
      "hi": "Dhruv के लिए ऊपर English / हिंदी चुनें। ऐप में Settings → Language में उपलब्ध भाषा चुनें। इस असिस्टेंट में अभी दूसरी क्षेत्रीय भाषाएँ उपलब्ध नहीं हैं।"
    },
    "pattern": "language|hindi|regional|भाषा|हिंदी|bhasha",
    "sources": [],
    "navigation": "settings"
  },
  {
    "id": "family",
    "category": "app",
    "question": {
      "en": "How can my husband or family access my records?",
      "hi": "मैं पति या परिवार को रिकॉर्ड का एक्सेस कैसे दूँ?"
    },
    "answer": {
      "en": "Share only with your consent. Records provides document sharing controls; a separate family-account access flow is not available here yet. Ask your care team for the approved process. Do not share your password or OTP.",
      "hi": "अपनी सहमति से ही साझा करें। Records में दस्तावेज़ शेयर करने के विकल्प हैं; अलग family-account access अभी उपलब्ध नहीं है। सही प्रक्रिया के लिए care team से पूछें। पासवर्ड या OTP न दें।"
    },
    "pattern": "husband|family.*access|caregiver|पति|परिवार|family member",
    "sources": [],
    "navigation": "records"
  },
  {
    "id": "voice",
    "category": "app",
    "question": {
      "en": "How can I talk using my voice?",
      "hi": "मैं आवाज़ से कैसे बात करूँ?"
    },
    "answer": {
      "en": "Press the microphone, allow browser microphone access and speak. Choose English or Hindi first. The Voice button reads replies aloud. If your browser does not support speech recognition, type your question. Browser speech services may process your audio.",
      "hi": "माइक दबाएँ, ब्राउज़र को माइक्रोफ़ोन की अनुमति दें और बोलें। पहले English या हिंदी चुनें। Voice बटन जवाब सुनाता है। आवाज़ पहचान उपलब्ध न हो तो प्रश्न टाइप करें। ब्राउज़र की speech service आपकी आवाज़ प्रोसेस कर सकती है।"
    },
    "pattern": "voice|microphone|speak|आवाज़|माइक|bolun|baat karun",
    "sources": [],
    "navigation": null
  },
  {
    "id": "first-anc",
    "category": "pregnancy",
    "question": {
      "en": "When should I have my first antenatal checkup?",
      "hi": "पहला एंटीनेटल चेकअप कब कराना चाहिए?"
    },
    "answer": {
      "en": "Arrange your first antenatal visit as soon as pregnancy is known, ideally within the first 12 weeks. Your care team sets your personal schedule.",
      "hi": "गर्भावस्था का पता चलते ही पहला चेकअप कराएँ, बेहतर है पहले 12 सप्ताह में। आपकी care team आपका व्यक्तिगत शेड्यूल तय करेगी।"
    },
    "pattern": "first.*(anc|antenatal|check)|pehla.*check|पहला.*चेक",
    "sources": [
      "https://www.who.int/teams/maternal-newborn-child-adolescent-health-and-ageing/handbooks/programme-manager-s-handbook-mncah/recommendations-on-interventions-along-life-course/maternal"
    ],
    "navigation": null
  },
  {
    "id": "anc-count",
    "category": "pregnancy",
    "question": {
      "en": "How many pregnancy checkups are needed?",
      "hi": "गर्भावस्था में कितने चेकअप ज़रूरी हैं?"
    },
    "answer": {
      "en": "WHO recommends at least 8 antenatal contacts for an uncomplicated pregnancy, starting within 12 weeks. Your local care plan may differ; twins or clinician-identified concerns can need extra visits. Follow the schedule your clinician records.",
      "hi": "WHO सामान्य गर्भावस्था में कम से कम 8 ANC संपर्क सुझाता है, शुरुआत 12 सप्ताह के भीतर। स्थानीय care plan अलग हो सकता है; जुड़वाँ या डॉक्टर द्वारा पहचानी समस्या में अतिरिक्त मुलाक़ातें हो सकती हैं। डॉक्टर का दर्ज शेड्यूल मानें।"
    },
    "pattern": "how many.*(check|visit|contact)|kitne.*check|कितने.*चेक",
    "sources": [
      "https://www.who.int/teams/maternal-newborn-child-adolescent-health-and-ageing/handbooks/programme-manager-s-handbook-mncah/recommendations-on-interventions-along-life-course/maternal"
    ],
    "navigation": null
  },
  {
    "id": "anomaly",
    "category": "pregnancy",
    "question": {
      "en": "When is the anomaly scan?",
      "hi": "एनॉमली स्कैन कब होता है?"
    },
    "answer": {
      "en": "The mid-pregnancy anomaly scan is commonly offered around 18–21 weeks to look at the baby’s development. Follow the date given by your clinician; it is a screening scan, not a guarantee about every condition.",
      "hi": "शिशु के विकास को देखने वाला anomaly scan आम तौर पर 18–21 सप्ताह के आसपास होता है। डॉक्टर की दी तारीख़ मानें; यह screening है, हर स्थिति की गारंटी नहीं।"
    },
    "pattern": "anomaly|एनॉमली",
    "sources": [
      "https://www.nhs.uk/pregnancy/your-pregnancy-care/ultrasound-scans/"
    ],
    "navigation": null
  },
  {
    "id": "ogtt",
    "category": "pregnancy",
    "question": {
      "en": "When is the sugar test (OGTT)?",
      "hi": "शुगर टेस्ट OGTT कब होता है?"
    },
    "answer": {
      "en": "OGTT means oral glucose tolerance test. Indian care programmes screen for diabetes during pregnancy, including at first contact and, when indicated, again at 24–28 weeks. Ask your team which date and preparation apply to you.",
      "hi": "OGTT यानी oral glucose tolerance test। भारतीय care programmes में गर्भावस्था के शुगर की जाँच पहली मुलाक़ात पर और ज़रूरत अनुसार फिर 24–28 सप्ताह पर होती है। अपनी तारीख़ और तैयारी care team से पूछें।"
    },
    "pattern": "ogtt|sugar test|glucose test|शुगर टेस्ट",
    "sources": [
      "https://www.nhm.gov.in/index1.php?lang=1&level=2&lid=218&sublinkid=822",
      "https://esic.gov.in/attachments/circularfile/8370716e57c26c3ccf56733c24764ab3.pdf"
    ],
    "navigation": null
  },
  {
    "id": "supplements",
    "category": "pregnancy",
    "question": {
      "en": "When do iron and calcium supplements usually start?",
      "hi": "आयरन और कैल्शियम की गोली कब शुरू होती है?"
    },
    "answer": {
      "en": "Routine iron–folic acid supplementation is generally part of care from the second trimester; Indian calcium guidance starts at 14 weeks. Your clinician decides your start date and prescription. Do not start, stop or change a dose based on this chat.",
      "hi": "नियमित iron–folic acid आम तौर पर दूसरी तिमाही की care का हिस्सा है; भारतीय calcium guidance 14 सप्ताह से शुरू होती है। आपकी शुरुआत और prescription डॉक्टर तय करेंगे। इस चैट से दवा शुरू, बंद या dose न बदलें।"
    },
    "pattern": "iron|calcium|ifa|आयरन|कैल्शियम|goli kab",
    "sources": [
      "https://www.nhm.gov.in/index1.php?lang=1&level=2&lid=218&sublinkid=822",
      "https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/National_Guidelines_for_Calcium_Supplementation_During_Pregnancy_and_Lactation.pdf"
    ],
    "navigation": null
  },
  {
    "id": "td",
    "category": "pregnancy",
    "question": {
      "en": "When are TT/Td injections given?",
      "hi": "TT/Td के इंजेक्शन कब लगते हैं?"
    },
    "answer": {
      "en": "Under India’s schedule, Td-1 is given early in pregnancy and Td-2 four weeks later. A booster may apply depending on previous doses. Your vaccination record and clinician determine what you need.",
      "hi": "भारत के शेड्यूल में Td-1 गर्भावस्था में जल्दी और Td-2 चार सप्ताह बाद दिया जाता है। पिछली खुराकों के आधार पर booster लग सकता है। अपना vaccination record डॉक्टर को दिखाएँ।"
    },
    "pattern": "\\btt\\b|\\btd\\b|injection|इंजेक्शन",
    "sources": [
      "https://nhm.hp.gov.in/immmunization"
    ],
    "navigation": null
  },
  {
    "id": "bag",
    "category": "pregnancy",
    "question": {
      "en": "What should I pack for delivery?",
      "hi": "डिलीवरी के बैग में क्या रखें?"
    },
    "answer": {
      "en": "Bring your care records and reports, hospital registration details, comfortable clothes, maternity pads, baby clothes, nappies, toiletries and a phone charger. Ask your hospital for its checklist and any scheme documents.",
      "hi": "care records, रिपोर्ट, hospital registration, आरामदायक कपड़े, maternity pads, बच्चे के कपड़े, nappies, toiletries और चार्जर रखें। अस्पताल से उसकी सूची और योजना के दस्तावेज़ पूछें।"
    },
    "pattern": "bag|pack|बैग|samaan|सामान",
    "sources": [],
    "navigation": null
  },
  {
    "id": "terms",
    "category": "terms",
    "question": {
      "en": "What do Hb, GDM, EDD, CTG and NT scan mean?",
      "hi": "Hb, GDM, EDD, CTG और NT scan का मतलब क्या है?"
    },
    "answer": {
      "en": "Hb: haemoglobin, the blood protein that carries oxygen. GDM: diabetes first diagnosed during pregnancy. EDD: estimated delivery date. CTG: a recording of fetal heart rate and contractions. NT scan: an early ultrasound measurement used in screening. A clinician interprets your results.",
      "hi": "Hb: ऑक्सीजन ले जाने वाला haemoglobin। GDM: गर्भावस्था के दौरान पहली बार पहचाना गया diabetes। EDD: प्रसव की अनुमानित तारीख़। CTG: शिशु की धड़कन और contractions की recording। NT scan: शुरुआती ultrasound में screening के लिए माप। आपके नतीजे डॉक्टर समझाएँगे।"
    },
    "pattern": "\\bhb\\b|\\bgdm\\b|\\bedd\\b|\\bctg\\b|\\bnt\\b|terms|मतलब|full form",
    "sources": [
      "https://www.who.int/teams/maternal-newborn-child-adolescent-health-and-ageing/handbooks/programme-manager-s-handbook-mncah/recommendations-on-interventions-along-life-course/maternal",
      "https://www.nhs.uk/pregnancy/your-pregnancy-care/ultrasound-scans/"
    ],
    "navigation": null
  },
  {
    "id": "high-risk",
    "category": "terms",
    "question": {
      "en": "What does high-risk pregnancy mean?",
      "hi": "हाई-रिस्क गर्भावस्था का मतलब क्या है?"
    },
    "answer": {
      "en": "It means a clinician has identified a reason for closer monitoring or specialist care. It does not mean a complication is certain. Only a clinician can assign or change this status; Dhruv cannot assess your personal risk.",
      "hi": "इसका अर्थ है कि डॉक्टर ने अधिक निगरानी या specialist care की वजह पहचानी है। इसका मतलब जटिलता निश्चित होना नहीं है। यह status केवल डॉक्टर तय या बदल सकते हैं; Dhruv आपका risk नहीं आँकता।"
    },
    "pattern": "high.?risk|हाई.?रिस्क|उच्च जोखिम",
    "sources": [],
    "navigation": null
  },
  {
    "id": "twin-terms",
    "category": "terms",
    "question": {
      "en": "What do DCDA and MCDA mean in twins?",
      "hi": "जुड़वाँ में DCDA और MCDA का मतलब क्या है?"
    },
    "answer": {
      "en": "DCDA: each baby has a separate chorion and amniotic sac; the placentas may appear joined. MCDA: the babies share a chorion/placenta but have separate amniotic sacs. The scan team confirms the type and follow-up plan.",
      "hi": "DCDA: दोनों बच्चों की अलग chorion और पानी की थैली होती है; placentas जुड़े दिख सकते हैं। MCDA: placenta/chorion साझा होता है लेकिन पानी की थैलियाँ अलग होती हैं। scan team प्रकार और follow-up तय करती है।"
    },
    "pattern": "dcda|mcda|chorioni|डीसीडीए|एमसीडीए",
    "sources": [
      "https://www.nhs.uk/pregnancy/your-pregnancy-care/antenatal-care-with-twins/"
    ],
    "navigation": null
  },
  {
    "id": "pnc",
    "category": "postpartum",
    "question": {
      "en": "When is the first checkup after delivery?",
      "hi": "डिलीवरी के बाद पहला चेकअप कब होता है?"
    },
    "answer": {
      "en": "Care starts in the first 24 hours after birth. WHO recommends further contacts at 48–72 hours, 7–14 days and week 6; Indian programmes may include additional home visits. Use your discharge plan for your exact dates.",
      "hi": "जन्म के पहले 24 घंटे में care शुरू होती है। WHO आगे 48–72 घंटे, 7–14 दिन और छठे सप्ताह में संपर्क सुझाता है; भारत में अतिरिक्त home visits हो सकती हैं। अपनी सही तारीख़ें discharge plan में देखें।"
    },
    "pattern": "first.*(after delivery|postnatal|postpartum)|delivery ke baad.*check|डिलीवरी के बाद.*चेक|postnatal check",
    "sources": [
      "https://www.who.int/news/item/30-03-2022-who-urges-quality-care-for-women-and-newborns-in-critical-first-weeks-after-childbirth",
      "https://www.nhm.gov.in/index1.php?lang=1&level=2&lid=218&sublinkid=822"
    ],
    "navigation": "postpartum"
  },
  {
    "id": "feeding",
    "category": "postpartum",
    "question": {
      "en": "When should breastfeeding start, and who can help with low milk?",
      "hi": "स्तनपान कब शुरू करें? दूध कम लगे तो किससे मिलें?"
    },
    "answer": {
      "en": "When mother and baby are able, support breastfeeding within the first hour after birth. For feeding difficulty or concern about milk supply, ask a nurse, lactation counsellor or paediatrician for a feeding assessment.",
      "hi": "माँ और बच्चा सक्षम हों तो जन्म के पहले घंटे में स्तनपान शुरू कराने में मदद लें। दूध या feeding की चिंता हो तो nurse, lactation counsellor या paediatrician से feeding assessment कराएँ।"
    },
    "pattern": "breast|milk|feeding|दूध|स्तनपान|dudh",
    "sources": [
      "https://www.who.int/news/item/30-03-2022-who-urges-quality-care-for-women-and-newborns-in-critical-first-weeks-after-childbirth"
    ],
    "navigation": null
  },
  {
    "id": "mood",
    "category": "postpartum",
    "question": {
      "en": "My mood is low after delivery. Who can I talk to?",
      "hi": "डिलीवरी के बाद मन उदास रहता है, किससे बात करूँ?"
    },
    "answer": {
      "en": "Tell your obstetrician, nurse or a mental-health professional, and a trusted person who can support you. Ask for a postnatal mood assessment. You do not have to manage this alone. If you feel in immediate danger, seek emergency help.",
      "hi": "अपने obstetrician, nurse या mental-health professional और किसी भरोसेमंद व्यक्ति से बात करें। postnatal mood assessment माँगें। आपको अकेले यह सँभालने की ज़रूरत नहीं है। तत्काल ख़तरा लगे तो emergency सहायता लें।"
    },
    "pattern": "mood|depress|sad|उदास|मन खराब|mood kharab",
    "sources": [
      "https://www.who.int/news/item/30-03-2022-who-urges-quality-care-for-women-and-newborns-in-critical-first-weeks-after-childbirth"
    ],
    "navigation": null
  },
  {
    "id": "contraception",
    "category": "postpartum",
    "question": {
      "en": "Where can I learn about contraception?",
      "hi": "गर्भनिरोध के विकल्प कहाँ जानूँ?"
    },
    "answer": {
      "en": "Ask your postnatal or family-planning clinic for counselling on options that fit your health, breastfeeding and preferences. Dhruv can explain where to get counselling, but cannot select or prescribe a method.",
      "hi": "postnatal या family-planning clinic में अपनी सेहत, स्तनपान और पसंद के अनुसार विकल्पों की counselling लें। Dhruv तरीका चुन या prescribe नहीं कर सकता।"
    },
    "pattern": "contracep|family planning|गर्भनिरोध|परिवार नियोजन",
    "sources": [
      "https://www.who.int/teams/maternal-newborn-child-adolescent-health-and-ageing/handbooks/programme-manager-s-handbook-mncah/recommendations-on-interventions-along-life-course/maternal"
    ],
    "navigation": null
  },
  {
    "id": "vaccines",
    "category": "child",
    "question": {
      "en": "What is my baby’s vaccination schedule?",
      "hi": "मेरे बच्चे के टीकों का शेड्यूल क्या है?"
    },
    "answer": {
      "en": "India’s UIP includes birth doses, visits at 6, 10 and 14 weeks, and later doses at 9–12 and 16–24 months, with further boosters. Open the Child workspace → Vaccines and choose the correct baby for recorded due dates. Your vaccinator confirms the current schedule.",
      "hi": "भारत के UIP में जन्म के टीके, 6, 10, 14 सप्ताह और आगे 9–12 व 16–24 माह की खुराकें तथा boosters होते हैं। Child workspace → Vaccines में सही बच्चा चुनकर दर्ज तारीख़ें देखें। vaccinator वर्तमान शेड्यूल की पुष्टि करेंगे।"
    },
    "pattern": "vaccine.*schedule|vaccination.*schedule|टीकों.*शेड्यूल|vaccines|टीकाकरण",
    "sources": [
      "https://nhm.hp.gov.in/immmunization"
    ],
    "navigation": "child"
  },
  {
    "id": "missed-vaccine",
    "category": "child",
    "question": {
      "en": "What if a vaccine was missed?",
      "hi": "कोई टीका छूट गया तो क्या करूँ?"
    },
    "answer": {
      "en": "Take the baby’s vaccination card to the immunisation clinic or ANM and ask for a catch-up plan. They will confirm the next eligible dose and date; Dhruv does not choose a catch-up dose.",
      "hi": "बच्चे का vaccination card लेकर immunisation clinic या ANM से catch-up plan पूछें। वे अगली उपयुक्त खुराक और तारीख़ बताएँगे; Dhruv catch-up dose नहीं चुनता।"
    },
    "pattern": "(miss|late|छूट|छुट|chhut|miss ho).*(vaccin|टीक)|vaccin.*(miss|late|छूट|छुट)",
    "sources": [
      "https://nhm.hp.gov.in/immmunization"
    ],
    "navigation": "child"
  },
  {
    "id": "growth",
    "category": "child",
    "question": {
      "en": "When is my baby’s growth and weight checked?",
      "hi": "बच्चे का वज़न और विकास कब जाँचा जाता है?"
    },
    "answer": {
      "en": "Growth is reviewed during scheduled child-health and immunisation visits. The care team sets intervals for weight, length and head circumference. Open the Child workspace for recorded measurements; ask a paediatrician about the growth pattern.",
      "hi": "child-health और immunisation visits में विकास देखा जाता है। care team वज़न, लंबाई और सिर के माप के अंतराल तय करेगी। दर्ज माप Child workspace में देखें; growth pattern paediatrician से समझें।"
    },
    "pattern": "growth|weight check|वज़न|वजन|विकास",
    "sources": [],
    "navigation": "child"
  },
  {
    "id": "twin-records",
    "category": "child",
    "question": {
      "en": "How are twins’ records kept separate?",
      "hi": "जुड़वाँ बच्चों के रिकॉर्ड अलग कैसे दिखते हैं?"
    },
    "answer": {
      "en": "Each baby has a separate child ID and birth order. In the Child workspace, select the baby before viewing vaccines, growth or records. Check the name/ID and birth order before every entry.",
      "hi": "हर बच्चे की अलग child ID और birth order है। Child workspace में टीके, growth या records देखने से पहले सही बच्चा चुनें। हर entry से पहले ID और birth order जाँचें।"
    },
    "pattern": "twin|twins|जुड़वाँ|जुड़वा|records alag",
    "sources": [],
    "navigation": "child"
  },
  {
    "id": "pending",
    "category": "care",
    "question": {
      "en": "Do I have any pending tests or visits?",
      "hi": "मेरा कोई टेस्ट या विज़िट लंबित है?"
    },
    "answer": {
      "en": "Open your signed-in Care Timeline for pending or overdue items. I cannot see your private timeline in this chat, so I cannot confirm whether you personally have a pending test or visit.",
      "hi": "साइन इन करके Care Timeline में pending या overdue items देखें। इस चैट में मैं आपका निजी timeline नहीं देखता, इसलिए आपके लिए कोई टेस्ट या visit लंबित है या नहीं, पुष्टि नहीं कर सकता।"
    },
    "pattern": "pending|overdue|लंबित|पेंडिंग|care gap",
    "sources": [],
    "navigation": "timeline"
  },
  {
    "id": "next-visit",
    "category": "care",
    "question": {
      "en": "When is my next checkup?",
      "hi": "मेरा अगला चेकअप कब है?"
    },
    "answer": {
      "en": "Open Appointments to see your recorded next booking. I do not have access to your personal appointment dates here. If no booking is listed, contact your care team.",
      "hi": "Appointments में अपनी अगली दर्ज booking देखें। यहाँ मुझे आपकी व्यक्तिगत appointment dates नहीं मिलतीं। booking न दिखे तो care team से संपर्क करें।"
    },
    "pattern": "next.*(check|visit|appointment)|agla.*check|अगला.*चेक",
    "sources": [],
    "navigation": "appointments"
  },
  {
    "id": "booking",
    "category": "care",
    "question": {
      "en": "How do I book or reschedule an appointment?",
      "hi": "अपॉइंटमेंट बुक या रीशेड्यूल कैसे करूँ?"
    },
    "answer": {
      "en": "Open Appointments in your workspace to view available booking or change options. Follow the confirmation shown there; this chat does not book or reschedule for you. Contact the clinic if a change option is unavailable.",
      "hi": "अपने workspace में Appointments खोलकर booking या बदलाव के उपलब्ध विकल्प देखें। वहाँ दिखी पुष्टि मानें; यह चैट booking या reschedule नहीं करती। विकल्प न हो तो clinic से संपर्क करें।"
    },
    "pattern": "appointment|reschedule|book|अपॉइंटमेंट|बुक|रीशेड्यूल",
    "sources": [],
    "navigation": "appointments"
  },
  {
    "id": "nearby",
    "category": "care",
    "question": {
      "en": "Which hospital or PHC is near me?",
      "hi": "मेरे पास कौन-सा अस्पताल या PHC है?"
    },
    "answer": {
      "en": "Use the hospital/location options in your care workspace or ask your ANM for a nearby PHC. This chat does not have your location and cannot verify live facility availability. Demo facilities are fictional.",
      "hi": "care workspace के hospital/location विकल्प देखें या ANM से पास के PHC के बारे में पूछें। इस चैट को आपकी location नहीं मिलती और live availability की पुष्टि नहीं होती। demo facilities काल्पनिक हैं।"
    },
    "pattern": "near|nearby|phc|पास.*अस्पताल|नज़दीक|nazdik|paas.*hospital",
    "sources": [],
    "navigation": null
  },
  {
    "id": "report-next",
    "category": "care",
    "question": {
      "en": "What happens after my report is uploaded?",
      "hi": "रिपोर्ट के बाद अगला कदम क्या है?"
    },
    "answer": {
      "en": "Open Records to check its status and ask your assigned clinician to review it. A result needs clinical interpretation; an upload alone does not confirm treatment, a diagnosis or completion of every care task.",
      "hi": "Records में status देखें और assigned clinician से समीक्षा कराएँ। result का मतलब डॉक्टर समझाएँगे; केवल upload होने से इलाज, diagnosis या सभी care tasks पूरे होने की पुष्टि नहीं होती।"
    },
    "pattern": "report|result|रिपोर्ट|नतीजे",
    "sources": [],
    "navigation": "records"
  },
  {
    "id": "sos-how",
    "category": "emergency",
    "question": {
      "en": "How do I use SOS in an emergency?",
      "hi": "इमरजेंसी में SOS कैसे दबाऊँ?"
    },
    "answer": {
      "en": "Open the SOS control on your Patient dashboard and follow the prompts. If it is unavailable, go to the nearest hospital. Demo SOS does not dispatch real emergency services.",
      "hi": "Patient dashboard का SOS बटन खोलें और निर्देश मानें। उपलब्ध न हो तो नज़दीकी अस्पताल जाएँ। Demo SOS वास्तविक emergency service नहीं भेजता।"
    },
    "pattern": "(how|kaise|कैसे).{0,25}sos|sos.*(how|kaise|कैसे)|emergency.*button|एसओएस.*कैसे",
    "sources": [],
    "navigation": null
  },
  {
    "id": "sos-after",
    "category": "emergency",
    "question": {
      "en": "What happens after SOS, and why is verification needed?",
      "hi": "SOS के बाद क्या होता है और verification क्यों है?"
    },
    "answer": {
      "en": "SOS requests confirmation before the receiving team reviews the request. Verification helps reject accidental or false requests. Do not wait for the app in an emergency; go to the nearest hospital. Demo routing is simulated.",
      "hi": "SOS में पुष्टि के बाद receiving team अनुरोध देखती है। verification गलती से या झूठे requests रोकने में मदद करता है। emergency में ऐप का इंतज़ार न करें; नज़दीकी अस्पताल जाएँ। Demo routing simulated है।"
    },
    "pattern": "sos|verification|verify|एसओएस|वेरिफिकेशन",
    "sources": [],
    "navigation": null
  },
  {
    "id": "danger",
    "category": "emergency",
    "question": {
      "en": "Which symptoms need emergency help?",
      "hi": "कौन-से लक्षण इमरजेंसी हैं?"
    },
    "answer": {
      "en": "Press SOS immediately or go to the nearest hospital.",
      "hi": "Turant SOS dabaiye ya nazdiki hospital jaiye."
    },
    "pattern": "which.*symptom|danger sign|कौन.*लक्षण|emergency symptoms",
    "sources": [],
    "navigation": null
  },
  {
    "id": "pmjay",
    "category": "schemes",
    "question": {
      "en": "Who may be eligible for PM-JAY?",
      "hi": "PM-JAY किसे मिल सकता है?"
    },
    "answer": {
      "en": "PM-JAY: eligibility depends on government beneficiary lists and applicable state coverage. Check your household through the official NHA/PM-JAY portal. Final confirmation must come from the official site.",
      "hi": "PM-JAY: पात्रता सरकारी beneficiary lists और राज्य के coverage पर निर्भर है। official NHA/PM-JAY portal पर अपने परिवार की पात्रता जाँचें। आख़िरी पुष्टि official site से करें।"
    },
    "pattern": "pm.?jay|ayushman|आयुष्मान",
    "sources": [
      "https://nha.gov.in/PM-JAY"
    ],
    "navigation": null
  },
  {
    "id": "jsy",
    "category": "schemes",
    "question": {
      "en": "Who may be eligible for JSY?",
      "hi": "JSY किसे मिल सकता है?"
    },
    "answer": {
      "en": "JSY: assistance for eligible institutional deliveries. Eligibility differs by state category, facility and beneficiary category; low-performing states have broader coverage. Final confirmation must come from the official NHM site.",
      "hi": "JSY: पात्र institutional delivery के लिए सहायता। पात्रता राज्य की श्रेणी, facility और beneficiary category पर निर्भर है; low-performing states में coverage व्यापक है। आख़िरी पुष्टि official NHM site से करें।"
    },
    "pattern": "\\bjsy\\b|janani|जननी",
    "sources": [
      "https://nhm.gov.in/nhm/index1.php?lang=1&level=3&lid=309&sublinkid=841"
    ],
    "navigation": null
  },
  {
    "id": "pmmvy",
    "category": "schemes",
    "question": {
      "en": "Who may be eligible for PMMVY?",
      "hi": "PMMVY किसे मिल सकता है?"
    },
    "answer": {
      "en": "PMMVY: eligible women in specified social/economic categories may receive maternity benefits for the first child and, under PMMVY 2.0, a second child if a girl, subject to conditions and exclusions. Final confirmation must come from the official WCD site.",
      "hi": "PMMVY: निर्धारित सामाजिक/आर्थिक श्रेणी की पात्र महिलाओं को पहले बच्चे और PMMVY 2.0 में दूसरा बच्चा लड़की होने पर, शर्तों और अपवादों के अधीन maternity benefit मिल सकता है। आख़िरी पुष्टि official WCD site से करें।"
    },
    "pattern": "pmmvy|matru|मातृ",
    "sources": [
      "https://www.wcd.gov.in/offerings/pradhan-mantri-matru-vandana-yojana"
    ],
    "navigation": null
  },
  {
    "id": "scheme-docs",
    "category": "schemes",
    "question": {
      "en": "Which scheme documents and official links do I need?",
      "hi": "योजनाओं के दस्तावेज़ और official links कहाँ हैं?"
    },
    "answer": {
      "en": "PM-JAY: government beneficiary eligibility. JSY: eligible institutional delivery, with state-specific rules. PMMVY: eligible maternity-benefit categories. Document requirements vary; check the official portals below. Final confirmation must come from the official site.",
      "hi": "PM-JAY: सरकारी beneficiary पात्रता। JSY: राज्य के नियमों के अनुसार पात्र institutional delivery। PMMVY: पात्र maternity-benefit श्रेणियाँ। दस्तावेज़ों की सूची अलग हो सकती है; नीचे official portals देखें। आख़िरी पुष्टि official site से करें।"
    },
    "pattern": "scheme|eligib|document.*(yojana|scheme)|yojana|योजना|पात्रता|दस्तावेज़",
    "sources": [
      "https://nha.gov.in/PM-JAY",
      "https://nhm.gov.in/nhm/index1.php?lang=1&level=3&lid=309&sublinkid=841",
      "https://www.wcd.gov.in/offerings/pradhan-mantri-matru-vandana-yojana"
    ],
    "navigation": null
  },
  {
    "id": "privacy",
    "category": "privacy",
    "question": {
      "en": "Who can see my data? What can the doctor see?",
      "hi": "मेरा डेटा कौन देख सकता है? डॉक्टर को क्या दिखता है?"
    },
    "answer": {
      "en": "Access depends on your consent and the staff member’s role and assignment. Review Settings → Privacy and document sharing in Records. This assistant does not retrieve private records or send your question to an AI model.",
      "hi": "एक्सेस आपकी consent और staff की role/assignment पर निर्भर है। Settings → Privacy और Records में sharing देखें। यह assistant निजी records नहीं पढ़ता और आपका सवाल AI model को नहीं भेजता।"
    },
    "pattern": "who.*(see|data)|data.*kaun|privacy|consent|कौन.*(देख|डेटा)|गोपनीयता",
    "sources": [],
    "navigation": "settings"
  },
  {
    "id": "delete-share",
    "category": "privacy",
    "question": {
      "en": "How do I delete or share my data?",
      "hi": "मैं डेटा delete या share कैसे करूँ?"
    },
    "answer": {
      "en": "In Records, use the available document share/delete controls; Settings contains privacy preferences. Full account deletion or a data export requires the service’s supported request process. I cannot delete or share records from this chat.",
      "hi": "Records में उपलब्ध document share/delete विकल्प और Settings में privacy preferences देखें। पूरा account हटाने या data export के लिए service की supported request प्रक्रिया चाहिए। मैं चैट से records delete या share नहीं कर सकता।"
    },
    "pattern": "delete|share.*data|data.*share|हटाऊँ|शेयर|डिलीट",
    "sources": [],
    "navigation": "records"
  },
  {
    "id": "medicine-refusal",
    "category": "safety",
    "question": {
      "en": "Can I change my medicine or dose?",
      "hi": "क्या मैं दवा या dose बदल दूँ?"
    },
    "answer": {
      "en": "Only your doctor can advise you about this.",
      "hi": "Ye sirf aapka doctor bata sakta hai."
    },
    "pattern": "change.*(medicine|dose)|dose.*change",
    "sources": [],
    "navigation": null
  },
  {
    "id": "safe-refusal",
    "category": "safety",
    "question": {
      "en": "Is my pregnancy safe?",
      "hi": "क्या मेरी pregnancy safe है?"
    },
    "answer": {
      "en": "I cannot say whether your pregnancy is safe or unsafe; please see your doctor.",
      "hi": "Main safe ya unsafe nahi bata sakta; doctor se milein."
    },
    "pattern": "is my.*safe",
    "sources": [],
    "navigation": null
  },
  {
    "id": "diagnosis-refusal",
    "category": "safety",
    "question": {
      "en": "What disease do I have?",
      "hi": "मुझे कौन-सी बीमारी है?"
    },
    "answer": {
      "en": "I cannot diagnose you. Please see your doctor.",
      "hi": "Main diagnosis nahi karta; apne doctor se milein."
    },
    "pattern": "what disease",
    "sources": [],
    "navigation": null
  }
];
const categories = [{"id": "app", "en": "Using DAI", "hi": "DAI का इस्तेमाल"}, {"id": "pregnancy", "en": "Pregnancy milestones", "hi": "गर्भावस्था के पड़ाव"}, {"id": "terms", "en": "Simple explanations", "hi": "सरल शब्दों में"}, {"id": "postpartum", "en": "After delivery", "hi": "डिलीवरी के बाद"}, {"id": "child", "en": "Baby care", "hi": "बच्चे की देखभाल"}, {"id": "care", "en": "Care & appointments", "hi": "केयर और अपॉइंटमेंट"}, {"id": "emergency", "en": "SOS & emergencies", "hi": "SOS और इमरजेंसी"}, {"id": "schemes", "en": "Schemes & support", "hi": "योजनाएँ और सहायता"}, {"id": "privacy", "en": "Privacy & consent", "hi": "गोपनीयता और सहमति"}, {"id": "safety", "en": "Medical boundaries", "hi": "चिकित्सा की सीमाएँ"}];

const normalise = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[’']/g,'').replace(/[^\p{L}\p{M}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
const danger = /bleed|haemorrhag|hemorrhag|severe\s*(headache|head pain)|bad headache|blurred?\s*(vision|sight)|no\s*(baby|fetal|foetal)\s*movement|(baby|fetal|foetal|bach[ce]+|bac[hc]+e).{0,35}(not mov|stopped mov|movement.{0,12}(stop|band|nahi)|hil.{0,8}(nahi|band))|movement.{0,15}(band|nahi|बंद|नहीं)|बच्च[ेा].{0,25}(नहीं हिल|हिल नहीं|हलचल नहीं|हरकत नहीं)|tez\s*(sar|sir)\s*dard|dhundh?la|khoon|खून|रक्तस्राव|ब्लीडिंग|ते[ज़ज].{0,8}(सिर|सर).{0,6}दर्द|धुंधला|धुँधला|हलचल.{0,10}(बंद|नहीं)|हरकत.{0,10}(बंद|नहीं)|सांस.{0,10}(तकलीफ|दिक्कत)|seizure|unconscious|chest pain|cannot breathe|cant breathe|cant feel.{0,15}(baby|move)|no movement|emergency symptoms|symptom.{0,20}emergency|kaunse.{0,15}symptom|danger signs|कौन.{0,10}लक्षण/i;
const medicine = /(medicine|medication|dose|tablet|दवा|डो[ज़ज]|खुराक).{0,35}(change|increase|reduce|stop|double|बदल|बढ़ा|घटा|बंद|badal|badha|kam kar|band kar)|(change|increase|reduce|stop|double|बदल|बढ़ा|घटा|बंद).{0,35}(medicine|medication|dose|tablet|दवा|डो[ज़ज]|खुराक)|should i take|which medicine|कौन.?सी दवा|kitni.*(goli|dose)|कितनी.*(गोली|खुराक)/i;
const personalSafety = /(?:is|am|kya|क्या).{0,35}(?:my|meri|mera|मेरी|मेरा).{0,40}(?:safe|unsafe|सुरक्षित)|(?:my|meri|मेरी).{0,25}(?:pregnancy|गर्भावस्था).{0,25}(?:safe|unsafe|सुरक्षित)|am i.{0,12}(high.?risk|at risk|safe|unsafe)/i;
const diagnosis = /diagnos|what.{0,10}(disease|illness|condition).{0,18}(i have|have i)|do i have.{0,20}(diabetes|gdm|ana?emia|preeclampsia|pre eclampsia|infection|disease)|am i suffering|mujhe.{0,30}(bimari|beemari|kya hua)|मुझे.{0,20}(बीमारी|बीमार|क्या हुआ)|क्या मुझे.{0,15}(डायबिटीज|एनीमिया|संक्रमण|बीमारी)/i;
function make(entry,lang,safety=false){ return {id:entry.id,text:entry.answer[lang],sources:safety?[]:entry.sources,navigation:safety?null:entry.navigation,safety}; }
function respond(text,language='en'){
 const lang=language==='hi'?'hi':'en'; const value=normalise(text);
 if(danger.test(value))return make(faqs.find(x=>x.id==='danger'),lang,true);
 if(medicine.test(value))return make(faqs.find(x=>x.id==='medicine-refusal'),lang,true);
 if(personalSafety.test(value))return make(faqs.find(x=>x.id==='safe-refusal'),lang,true);
 if(diagnosis.test(value))return make(faqs.find(x=>x.id==='diagnosis-refusal'),lang,true);
 const exact=faqs.find(x=>Object.values(x.question).some(q=>normalise(q)===value));
 if(exact)return make(exact,lang,['danger','medicine-refusal','safe-refusal','diagnosis-refusal'].includes(exact.id));
 // Specific phrases outrank generic report, vaccine, appointment and terminology matches.
 const order=['missed-vaccine','twin-terms','high-risk','sos-how','sos-after','pnc','first-anc','anc-count','anomaly','ogtt','supplements','td','bag','pnc','feeding','mood','contraception','next-visit','pending','timeline','upload','language','family','voice','twin-records','growth','vaccines','pmjay','pmmvy','jsy','scheme-docs','delete-share','privacy','booking','report-next','terms'];
 for(const id of order){const entry=faqs.find(x=>x.id===id);if(new RegExp(entry.pattern,'iu').test(value))return make(entry,lang);}
 return {id:'fallback',text:lang==='hi'?'मैं DAI इस्तेमाल, गर्भावस्था के सामान्य पड़ाव, बच्चों की care, योजनाओं और privacy के प्रश्नों में मदद कर सकता हूँ। नीचे कोई विषय चुनें। निजी रिपोर्ट या चिकित्सा फ़ैसले के लिए care team से मिलें।':'I can help with using DAI, general pregnancy milestones, baby care, schemes and privacy. Choose a topic below. Ask your care team about personal results or medical decisions.',sources:[],navigation:null,safety:false};
}
return {faqs,categories,respond,normalise};
});
