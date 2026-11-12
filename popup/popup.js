(function() {
  'use strict';

  const browserAPI = (typeof browser !== 'undefined') ? browser : chrome;
  const selectEl = document.getElementById('targetLangSelect');
  const noticeEl = document.getElementById('saveNotice');
  const githubLink = document.getElementById('githubLink');

  let noticeTimeout = null;
  let saveDebounceTimer = null;

  function showSaveFeedback() {
    if (!noticeEl) return;
    noticeEl.classList.add('show');
    clearTimeout(noticeTimeout);
    noticeTimeout = setTimeout(() => {
      noticeEl.classList.remove('show');
    }, 2000);
  }

  // Load saved language
  function loadSettings() {
    try {
      browserAPI.storage.local.get(['targetLang'], (result) => {
        if (browserAPI.runtime.lastError) {
          console.error('Failed to load settings:', browserAPI.runtime.lastError);
          return;
        }
        if (result && result.targetLang && selectEl) {
          selectEl.value = result.targetLang;
        } else if (selectEl) {
          selectEl.value = 'en';
        }
      });
    } catch (e) {
      console.error('Storage access error:', e);
    }
  }

  // Save selected language
  function saveSettings(newLang) {
    try {
      browserAPI.storage.local.set({ targetLang: newLang }, () => {
        if (browserAPI.runtime.lastError) {
          console.error('Failed to save settings:', browserAPI.runtime.lastError);
          return;
        }
        showSaveFeedback();
      });
    } catch (e) {
      console.error('Storage save error:', e);
    }
  }

  if (selectEl) {
    selectEl.addEventListener('change', (e) => {
      const newLang = e.target.value;
      clearTimeout(saveDebounceTimer);
      saveDebounceTimer = setTimeout(() => {
        saveSettings(newLang);
      }, 80);
    });
  }

  if (githubLink) {
    githubLink.addEventListener('click', (e) => {
      e.preventDefault();
      const targetUrl = githubLink.getAttribute('href') || 'https://github.com/AenR/podil-translator';
      if (browserAPI.tabs && browserAPI.tabs.create) {
        browserAPI.tabs.create({ url: targetUrl });
      } else {
        window.open(targetUrl, '_blank');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', loadSettings);
})();
