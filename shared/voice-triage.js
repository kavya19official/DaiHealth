/* ==========================================================================
   Dai Didi — voice symptom understanding, fixed-rule escalation and replies.
   Shared by the browser, the Node server and the phone (IVR) adapters.

   THE RULE THIS FILE EXISTS TO ENFORCE
     A language model never decides urgency here. Urgency comes only from:
       1. SYMPTOM RULES  – wording patterns below  -> symptom codes that already
          exist in /shared/emergency-triage.js (the single audited table);
       2. VITAL RULES    – a spoken BP goes through EM.triage (>=160/110 severe,
          >=140/90 high);
       3. PATTERN RULES  – a few explicit combinations (e.g. headache + high BP).
     Everything the user hears is a fixed, pre-written template (en / hi /
     hinglish). That also lets the server approve speech by exact template
     match instead of forwarding free text to a speech provider.

   Safety bias: when wording is ambiguous we over-triage, never under-triage.
   Negation ("sir dard nahi hai") is honoured only inside its own clause, and
   "dard nahi ja raha" (pain is NOT going away) is NOT treated as a negation.

   Adding a language (Marathi, Bengali, Tamil ...): add an entry to LEX_EXTRA
   patterns and a template set in T. Clinical wording must be reviewed by a
   native-speaking clinician before it ships — none is shipped unreviewed here.

   Not a diagnosis. Clinician review is required before real-world use.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./emergency-triage'));
  else root.DaiDidi = factory(root.AnvayaEmergency);
})(typeof self !== 'undefined' ? self : this, function (EM) {
  'use strict';

  /* ---------- 1. Normalisation ------------------------------------------ */
  var DEV_DIGITS = { '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9' };
  // Precomposed nukta letters -> base letter; bare nukta removed, so patterns need no nukta variants.
  var NUKTA = { '\u0958': '\u0915', '\u0959': '\u0916', '\u095A': '\u0917', '\u095B': '\u091C', '\u095C': '\u0921', '\u095D': '\u0922', '\u095E': '\u092B', '\u095F': '\u092F' };

  function normalize(text) {
    var s = String(text == null ? '' : text).normalize('NFC');
    s = s.replace(/[\u0958-\u095F]/g, function (c) { return NUKTA[c]; });
    s = s.replace(/\u093C/g, '');
    s = s.replace(/[०-९]/g, function (d) { return DEV_DIGITS[d]; });
    s = s.replace(/\u0901/g, '\u0902');                       // chandrabindu -> anusvara
    s = s.toLowerCase();
    s = s.replace(/[“”"'`’‘]/g, '');
    s = s.replace(/[\u2013\u2014]/g, '-');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  function hasDevanagari(s) { return /[\u0900-\u097F]/.test(s); }
  var HINGLISH_MARKERS = /\b(hai|hain|nahi|nahin|nhi|mujhe|mujhko|mera|meri|mere|dard|sir|sar|pet|khoon|bukhar|nazar|dhundh\w*|bahut|bohot|zyada|jyada|thoda|kal|aaj|raha|rahi|rahe|ho|hua|hui|baby|bachcha|bachche|aur|lekin|par|kya|kyun|kaise|madad|chakkar|ulti|saans|seene|paani|pani)\b/;

  var EN_WORDS = /\b(?:the|is|am|are|my|i|have|has|with|and|not|it|of|to|a|me|can|cannot|since|very|feel|feeling|pain|hurts?|please)\b/g;
  /** 'hi' (Devanagari) | 'hinglish' (Hindi in Roman) | 'en'. A short answer such as "150 by 100" keeps the conversation's language. */
  function detectLanguage(text, hint) {
    var s = normalize(text);
    if (hasDevanagari(s)) return 'hi';
    var hits = (s.match(new RegExp(HINGLISH_MARKERS.source, 'g')) || []).length;
    if (hits >= 2 || (hits === 1 && s.split(' ').length <= 4)) return 'hinglish';
    var enHits = (s.match(EN_WORDS) || []).length;
    if ((hint === 'hi' || hint === 'hi-IN' || hint === 'hinglish') && enHits < 3) return 'hinglish';
    return 'en';
  }

  /* ---------- 2. Lexicon -------------------------------------------------- */
  var NEG_AFTER = /(?:^| )(?:nahi|nahin|nhi|na|nai|nahi hai|no|not|never|नहीं|नही|ना|नहि)(?: |$)/;
  // "dard nahi ja raha", "kam nahi ho raha", "theek nahi" = the problem PERSISTS, so this is not a negation.
  var PERSIST = /(?:nahi|nahin|nhi|नहीं|नही|not) ?(?:ja ?raha|ja ?rahi|jaa|ruk|ruk ?raha|ruk ?rahi|ho ?raha|ho ?rahi|ghat|ghata|utar|kam|thik|theek|band|hil|ठीक|कम|रुक|जा|घट|उतर|बंद)|(?:kam|thik|theek|ठीक|कम|better|improv\w*|stop\w*) ?(?:nahi|nahin|nhi|नहीं|नही|not)|not (?:going|stopping|getting better|easing)|won't (?:stop|go)|will not (?:stop|go)/;
  var NEG_BEFORE = /(?:^| )(?:no|not|without|never|koi|bina|बिना|कोई)(?: |$)/;
  var SEVERE = /(?:bahut|bohot|bhot|boht|zyada|jyada|tez|tej|asahya?|asahniya|bardasht|unbearable|severe|worst|terrible|extreme|badly|very|बहुत|ज्यादा|तेज|असहनीय|बर्दाश्त)/;

  // selfNeg: the pattern already contains its own negative ("baby hil nahi raha"); skip negation logic.
  // Each entry: code (EM symptom) or soft (follow-up only), re, and optional needsSevere.
  var LEX = [
    { code: 'seizure', re: /\b(?:daura|daure|jhatke|jhatka|seizure|seizures|convuls\w*|fits?|epilep\w*|mirgi)\b|दौरा|दौरे|झटके|मिर्गी|ऐंठन के साथ/ },
    { code: 'pp_self_harm', crisis: true, re: /mar ?jana ?chah|marna ?chah|mar ?jaun|jeena ?nahi|jeene ?ka ?(?:mann?|man) ?nahi|jine ?ka ?(?:mann?|man) ?nahi|khatam ?kar|khud ?ko ?(?:nuksan|nuksaan|hurt|maar|khatam)|(?:baby|bachche|bachchi|bachcha|bacche|bache) ?ko ?(?:nuksan|nuksaan|hurt|maar|khatam)|suicid\w*|end my life|kill myself|hurt (?:myself|my baby)|harm (?:myself|my baby)|मर ?जाना ?चाह|मरना ?चाह|मर जाऊं|जीने ?का ?मन ?नहीं|जीना ?नहीं|खुद ?को ?(?:नुकसान|मार|खत्म)|(?:बच्चे|बच्ची|बेबी) ?को ?(?:नुकसान|मार|खत्म)|आत्महत्या/, selfNeg: true },
    { code: 'heavy_bleeding', re: /(?:bleed\w*|blood)[^.,;।]{0,12}(?:a lot|heavil\w*|badly|profus\w*|non-?stop|continuous\w*|won't stop|not stopping)|(?:a lot of|lots of|too much|so much) ?(?:blood|bleeding)|(?:bahut|bohot|bhot|zyada|jyada|bhari|heavy|jyada)[^.,;।]{0,18}(?:khoon|khun|blood|bleeding|bleed|rakt)|(?:khoon|khun|bleeding|blood|rakt)[^.,;।]{0,16}(?:bahut|bohot|zyada|jyada|ruk ?nahi|band ?nahi|nahi ?ruk|nahi ?ruk ?raha|heavy|soaking)|pad[^.,;।]{0,20}(?:bhig|bhar|soak|full)|(?:soak\w*|drench\w*)[^.,;।]{0,12}pad|बहुत[^.,;।]{0,12}(?:खून|ब्लीडिंग|रक्त)|(?:खून|ब्लीडिंग|रक्त)[^.,;।]{0,14}(?:बहुत|ज्यादा|रुक नहीं|बंद नहीं)|पैड[^.,;।]{0,16}(?:भीग|भर)/, selfNeg: true },
    { code: 'severe_headache_vision', vision: true, re: /nazar ?(?:dhundh?l\w*|dhundh?a\w*|kam|kamzor|kamjor|blur\w*)|dhundh?l\w* ?(?:dikh\w*|nazar)|kuch ?(?:bhi )?(?:saaf ?)?nahi ?dikh\w*|saaf ?nahi ?dikh\w*|(?:ankh|aankh|aankhon|ankhon)[^.,;।]{0,14}(?:andhera|andher|chamak|tare|dhundh\w*|blur\w*|jhilmil)|(?:aankhon|ankhon) ?(?:ke|ki) ?(?:aage|samne)[^.,;।]{0,10}(?:andhera|chamak|tare|dhundh\w*)|blur(?:ry|red)?\b|blurr\w*|double vision|seeing double|flashing|flashes|spots? (?:in|before)|can ?not see|cant see|vision (?:is |has )?(?:blur\w*|bad|dim|poor|changed|problem)|नज़?र ?(?:धुंधली|धुधली|कम|कमजोर|कमज़ोर|धुंधला)|धुंधला ?(?:दिख|नजर)|धुंधली ?(?:दिख|नजर)|धुंधल\w*|साफ ?नहीं ?दिख|कुछ ?(?:भी )?नहीं ?दिख|आँखों|आंखों[^.,;।]{0,14}(?:अंधेरा|चमक|तारे|धुंधल)|(?:आँखों|आंखों) ?के ?(?:आगे|सामने)[^.,;।]{0,10}(?:अंधेरा|चमक|तारे)|आंखों ?के ?आगे|चमक(?:ती| रही)|जगमग/, selfNeg: false },
    { code: 'chest_breath', re: /(?:seene|sine|sina|chhati|chati|chaati|chest)[^.,;।]{0,16}(?:dard|jakad|bhari|pain|tight\w*|pressure|jalan)|saans ?(?:phool\w*|ful\w*|nahi ?(?:le|aa|aati)|lene ?(?:me|mein|mai) ?(?:takleef|dikkat|problem|mushkil)|(?:me|mein) ?(?:takleef|dikkat|problem))|breath\w* ?(?:difficult\w*|problem|hard|short\w*|trouble)|short(?:ness)? of breath|can ?not breathe|cant breathe|(?:difficulty|trouble) breathing|सीने|छाती[^.,;।]{0,14}(?:दर्द|जकड़न|भारी)|सांस ?(?:फूल|नहीं ?(?:ले|आ)|लेने ?में)|साँस|सांस/, selfNeg: false },
    { code: 'fainting', re: /behosh\w*|hosh ?(?:nahi|kho|me ?nahi)|gir ?(?:gayi|gai|gyi|gayee|padi)|fainted|faint(?:ing)?|passed ?out|blacked ?out|unconscious|confus\w*|samajh ?nahi ?aa|बेहोश|होश ?(?:नहीं|खो)|गिर ?(?:गई|गयी|पड़ी)/, selfNeg: false },
    { code: 'waters_break', re: /(?:paani|pani|paaani|water|waters?)[^.,;।]{0,12}(?:toot\w*|beh\w*|tapak\w*|nikal\w*|leak\w*|break|broke|broken|gir\w*)|(?:toot|beh|tapak|leak)\w* ?(?:gaya|gaya hai|gayi|raha|rahi)[^.,;।]{0,10}(?:paani|pani)|fluid ?leak\w*|leaking ?(?:fluid|water)|पानी[^.,;।]{0,12}(?:टूट|बह|निकल|टपक)|पानी ?की ?थैली/, selfNeg: false },
    { code: 'reduced_movement', re: /(?:baby|bachcha|bacha|bachche|baccha|bachhe|shishu|bacchi|bachchi|pet ?(?:me|mein|ka)? ?(?:baby|bachcha|bacha))[^.,;।]{0,28}(?:hil\w*|move\w*|halchal|harkat|kick\w*|lat|laat)[^.,;।]{0,16}(?:nahi|nahin|nhi|kam|band|slow|less|reduced|stopped|stop\w*)|(?:hilna|halchal|harkat|movement|movements|kicks?|laat|lat)[^.,;।]{0,16}(?:kam|nahi|nahin|nhi|band|slow|less|reduced|stopped|not ?feel\w*|ruk)|baby ?(?:is ?)?not ?moving|(?:not|no|can't|cant) ?feel\w* ?(?:the )?(?:baby|movement|kick)|बच्चा[^.,;।]{0,22}(?:हिल|हलचल|हरकत)[^.,;।]{0,14}(?:नहीं|कम|बंद)|(?:हलचल|हरकत|हिलना|लात)[^.,;।]{0,14}(?:कम|नहीं|बंद)/, selfNeg: true },
    { code: 'contractions', re: /\blabou?r\b|contraction\w*|pains? ?(?:shuru|start\w*|aa ?rah\w*|regular)|(?:regular|baar ?baar|bar ?bar|lagatar|ruk ?ruk ?kar|har (?:\d+|paanch|5|do|teen|10|das)? ?(?:min|minute|mint)\w*)[^.,;।]{0,18}(?:dard|pain|tight\w*)|(?:kamar|pet)[^.,;।]{0,10}(?:dard|jakad)[^.,;।]{0,16}(?:aa ?ke|aa ?kar|aata|aate|aati|baar ?baar|ruk ?ruk|lehar|leher)|dard[^.,;।]{0,10}(?:har|every) ?(?:\d+|paanch|5|10) ?(?:min|minute)|प्रसव|लेबर|(?:नियमित|बार ?बार|लगातार|रुक ?रुक ?कर)[^.,;।]{0,14}दर्द|दर्द[^.,;।]{0,10}(?:शुरू|लहर)/, selfNeg: false },
    { code: 'swelling_sudden', re: /(?:chehre|chehra|chehere|face|muh|munh|haath|hath|hands?|ankh|aankh|eyes?)[^.,;।]{0,18}(?:sooj\w*|soj\w*|sujan|swell\w*|swollen|phool\w*|puff\w*)|(?:sooj\w*|sujan|swell\w*|swollen|puffy)[^.,;।]{0,14}(?:chehre|chehra|face|haath|hath|hands?)|(?:achanak|sudden\w*)[^.,;।]{0,14}(?:sooj\w*|sujan|swell\w*)|चेहरे|मुंह|हाथ[^.,;।]{0,14}(?:सूज|फूल)|(?:सूज|सूजन)[^.,;।]{0,12}(?:चेहरे|हाथ|मुंह)/, selfNeg: false },
    { code: 'vomiting_cannot_drink', re: /(?:ulti|vomit\w*|ultee)[^.,;।]{0,24}(?:ruk ?nahi|nahi ?ruk\w*|baar ?baar|bar ?bar|bahut|bohot|paani ?(?:bhi )?nahi ?(?:tik|ruk)|kuch ?(?:bhi )?nahi ?(?:tik|ruk))|kuch ?(?:bhi )?nahi ?(?:tik|ruk)\w*|(?:can ?not|cant|can't|unable to|not able to) ?(?:keep|hold)[^.,;।]{0,12}(?:down|fluids?|water|food)|vomit\w* ?(?:everything|all ?day|nonstop|non-stop|continuous\w*)|उल्टी[^.,;।]{0,20}(?:रुक ?नहीं|बार ?बार|बहुत|पानी ?भी ?नहीं)/, selfNeg: true },
    { code: 'severe_abdominal_pain', re: /(?:pet|pait|stomach|belly|abdom\w*|पेट)[^.,;।]{0,16}(?:dard|pain|ache|दर्द)[^.,;।]{0,22}(?:bahut|bohot|tez|tej|zyada|jyada|asahya?|severe|ruk ?nahi|kam ?nahi|nahi ?ruk|nahi ?ja|unbearable|worst|बहुत|तेज|ज्यादा|असहनीय|रुक ?नहीं|कम ?नहीं)|(?:pet|pait|stomach|belly|abdom\w*|पेट)[^.,;।]{0,16}(?:bahut|bohot|tez|tej|zyada|jyada|asahya?|severe|unbearable|worst|बहुत|तेज|ज्यादा|असहनीय)[^.,;।]{0,12}(?:dard|pain|ache|दर्द)|(?:bahut|bohot|tez|tej|zyada|jyada|asahya?|severe|unbearable|worst|बहुत|तेज|ज्यादा|असहनीय)[^.,;।]{0,12}(?:pet|pait|stomach|belly|abdom\w*|पेट)[^.,;।]{0,12}(?:dard|pain|दर्द)/, selfNeg: true },
    { code: 'fever', re: /bukh?aa?r|fever|(?:high )?temperature|kaamp\w*|kanp\w*|shiver\w*|chills?|thand ?(?:lag|se)|बुखार|कंपकंपी|ठंड ?लग|कांप/, selfNeg: false },
    { code: 'pp_calf', ctx: 'postpartum', re: /(?:pair|paer|per|leg|calf|tang|taang|panv|paon)[^.,;।]{0,18}(?:dard|pain|sooj\w*|swell\w*|lal|red|garam|warm|hot)|(?:one|ek) ?(?:leg|pair|paer|per)[^.,;।]{0,14}(?:swollen|sooj\w*|painful|dard)|(?:पैर|पांव|टांग)[^.,;।]{0,16}(?:दर्द|सूज|लाल|गर्म)/, selfNeg: false },
    { code: 'pp_wound', ctx: 'postpartum', re: /(?:tanka|taanka|tanke|stitch\w*|sutur\w*|c-?section|cesarean|operation|ghav|ghaav|wound|cut|chira)[^.,;।]{0,22}(?:khul|pus|peep|pip|leak\w*|lal|red|sooj\w*|infect\w*|paka|paki|badbu|smell\w*|ras|discharge)|(?:टांके|टांका|घाव|ऑपरेशन)[^.,;।]{0,18}(?:खुल|मवाद|पीप|लाल|सूज|पक)/, selfNeg: false },
    { code: 'pp_foul_discharge', ctx: 'postpartum', re: /(?:badbu|badboo|bad ?smell|foul|smelly|smelling|stink\w*|बदबू)[^.,;।]{0,22}(?:discharge|safed|paani|pani|lochia|bleeding|khoon|स्त्राव|पानी)|(?:discharge|lochia|khoon|bleeding|स्त्राव)[^.,;।]{0,18}(?:badbu|smell\w*|foul|बदबू)/, selfNeg: false },
    { code: 'pp_breast', ctx: 'postpartum', re: /(?:breast|stan|chhati|chati|dudh|स्तन)[^.,;।]{0,22}(?:lal|red|hard|sakht|kadak|dard|pain\w*|garam|warm|sooj\w*|gaanth|lump)|(?:स्तन)[^.,;।]{0,14}(?:लाल|सख्त|दर्द|गर्म|सूज)/, selfNeg: false },
    { code: 'bleeding_any', ctx: 'pregnant', re: /(?:khoon|khun|blood|bleeding|bleed|spotting|rakt|red ?discharge|lal ?(?:paani|discharge))[^.,;।]{0,16}(?:aa|aaya|aayi|aaye|aata|aati|nikal\w*|dikh\w*|gir\w*|ho ?raha|ho ?rahi|hua|hui|ho ?gaya|ho ?gayi|show\w*|coming|came)|(?:aa|aaya|aayi|nikal\w*|dikh\w*)[^.,;।]{0,10}(?:khoon|blood|bleeding)|spotting|(?:vaginal|योनि)[^.,;।]{0,10}(?:bleeding|खून)|खून[^.,;।]{0,12}(?:आ|निकल|दिख)|ब्लीडिंग|रक्तस्राव/, selfNeg: false }
  ];

  // Soft symptoms: never raise urgency alone. They only steer fixed follow-up questions.
  var SOFT = [
    { soft: 'headache', re: /(?:sir|sar|head|matha|mathe|सिर|सर)[^.,;।]{0,10}(?:dard|pain|ache|bhaari|bhari|dukh|दर्द|भारी)|sar ?dard|sir ?dard|सरदर्द|सिरदर्द|headache|migraine|माथे[^.,;।]{0,6}दर्द/, selfNeg: false },
    { soft: 'dizzy', re: /chakkar|dizz\w*|lightheaded|light headed|sir ?ghoom\w*|ghoom\w*|चक्कर|सिर ?घूम/, selfNeg: false },
    { soft: 'abdominal_pain', re: /(?:pet|pait|stomach|belly|abdom\w*|पेट)[^.,;।]{0,24}(?:dard|pain|ache|दर्द|marod|maror|ऐंठन)|pet ?dard|पेट ?दर्द/, selfNeg: false },
    { soft: 'leg_swelling', re: /(?:pair|paer|per|feet|foot|ankle|taang|panv|paon|पैर|पांव)[^.,;।]{0,16}(?:sooj\w*|soj\w*|sujan|swell\w*|swollen|phool\w*|सूज|फूल)/, selfNeg: false },
    { soft: 'nausea', re: /ji ?michl\w*|mitli|nausea|nauseous|ulti ?(?:jaisa|lag)|जी ?मिचल|उल्टी ?जैसा/, selfNeg: false },
    { soft: 'back_pain', re: /(?:kamar|back|peeth|कमर|पीठ)[^.,;।]{0,10}(?:dard|pain|ache|दर्द)/, selfNeg: false }
  ];

  /* ---------- 3. Clause extraction with safe negation -------------------- */
  function splitClauses(s) {
    return s.split(/(?:[.,;!?।]| aur | and | lekin | par | but | magar | saath ?mein | with | तथा | और | लेकिन | पर | मगर )/).map(function (c) { return c.trim(); }).filter(Boolean);
  }

  function clauseNegates(clause, match) {
    var after = clause.slice(match.index + match[0].length, match.index + match[0].length + 26);
    var before = clause.slice(Math.max(0, match.index - 16), match.index);
    if (PERSIST.test(clause.slice(match.index, match.index + match[0].length + 34))) return false;
    if (NEG_AFTER.test(' ' + after + ' ')) return true;
    if (NEG_BEFORE.test(' ' + before + ' ')) return true;
    return false;
  }

  function extract(text) {
    var norm = normalize(text);
    var clauses = splitClauses(norm);
    var codes = {}, soft = {}, evidence = {}, negated = {}, severe = false, persists = false, crisis = false, vision = false;
    clauses.forEach(function (clause) {
      var cSevere = SEVERE.test(clause);
      var cPersist = PERSIST.test(clause);
      if (cPersist) persists = true;
      LEX.forEach(function (e) {
        var m = clause.match(e.re);
        if (!m) return;
        if (!e.selfNeg && clauseNegates(clause, m)) { negated[e.code] = true; return; }
        codes[e.code] = true;
        if (e.vision) vision = true;
        if (e.crisis) crisis = true;
        if (!evidence[e.code]) evidence[e.code] = m[0].trim().slice(0, 60);
      });
      SOFT.forEach(function (e) {
        var m = clause.match(e.re);
        if (!m) return;
        if (clauseNegates(clause, m)) { negated[e.soft] = true; return; }
        soft[e.soft] = { severe: cSevere, persists: cPersist };
        if (!evidence[e.soft]) evidence[e.soft] = m[0].trim().slice(0, 60);
        if (cSevere) severe = true;
      });
    });
    var normNoNeg = norm;
    var duration = null;
    var dm = normNoNeg.match(/(\d+|ek|do|teen|char|chaar|paanch|panch|aadha|half|one|two|three|four|five|एक|दो|तीन|चार|पांच) ?(din|dino|ghante|ghanta|hafte|haphte|week|weeks|day|days|hour|hours|दिन|घंटे|घंटा|हफ्ते|हफ्ता) ?(?:se|ho|ka|ki|ago|से)?/);
    if (dm) duration = dm[0].trim();
    else if (/\b(?:subah|savere|morning|aaj|today|abhi|just now|ab ?se|अभी|आज|सुबह)\b|अभी|आज|सुबह/.test(normNoNeg)) duration = /abhi|just now|अभी/.test(normNoNeg) ? 'just now' : (/subah|morning|सुबह/.test(normNoNeg) ? 'since morning' : 'today');
    else if (/kal ?se|since yesterday|कल ?से/.test(normNoNeg)) duration = 'since yesterday';
    return { normalized: norm, codes: Object.keys(codes), soft: soft, negated: Object.keys(negated), evidence: evidence, severe: severe, persists: persists, crisis: crisis, vision: vision, duration: duration, bp: parseBP(norm) };
  }

  /* ---------- 4. Blood pressure ------------------------------------------ */
  var BP_PLAUSIBLE = { sMin: 60, sMax: 260, dMin: 30, dMax: 160 };
  function plausibleBP(s, d) { return s >= BP_PLAUSIBLE.sMin && s <= BP_PLAUSIBLE.sMax && d >= BP_PLAUSIBLE.dMin && d <= BP_PLAUSIBLE.dMax && s > d; }

  /** Returns {systolic, diastolic} | {invalid:true} | null. Understands "150/100", "150 by 100", "150 बाय 100", "upar 150 neeche 100", "BP 150 100". */
  function parseBP(text) {
    var s = normalize(text), m;
    m = s.match(/(\d{2,3}) ?(?:\/|\\|-|by|bai|बाय|on|over|upon|se|\bx\b) ?(\d{2,3})/);
    if (!m) m = s.match(/(?:upar|upper|systolic|ऊपर|उपर)[^\d]{0,14}(\d{2,3})[^\d]{1,20}(?:neeche|niche|lower|diastolic|नीचे)[^\d]{0,14}(\d{2,3})/);
    if (!m) m = s.match(/(?:bp|b\.p\.?|blood ?pressure|बीपी|ब्लड ?प्रेशर|प्रेशर)[^\d]{0,22}(\d{2,3})[^\d]{1,12}(\d{2,3})/);
    if (!m) return null;
    var sys = parseInt(m[1], 10), dia = parseInt(m[2], 10);
    if (!plausibleBP(sys, dia)) {
      if (plausibleBP(dia, sys)) return { systolic: dia, diastolic: sys, swapped: true };
      return { invalid: true };
    }
    return { systolic: sys, diastolic: dia };
  }

  /* ---------- 5. Triage with pattern rules -------------------------------- */
  var LEVEL_ORDER = { unsure: 0, urgent: 1, emergency: 2 };
  function maxLevel(a, b) { return LEVEL_ORDER[b] > LEVEL_ORDER[a] ? b : a; }

  function newState(opts) {
    opts = opts || {};
    return {
      context: opts.context === 'postpartum' ? 'postpartum' : 'pregnant',
      gestWeeks: Number.isFinite(opts.gestWeeks) ? opts.gestWeeks : null,
      lang: opts.lang || null,
      codes: [], soft: {}, evidence: {}, bp: null, bpAsked: false, asked: [],
      duration: null, crisis: false, turns: 0, transcript: [], pending: null, confirmed: false
    };
  }

  function mergeState(state, ex, lang) {
    var st = JSON.parse(JSON.stringify(state));
    st.turns += 1;
    st.lang = lang;
    ex.codes.forEach(function (c) { if (st.codes.indexOf(c) < 0) st.codes.push(c); });
    Object.keys(ex.soft).forEach(function (k) { st.soft[k] = ex.soft[k]; });
    Object.keys(ex.evidence).forEach(function (k) { if (!st.evidence[k]) st.evidence[k] = ex.evidence[k]; });
    // A correction ("sir dard ab nahi hai") only removes a *soft* symptom; urgent codes are never silently dropped.
    ex.negated.forEach(function (k) { delete st.soft[k]; });
    if (ex.bp && !ex.bp.invalid) st.bp = { systolic: ex.bp.systolic, diastolic: ex.bp.diastolic };
    if (ex.duration && !st.duration) st.duration = ex.duration;
    if (ex.crisis) st.crisis = true;
    // Soft headache + "very bad / not going" wording => the existing severe-headache rule.
    if (st.soft.headache && (st.soft.headache.severe || st.soft.headache.persists) && st.codes.indexOf('severe_headache_vision') < 0) {
      st.codes.push('severe_headache_vision');
      st.evidence.severe_headache_vision = st.evidence.severe_headache_vision || st.evidence.headache;
    }
    // Soft abdominal pain described as severe/persistent => existing severe-abdominal-pain rule.
    if (st.soft.abdominal_pain && (st.soft.abdominal_pain.severe || st.soft.abdominal_pain.persists) && st.codes.indexOf('severe_abdominal_pain') < 0) {
      st.codes.push('severe_abdominal_pain');
      st.evidence.severe_abdominal_pain = st.evidence.abdominal_pain;
    }
    // Context-only codes are dropped when they do not apply (EM.triage would ignore them anyway).
    return st;
  }

  function evaluate(st) {
    var rules = [];
    var codes = st.codes.filter(function (c) { return c !== 'pp_self_harm'; });
    var bp = st.bp ? { systolic: st.bp.systolic, diastolic: st.bp.diastolic, hoursAgo: 0 } : null;
    var tri = EM.triage(codes, { context: st.context, gestWeeks: st.gestWeeks == null ? undefined : st.gestWeeks, latestBP: bp });
    tri.matched.forEach(function (m) { rules.push((m.code.indexOf('bp_') === 0 ? 'VITAL:' : 'SYMPTOM:') + m.code); });
    var level = tri.level;

    // PATTERN: headache + BP in the high range is an emergency in pregnancy/after birth.
    var hasHeadache = !!st.soft.headache || st.codes.indexOf('severe_headache_vision') >= 0;
    var bpHigh = st.bp && (st.bp.systolic >= 140 || st.bp.diastolic >= 90);
    var bpSevere = st.bp && (st.bp.systolic >= 160 || st.bp.diastolic >= 110);
    if (hasHeadache && bpHigh && level !== 'emergency') { level = 'emergency'; rules.push('PATTERN:headache_with_high_bp'); }
    // PATTERN: sudden face/hand swelling together with headache or vision change.
    if (st.codes.indexOf('swelling_sudden') >= 0 && hasHeadache && level !== 'emergency') { level = 'emergency'; rules.push('PATTERN:swelling_with_headache'); }

    // Possible pre-eclampsia warning flag (wording is a warning sign, never a diagnosis).
    var gestOk = st.context === 'postpartum' || st.gestWeeks == null || st.gestWeeks >= 20;
    var preflag = gestOk && (st.codes.indexOf('severe_headache_vision') >= 0 || bpSevere || rules.indexOf('PATTERN:headache_with_high_bp') >= 0 || rules.indexOf('PATTERN:swelling_with_headache') >= 0 || (st.codes.indexOf('swelling_sudden') >= 0 && st.codes.indexOf('severe_headache_vision') >= 0));
    if (preflag) rules.push('FLAG:possible_preeclampsia_warning');

    // CRISIS: wording about harming self or baby. Always the highest level, any context.
    var crisisTri = null;
    if (st.crisis) {
      crisisTri = EM.triage(['pp_self_harm'], { context: 'postpartum' });
      level = 'emergency'; rules.push('SYMPTOM:pp_self_harm');
    }
    var mergedMatched = tri.matched.slice();
    if (crisisTri) crisisTri.matched.forEach(function (m) { mergedMatched.push(m); });
    var firstAid = tri.firstAid.slice();
    if (crisisTri) crisisTri.firstAid.forEach(function (l) { if (firstAid.indexOf(l) < 0) firstAid.push(l); });
    var numbers = (crisisTri ? EM.triage(['pp_self_harm'], { context: 'postpartum' }).numbers : tri.numbers);
    if (level === 'emergency' && !crisisTri) numbers = tri.level === 'emergency' ? tri.numbers : EM.triage(['heavy_bleeding'], { context: st.context }).numbers;

    return {
      level: level, preeclampsiaWarning: !!preflag, bpSevere: !!bpSevere, bpHigh: !!bpHigh, crisis: !!st.crisis,
      matched: mergedMatched, rules: rules, firstAid: firstAid, numbers: numbers,
      symptomCodes: st.codes.slice()
    };
  }

  /* ---------- 6. Templates (fixed text only) ------------------------------ */
  // {bp} is the only numeric slot; it is filled from the parsed reading, never from free text.
  var T = {
    en: {
      emergency_head: 'This could be serious. Please get emergency help now. Call 112, or 108 if it works in your area.',
      emergency_company: 'Do not go alone and do not drive yourself. Ask someone to stay with you.',
      preeclampsia: 'A headache or blurred vision during pregnancy can be a warning sign of very high blood pressure, called pre-eclampsia. This is a warning, not a diagnosis. It needs checking right now.',
      bp_ask: 'If you have a blood pressure machine at hand, tell me the reading, like 150 by 100. But do not wait for it. Call for help first.',
      bp_echo_severe: 'You said {bp}. That is in the severe range. Go to emergency care now.',
      bp_echo_high: 'You said {bp}. That is high. Together with your symptoms it needs a doctor right now.',
      bp_echo_ok: 'You said {bp}. That number alone looks lower, but your symptoms still need a doctor right now.',
      bp_echo_ok_urgent: 'You said {bp}. That number is not in the high range. Still, please see a doctor today because of your symptoms.',
      bp_invalid: 'I could not catch the blood pressure numbers. Please say them like 150 by 100.',
      urgent_head: 'Please speak to a doctor or go to a health facility today. Do not wait.',
      urgent_more: 'If you feel worse, feel faint, or anything gets worse, call 112 straight away.',
      crisis: 'I am sorry you are feeling this way. You are not alone, and help works. Please tell someone near you right now and do not stay alone. You can call Tele-MANAS on 14416 any time, or 112 if you may harm yourself or your baby. Please keep your baby with another adult.',
      q_vision: 'Is your vision blurred, or do you see flashing lights? And how bad is the headache?',
      q_headache: 'How strong is the headache, and does it go away with rest?',
      q_dizzy: 'Did you faint or nearly fall, or do you only feel dizzy?',
      q_abdomen: 'How strong is the belly pain? Does it come and go, or is it constant?',
      q_fever: 'Have you measured your temperature? Please tell me the reading if you have.',
      q_leg_swell: 'Is the swelling sudden, or is it also on your face or hands?',
      q_bleeding: 'How much blood is there? Is it only spotting, or does it soak a pad in an hour?',
      q_none: 'I did not catch a symptom. Please tell me where it hurts or what is wrong, in your own words.',
      q_more: 'Is there anything else you are feeling?',
      saved_ask: 'I have written this down for your timeline. Shall I save it?',
      saved_ok: 'Saved to your care timeline. Your care team can review it.',
      unsure_head: 'I noted what you said. If you are worried about anything, please call your doctor or the facility. You do not need to be sure.',
      review: 'A clinician should review this note. I only guide, I do not diagnose.',
      listen_prompt: 'Please tell me what you are feeling.',
      guide_note: 'I am Dai Didi, a voice guide. I do not diagnose.'
    },
    hinglish: {
      emergency_head: 'Yeh gambhir ho sakta hai. Abhi emergency madad lijiye. 112 par call kijiye, ya 108 agar aapke ilaake mein chalta hai.',
      emergency_company: 'Akele mat jaiye aur khud gaadi mat chalaiye. Kisi ko apne saath rakhiye.',
      preeclampsia: 'Pregnancy mein sir dard ya nazar dhundhli hona bahut high BP ka sanket ho sakta hai, jise pre-eclampsia kehte hain. Yeh sirf chetavni hai, diagnosis nahi. Abhi jaanch zaroori hai.',
      bp_ask: 'Agar aapke paas BP machine hai to reading bataiye, jaise 150 by 100. Lekin uska intezaar mat kijiye. Pehle madad bulaiye.',
      bp_echo_severe: 'Aapne {bp} bataya. Yeh bahut high range mein hai. Abhi emergency care mein jaiye.',
      bp_echo_high: 'Aapne {bp} bataya. Yeh high hai. Aapke lakshanon ke saath abhi doctor ko dikhana zaroori hai.',
      bp_echo_ok: 'Aapne {bp} bataya. Sirf yeh number kam lagta hai, lekin aapke lakshanon ke kaaran abhi bhi doctor ko dikhana zaroori hai.',
      bp_echo_ok_urgent: 'Aapne {bp} bataya. Yeh number high range mein nahi hai. Phir bhi lakshanon ke kaaran aaj doctor ko dikhaiye.',
      bp_invalid: 'Mujhe BP ke number samajh nahi aaye. Kripya aise boliye: 150 by 100.',
      urgent_head: 'Kripya aaj hi doctor se baat kijiye ya health facility jaiye. Intezaar mat kijiye.',
      urgent_more: 'Agar aap zyada kharab mehsoos karein, chakkar aayein, ya kuch aur badhe, to turant 112 par call kijiye.',
      crisis: 'Mujhe afsos hai ki aap aisa mehsoos kar rahi hain. Aap akeli nahi hain, aur madad se fark padta hai. Kripya abhi apne paas kisi ko bataiye aur akeli mat rahiye. Aap kabhi bhi Tele-MANAS 14416 par call kar sakti hain, ya 112 agar aap khud ko ya apne baby ko nuksan pahuncha sakti hain. Baby ko kisi aur vayask ke paas rakhiye.',
      q_vision: 'Kya aapki nazar dhundhli hai, ya chamak dikh rahi hai? Aur sir dard kitna tez hai?',
      q_headache: 'Sir dard kitna tez hai, aur kya aaram karne se kam hota hai?',
      q_dizzy: 'Kya aap behosh hui ya girne wali thi, ya sirf chakkar aa rahe hain?',
      q_abdomen: 'Pet dard kitna tez hai? Kya ruk ruk kar aata hai ya lagatar rehta hai?',
      q_fever: 'Kya aapne bukhar naapa hai? Agar haan to reading bataiye.',
      q_leg_swell: 'Kya sujan achanak aayi hai, ya chehre ya haathon par bhi hai?',
      q_bleeding: 'Kitna khoon aa raha hai? Sirf halka daag hai, ya ek ghante mein pad bhig jaata hai?',
      q_none: 'Mujhe koi takleef samajh nahi aayi. Kripya apne shabdon mein bataiye ki kahan dard hai ya kya dikkat hai.',
      q_more: 'Kya aur kuch mehsoos ho raha hai?',
      saved_ask: 'Maine yeh aapke timeline ke liye likh liya hai. Kya main ise save kar doon?',
      saved_ok: 'Aapke care timeline mein save ho gaya. Aapki care team ise dekh sakti hai.',
      unsure_head: 'Maine aapki baat note kar li. Agar kisi bhi baat ki chinta ho to doctor ya facility ko call kijiye. Pakka hona zaroori nahi hai.',
      review: 'Kisi clinician ko yeh note dekhna chahiye. Main sirf margdarshan deti hoon, diagnosis nahi.',
      listen_prompt: 'Kripya bataiye aap kya mehsoos kar rahi hain.',
      guide_note: 'Main Dai Didi hoon, ek voice guide. Main diagnosis nahi karti.'
    },
    hi: {
      emergency_head: 'यह गंभीर हो सकता है। अभी आपातकालीन मदद लीजिए। 112 पर कॉल कीजिए, या 108 अगर आपके इलाके में चलता है।',
      emergency_company: 'अकेले मत जाइए और खुद गाड़ी मत चलाइए। किसी को अपने साथ रखिए।',
      preeclampsia: 'गर्भावस्था में सिर दर्द या नज़र धुंधली होना बहुत ऊँचे बीपी का संकेत हो सकता है, जिसे प्री-एक्लेम्पसिया कहते हैं। यह सिर्फ़ चेतावनी है, निदान नहीं। अभी जाँच ज़रूरी है।',
      bp_ask: 'अगर आपके पास बीपी मशीन है तो रीडिंग बताइए, जैसे 150 बाय 100। लेकिन उसका इंतज़ार मत कीजिए। पहले मदद बुलाइए।',
      bp_echo_severe: 'आपने {bp} बताया। यह बहुत ऊँचे दायरे में है। अभी आपातकालीन देखभाल के लिए जाइए।',
      bp_echo_high: 'आपने {bp} बताया। यह ऊँचा है। आपके लक्षणों के साथ अभी डॉक्टर को दिखाना ज़रूरी है।',
      bp_echo_ok: 'आपने {bp} बताया। सिर्फ़ यह संख्या कम लगती है, लेकिन आपके लक्षणों की वजह से अभी भी डॉक्टर को दिखाना ज़रूरी है।',
      bp_echo_ok_urgent: 'आपने {bp} बताया। यह संख्या ऊँचे दायरे में नहीं है। फिर भी लक्षणों की वजह से आज डॉक्टर को दिखाइए।',
      bp_invalid: 'मुझे बीपी की संख्या समझ नहीं आई। कृपया ऐसे बोलिए: 150 बाय 100।',
      urgent_head: 'कृपया आज ही डॉक्टर से बात कीजिए या स्वास्थ्य केंद्र जाइए। इंतज़ार मत कीजिए।',
      urgent_more: 'अगर आप ज़्यादा खराब महसूस करें, चक्कर आएँ, या कुछ और बढ़े, तो तुरंत 112 पर कॉल कीजिए।',
      crisis: 'मुझे अफ़सोस है कि आप ऐसा महसूस कर रही हैं। आप अकेली नहीं हैं, और मदद से फ़र्क पड़ता है। कृपया अभी अपने पास किसी को बताइए और अकेली मत रहिए। आप कभी भी टेली-मानस 14416 पर कॉल कर सकती हैं, या 112 अगर आप खुद को या अपने बच्चे को नुकसान पहुँचा सकती हैं। बच्चे को किसी और वयस्क के पास रखिए।',
      q_vision: 'क्या आपकी नज़र धुंधली है, या चमक दिख रही है? और सिर दर्द कितना तेज़ है?',
      q_headache: 'सिर दर्द कितना तेज़ है, और क्या आराम करने से कम होता है?',
      q_dizzy: 'क्या आप बेहोश हुईं या गिरने वाली थीं, या सिर्फ़ चक्कर आ रहे हैं?',
      q_abdomen: 'पेट दर्द कितना तेज़ है? क्या रुक रुक कर आता है या लगातार रहता है?',
      q_fever: 'क्या आपने बुखार नापा है? अगर हाँ तो रीडिंग बताइए।',
      q_leg_swell: 'क्या सूजन अचानक आई है, या चेहरे या हाथों पर भी है?',
      q_bleeding: 'कितना खून आ रहा है? सिर्फ़ हल्का दाग है, या एक घंटे में पैड भीग जाता है?',
      q_none: 'मुझे कोई तकलीफ़ समझ नहीं आई। कृपया अपने शब्दों में बताइए कि कहाँ दर्द है या क्या दिक्कत है।',
      q_more: 'क्या और कुछ महसूस हो रहा है?',
      saved_ask: 'मैंने यह आपके टाइमलाइन के लिए लिख लिया है। क्या मैं इसे सेव कर दूँ?',
      saved_ok: 'आपके केयर टाइमलाइन में सेव हो गया। आपकी केयर टीम इसे देख सकती है।',
      unsure_head: 'मैंने आपकी बात नोट कर ली। अगर किसी भी बात की चिंता हो तो डॉक्टर या स्वास्थ्य केंद्र को कॉल कीजिए। पक्का होना ज़रूरी नहीं है।',
      review: 'किसी क्लिनिशियन को यह नोट देखना चाहिए। मैं सिर्फ़ मार्गदर्शन करती हूँ, निदान नहीं।',
      listen_prompt: 'कृपया बताइए आप क्या महसूस कर रही हैं।',
      guide_note: 'मैं दाई दीदी हूँ, एक आवाज़ वाली गाइड। मैं निदान नहीं करती।'
    }
  };

  function tpl(lang, id, bp) {
    var set = T[lang] || T.en;
    var s = set[id];
    if (bp) s = s.replace('{bp}', bp.systolic + ' by ' + bp.diastolic);
    return s;
  }

  /** Every utterance Didi may speak, as regex, for server-side speech approval. */
  function templateRegexes(lang) {
    var set = T[lang === 'hi' || lang === 'hinglish' || lang === 'en' ? lang : 'en'];
    return Object.keys(set).map(function (k) {
      var esc = set[k].replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace('\\{bp\\}', '\\d{2,3} (?:by|बाय) \\d{2,3}').replace('{bp}', '\\d{2,3} (?:by|बाय) \\d{2,3}');
      return new RegExp('^' + esc + '$');
    });
  }
  // Didi's spoken text is fragments joined by "\n". Approved only if every fragment is a known template.
  function isApprovedUtterance(text, lang) {
    if (typeof text !== 'string' || !text.trim() || text.length > 1500) return false;
    var regexes = templateRegexes(lang);
    // BP echo uses "{bp}" -> "150 by 100" in every language (digits are read aloud as numbers).
    return text.split('\n').every(function (frag) {
      frag = frag.trim();
      if (!frag) return true;
      return regexes.some(function (re) { return re.test(frag); });
    });
  }

  /* ---------- 7. One conversation turn ------------------------------------ */
  function pickQuestion(st, ev) {
    var asked = st.asked;
    function once(id) { if (asked.indexOf(id) >= 0) return false; asked.push(id); return true; }
    if (st.crisis) return null;
    if (st.bp == null && ev.preeclampsiaWarning && once('bp')) { st.bpAsked = true; return 'bp_ask'; }
    if (st.soft.headache && st.codes.indexOf('severe_headache_vision') < 0 && once('vision')) return 'q_vision';
    if (st.soft.dizzy && st.codes.indexOf('fainting') < 0 && once('dizzy')) return 'q_dizzy';
    if (st.soft.abdominal_pain && st.codes.indexOf('severe_abdominal_pain') < 0 && once('abdomen')) return 'q_abdomen';
    if (st.codes.indexOf('fever') >= 0 && once('fever')) return 'q_fever';
    if (st.soft.leg_swelling && st.codes.indexOf('swelling_sudden') < 0 && once('legswell')) return 'q_leg_swell';
    if (st.codes.indexOf('bleeding_any') >= 0 && st.codes.indexOf('heavy_bleeding') < 0 && once('bleeding')) return 'q_bleeding';
    return null;
  }

  function hasAnySymptom(st) { return st.codes.length > 0 || Object.keys(st.soft).length > 0 || st.crisis; }

  /**
   * Pure function. Same input -> same output. No network, no model.
   * @param {object} state  from newState() or a previous turn's result.state
   * @param {string} transcript what the mother said (any script)
   * @param {object} opts { langHint }
   * @returns {{state, language, extracted, evaluation, fragments, text, question, entry, actions}}
   */
  function processTurn(state, transcript, opts) {
    opts = opts || {};
    var st0 = state || newState(opts);
    var lang = opts.forceLang || detectLanguage(transcript, opts.langHint || st0.lang);
    var ex = extract(transcript);
    var st = mergeState(st0, ex, lang);
    st.transcript.push({ who: 'mother', text: String(transcript || '').slice(0, 500) });

    var invalidBp = !!(ex.bp && ex.bp.invalid);
    var ev = evaluate(st);
    var fragments = [];

    if (!hasAnySymptom(st) && !st.bp) {
      fragments.push(tpl(lang, st.turns > 1 ? 'q_none' : 'q_none'));
      var emptyRes = finalize(st, ev, fragments, null, lang, ex);
      return emptyRes;
    }

    if (ev.crisis) {
      fragments.push(tpl(lang, 'crisis'));
    } else if (ev.level === 'emergency') {
      fragments.push(tpl(lang, 'emergency_head'));
      fragments.push(tpl(lang, 'emergency_company'));
      if (ev.preeclampsiaWarning) fragments.push(tpl(lang, 'preeclampsia'));
    } else if (ev.level === 'urgent') {
      fragments.push(tpl(lang, 'urgent_head'));
      fragments.push(tpl(lang, 'urgent_more'));
    }

    if (ex.bp && !ex.bp.invalid && !ev.crisis) {
      var id = ev.bpSevere ? 'bp_echo_severe' : ev.bpHigh ? 'bp_echo_high' : (ev.level === 'emergency' ? 'bp_echo_ok' : 'bp_echo_ok_urgent');
      fragments.push(tpl(lang, id, st.bp));
    }
    if (invalidBp) fragments.push(tpl(lang, 'bp_invalid'));

    var q = pickQuestion(st, ev);
    if (q) fragments.push(tpl(lang, q));

    if (ev.level === 'unsure' && !q && !ev.crisis) fragments.push(tpl(lang, 'unsure_head'));
    if (!q && !invalidBp) fragments.push(tpl(lang, 'saved_ask'));
    return finalize(st, ev, fragments, q, lang, ex);
  }

  function finalize(st, ev, fragments, q, lang, ex) {
    var text = fragments.join('\n');
    st.transcript.push({ who: 'didi', text: text });
    var emergency = ev.level === 'emergency';
    return {
      state: st, language: lang, extracted: ex, evaluation: ev, fragments: fragments, text: text, question: q,
      actions: {
        openEmergencyFlow: emergency,                         // UI opens the existing SOS flow
        emergencyPreset: emergency ? { context: st.context, codes: ev.symptomCodes.filter(function (c) { return c !== 'pp_self_harm'; }).concat(ev.crisis && st.context === 'postpartum' ? ['pp_self_harm'] : []), note: noteFrom(st) } : null,
        askBP: q === 'bp_ask',
        offerSave: !q && hasAnySymptom(st),
        numbers: ev.numbers
      },
      entry: hasAnySymptom(st) || st.bp ? buildEntry(st, ev, lang) : null
    };
  }

  function noteFrom(st) {
    var bits = [];
    if (st.bp) bits.push('BP told by voice: ' + st.bp.systolic + '/' + st.bp.diastolic);
    if (st.duration) bits.push('Since: ' + st.duration);
    bits.push('Reported by voice (Dai Didi).');
    return bits.join('. ').slice(0, 480);
  }

  /* ---------- 8. Structured timeline entry --------------------------------- */
  var SOFT_LABELS = { headache: 'Headache', dizzy: 'Dizziness', abdominal_pain: 'Belly pain', leg_swelling: 'Swelling of feet/legs', nausea: 'Nausea', back_pain: 'Back pain' };

  function buildEntry(st, ev, lang, nowMs) {
    var now = Number.isFinite(nowMs) ? nowMs : Date.now();
    var symptoms = ev.matched.map(function (m) { return { code: m.code, label: m.label, level: m.level, evidence: st.evidence[m.code] || null }; });
    var others = Object.keys(st.soft).filter(function (k) { return st.soft[k]; }).map(function (k) { return { code: k, label: SOFT_LABELS[k] || k, evidence: st.evidence[k] || null }; });
    var hitRule = ev.rules.length > 0;
    return {
      kind: 'voice_symptom_report',
      source: 'dai_didi',
      recorded_at: new Date(now).toISOString(),
      language: lang,
      context: st.context,
      gest_weeks: st.gestWeeks,
      duration: st.duration || null,
      symptoms: symptoms,
      other_symptoms: others,
      vitals: st.bp ? { blood_pressure: { systolic: st.bp.systolic, diastolic: st.bp.diastolic, unit: 'mmHg', source: 'self_reported_by_voice' } } : {},
      triage: { level: ev.level, rule_ids: ev.rules, decided_by: 'fixed_rules', preeclampsia_warning: ev.preeclampsiaWarning, crisis: ev.crisis },
      escalation: { emergency_flow_suggested: ev.level === 'emergency', numbers: (ev.numbers || []).map(function (n) { return { number: n.number, label: n.label }; }) },
      review: {
        status: ev.level !== 'unsure' ? 'clinician_review_required' : (others.length || !hitRule ? 'clinician_review_suggested' : 'rule_hit_logged'),
        reason: ev.level !== 'unsure' ? 'A fixed rule flagged urgency. A clinician should confirm.' : 'Free-text voice report with no urgent rule hit. A clinician may want to read it.'
      },
      turns: st.turns,
      disclaimer: 'Guidance from fixed rules, not a diagnosis. Self-reported by voice. Not verified by a clinician.'
    };
  }

  return {
    normalize: normalize, detectLanguage: detectLanguage, extract: extract, parseBP: parseBP,
    newState: newState, processTurn: processTurn, evaluate: evaluate, buildEntry: buildEntry,
    templates: T, tpl: tpl, isApprovedUtterance: isApprovedUtterance, LEX: LEX, SOFT: SOFT
  };
});
