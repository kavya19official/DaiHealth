'use strict';
// Fictional video persona. Dates are fixed; gestational age advances normally.
module.exports = {
  sourceId: 'MOTHER-SYN-0000001',
  name: 'Nivara Sethi',
  email: 'nivara@dai-synthetic.invalid',
  recordId: 'DAI-DEMO-NIVARA-001',
  lmp: '2026-05-11',
  edd: '2027-02-15',
  previousBirth: '2024-05-18',
  history: 'G2 P1 L1. One previous caesarean for breech presentation on 18 May 2024. No previous stillbirth.',
  concerns: 'Prior caesarean and anaemia. No hypertension or gestational diabetes diagnosis recorded.',
  dating: '8 July 2026 dating scan: 8 weeks 2 days; EDD 15 February 2027 confirmed by Dr Hemangini Batra. 1 October 2026 anatomy report reviewed. Fictional demo record.',
  context: {
    plurality: 'single', chorionicity: 'unknown', uncomplicated: false,
    dating_method: 'ultrasound', edd: '2027-02-15',
    conditions: {previous_caesarean: 'yes', anaemia: 'yes', hypertension: 'no', gdm: 'no', previous_stillbirth: 'no', rh_negative: 'no', cardiac_disease: 'unknown', ivf: 'unknown'},
    visits: [], growth: [], thresholds: [], plan_approved: false
  }
};
