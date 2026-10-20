/**
 * Shared client-side form validation with accessible error messages.
 * Use form[data-validate] and inputs with data-rules="required|email|phone|min:N|max:N"
 * and a sibling/span [data-error-for="fieldName"].
 */
(function (global) {
  'use strict';

  function msg(key, fallback) {
    return (window.DaiI18n && window.DaiI18n.t(key)) || fallback;
  }

  function clearErrors(form) {
    form.querySelectorAll('[data-error-for]').forEach(function (n) {
      n.textContent = '';
      n.hidden = true;
    });
    form.querySelectorAll('[aria-invalid="true"]').forEach(function (el) {
      el.removeAttribute('aria-invalid');
    });
  }

  function showError(form, name, text) {
    var field = form.querySelector('[name="' + name + '"]') || form.querySelector('#' + name);
    var slot = form.querySelector('[data-error-for="' + name + '"]');
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-describedby', 'err-' + name);
    }
    if (slot) {
      slot.id = 'err-' + name;
      slot.textContent = text;
      slot.hidden = false;
      slot.setAttribute('role', 'alert');
    }
  }

  function validateField(field) {
    var rules = (field.getAttribute('data-rules') || '').split('|').filter(Boolean);
    var value = (field.value || '').trim();
    var name = field.name || field.id;
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (rule === 'required' && !value) {
        return { name: name, message: msg('form.required', 'This field is required') };
      }
      if (rule === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return { name: name, message: msg('form.invalid_email', 'Enter a valid email address') };
      }
      if (rule === 'phone' && value) {
        var digits = value.replace(/\D/g, '');
        if (digits.length === 12 && digits.indexOf('91') === 0) digits = digits.slice(2);
        if (!/^[6-9]\d{9}$/.test(digits)) {
          return { name: name, message: msg('form.invalid_phone', 'Enter a valid 10-digit mobile number') };
        }
      }
      if (rule.indexOf('min:') === 0 && value.length < parseInt(rule.slice(4), 10)) {
        return { name: name, message: 'Minimum ' + rule.slice(4) + ' characters' };
      }
      if (rule.indexOf('max:') === 0 && value.length > parseInt(rule.slice(4), 10)) {
        return { name: name, message: 'Maximum ' + rule.slice(4) + ' characters' };
      }
    }
    return null;
  }

  function validateForm(form) {
    clearErrors(form);
    var fields = form.querySelectorAll('[data-rules]');
    var errors = [];
    fields.forEach(function (f) {
      var e = validateField(f);
      if (e) {
        errors.push(e);
        showError(form, e.name, e.message);
      }
    });
    if (errors.length) {
      var first = form.querySelector('[name="' + errors[0].name + '"]') || form.querySelector('#' + errors[0].name);
      if (first) first.focus();
      return false;
    }
    return true;
  }

  function attach(form) {
    if (!form || form.__daiValidate) return;
    form.__daiValidate = true;
    form.addEventListener('submit', function (ev) {
      if (!validateForm(form)) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    });
    form.querySelectorAll('[data-rules]').forEach(function (f) {
      f.addEventListener('blur', function () {
        var e = validateField(f);
        var name = f.name || f.id;
        var slot = form.querySelector('[data-error-for="' + name + '"]');
        if (e) showError(form, e.name, e.message);
        else if (slot) {
          slot.textContent = '';
          slot.hidden = true;
          f.removeAttribute('aria-invalid');
        }
      });
    });
  }

  function autoAttach() {
    document.querySelectorAll('form[data-validate]').forEach(attach);
  }

  global.DaiValidate = { validateForm: validateForm, attach: attach, autoAttach: autoAttach, clearErrors: clearErrors };
  document.addEventListener('DOMContentLoaded', autoAttach);
})(typeof window !== 'undefined' ? window : this);
