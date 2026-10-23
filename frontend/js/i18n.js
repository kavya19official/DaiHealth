/**
 * English / Hindi i18n for DaiHealth patient UI.
 * Strings marked for clinical review should be verified by a clinician before production.
 */
(function (global) {
  'use strict';

  var STRINGS = {
    en: {
      'nav.dashboard': 'Dashboard',
      'nav.profile': 'Mother / Patient',
      'nav.child': 'Child',
      'nav.appointments': 'Appointments',
      'nav.timeline': 'Care Timeline',
      'nav.records': 'Records',
      'nav.messages': 'Messages',
      'nav.settings': 'Settings',
      'settings.title': 'Settings',
      'settings.lang': 'Language',
      'settings.notif': 'Notification preferences',
      'settings.privacy': 'Privacy controls',
      'settings.save': 'Save settings',
      'settings.logout': 'Log out',
      'settings.saved': 'Settings saved',
      'notif.appt': 'Appointment reminders',
      'notif.vax': 'Vaccination due / missed',
      'notif.growth': 'Growth alerts',
      'notif.care': 'Care timeline gaps',
      'notif.sms': 'SMS alerts',
      'privacy.share_doctors': 'Share records with linked doctors',
      'privacy.analytics': 'Allow anonymous product analytics',
      'form.required': 'This field is required',
      'form.invalid_email': 'Enter a valid email address',
      'form.invalid_phone': 'Enter a valid 10-digit mobile number',
      'a11y.menu': 'Open navigation menu',
      'a11y.close': 'Close navigation menu',
      'a11y.skip': 'Skip to main content',
      'search.placeholder': 'Search anything...'
    },
    hi: {
      'nav.dashboard': 'डैशबोर्ड',
      'nav.profile': 'माँ / रोगी',
      'nav.child': 'बच्चा',
      'nav.appointments': 'अपॉइंटमेंट',
      'nav.timeline': 'देखभाल समयरेखा',
      'nav.records': 'रिकॉर्ड',
      'nav.messages': 'संदेश',
      'nav.settings': 'सेटिंग्स',
      'settings.title': 'सेटिंग्स',
      'settings.lang': 'भाषा',
      'settings.notif': 'सूचना प्राथमिकताएँ',
      'settings.privacy': 'गोपनीयता नियंत्रण',
      'settings.save': 'सेटिंग्स सहेजें',
      'settings.logout': 'लॉग आउट',
      'settings.saved': 'सेटिंग्स सहेजी गईं',
      'notif.appt': 'अपॉइंटमेंट अनुस्मारक',
      'notif.vax': 'टीकाकरण देय / छूटा',
      'notif.growth': 'वृद्धि अलर्ट',
      'notif.care': 'देखभाल समयरेखा अंतर',
      'notif.sms': 'SMS अलर्ट',
      'privacy.share_doctors': 'लिंक किए गए डॉक्टरों के साथ रिकॉर्ड साझा करें',
      'privacy.analytics': 'अनाम उत्पाद विश्लेषण की अनुमति दें',
      'form.required': 'यह फ़ील्ड आवश्यक है',
      'form.invalid_email': 'मान्य ईमेल पता दर्ज करें',
      'form.invalid_phone': 'मान्य 10 अंकों का मोबाइल नंबर दर्ज करें',
      'a11y.menu': 'नेविगेशन मेनू खोलें',
      'a11y.close': 'नेविगेशन मेनू बंद करें',
      'a11y.skip': 'मुख्य सामग्री पर जाएँ',
      'search.placeholder': 'कुछ भी खोजें...'
    }
  };

  var KEY = 'dai_lang';
  var lang = localStorage.getItem(KEY) || 'en';
  if (!STRINGS[lang]) lang = 'en';

  function t(key) {
    return (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
  }

  function setLang(next) {
    if (!STRINGS[next]) return;
    lang = next;
    localStorage.setItem(KEY, lang);
    document.documentElement.lang = lang;
    applyDom();
    try {
      window.dispatchEvent(new CustomEvent('dai:lang', { detail: { lang: lang } }));
    } catch (e) {}
  }

  function applyDom() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var k = el.getAttribute('data-i18n');
      if (k) el.textContent = t(k);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var k = el.getAttribute('data-i18n-aria');
      if (k) el.setAttribute('aria-label', t(k));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var k = el.getAttribute('data-i18n-placeholder');
      if (k) el.setAttribute('placeholder', t(k));
    });
  }

  function getLang() {
    return lang;
  }

  global.DaiI18n = { registerLocale: function(code, values) { STRINGS[code] = Object.assign({}, STRINGS.en, STRINGS[code] || {}, values); }, t: t, setLang: setLang, getLang: getLang, applyDom: applyDom };
  document.addEventListener('DOMContentLoaded', function () {
    document.documentElement.lang = lang;
    applyDom();
  });
})(typeof window !== 'undefined' ? window : this);
