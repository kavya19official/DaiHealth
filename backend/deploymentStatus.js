'use strict';

// Public deployment metadata only. Never return credentials or provider settings.
function deploymentStatus(env = process.env) {
  const revision = env.RENDER_GIT_COMMIT || '';
  const enabled = key => env[key] === 'true';
  return {
    commit: /^[a-f0-9]{7,40}$/i.test(revision) ? revision : null,
    hostedDemo: enabled('DAI_HOSTED_DEMO'),
    configuredFeatures: {
      nivaraDemo: enabled('DAI_SEED_NIVARA_DEMO'),
      ultrasound: enabled('DAI_ULTRASOUND_ENABLED'),
      patientRanking: enabled('ML_ENABLED') && enabled('PATIENT_ML_RANKING_ENABLED'),
      pendingCareAssistant: enabled('PENDING_CARE_ASSISTANT'),
      pendingCarePlanner: enabled('PENDING_CARE_PLANNER'),
    },
  };
}

module.exports = { deploymentStatus };
