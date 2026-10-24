"""Serving-compatible estimators; engineered inputs never use outcomes or identifiers."""
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


def enrich(frame):
    x = frame.copy()
    if 'prior_missed_visits' in x:
        x['distance_km'] = x.distance_km.clip(upper=60)
        # Channel numbers are identifiers, not an ordered numeric scale.
        preferred = x.pop('preferred_channel')
        for channel in range(4):
            x[f'pref_{channel}'] = (preferred == channel).astype(float)
        if 'channel' in x:
            current = x.pop('channel')
            x['channel_match'] = (current == preferred).astype(float)
            x['digital_app_or_whatsapp'] = ((x.digital_literacy > 0) & current.isin([0, 2])).astype(float)
            for channel in range(4):
                x[f'channel_{channel}'] = (current == channel).astype(float)
            x['evening'] = (x.hour >= 18).astype(float)
    return x


class AssistanceEstimator:
    def __init__(self, estimator, engineered=True):
        self.estimator = estimator
        self.engineered = engineered

    def transform(self, frame):
        return enrich(frame) if self.engineered else frame

    def fit(self, frame, y, **kwargs):
        x = self.transform(frame)
        self.feature_names_ = list(x.columns)
        self.estimator.fit(x, y, **kwargs)
        return self

    def predict(self, frame):
        return self.estimator.predict(self.transform(frame))

    def predict_proba(self, frame):
        return self.estimator.predict_proba(self.transform(frame))

    @property
    def feature_importances_(self):
        if hasattr(self.estimator, 'feature_importances_'):
            return self.estimator.feature_importances_
        return np.abs(self.estimator[-1].coef_[0])


def logistic_candidate(c):
    return AssistanceEstimator(make_pipeline(StandardScaler(), LogisticRegression(C=c, max_iter=1000)))
