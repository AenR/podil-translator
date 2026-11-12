/**
 * Podil Translator - Content Script
 * 
 * Automatically translates listings on OLX.pl, Otodom.pl, and Otomoto.pl.
 * - Communicates with background.js to bypass CSP and CORS restrictions.
 * - Handles Next.js/React SPA client-side navigation (pushState/replaceState/popstate).
 * - Awaits asynchronous "Rozwiń" (Show more) expansion before extracting text.
 * - Caches pure original Polish text to prevent language mixing on rapid target language switches.
 * - Uses request IDs to discard stale responses and avoid race conditions.
 * - Provides interactive Loading, Collapsible, and Error / Retry states.
 */

(function() {
  'use strict';

  const browserAPI = (typeof browser !== 'undefined') ? browser : chrome;

  let currentTargetLang = 'en';
  let lastUrl = location.href;
  let debounceTimer = null;

  // Concurrency & Cache guards
  let currentRequestId = 0;
  let cachedOriginalText = '';
  let cachedUrl = '';

  // 1. Inject scoped styles for translation UI
  function injectStyles() {
    if (document.getElementById('podil-translator-styles')) return;

    const style = document.createElement('style');
    style.id = 'podil-translator-styles';
    style.textContent = `
      .userscript-translation {
        margin-bottom: 24px;
        padding-bottom: 16px;
        border-bottom: 1px solid rgba(128, 128, 128, 0.25);
        font-family: inherit;
      }
      .podil-header {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        user-select: none;
        padding: 4px 0;
      }
      .podil-header-title {
        font-weight: 700;
        letter-spacing: 0.5px;
      }
      .podil-badge {
        font-size: 11px;
        font-weight: 600;
        padding: 2px 6px;
        border-radius: 4px;
        text-transform: uppercase;
        background-clip: padding-box;
      }
      .podil-badge-loading {
        background-color: rgba(35, 229, 219, 0.15);
        color: #00827a;
      }
      .podil-toggle-icon {
        font-size: 0.8em;
        opacity: 0.7;
        margin-left: 4px;
        transition: transform 0.2s ease;
      }
      .podil-body {
        margin-top: 12px;
        white-space: pre-wrap;
        line-height: 1.6;
        max-height: none !important;
        height: auto !important;
        overflow: visible !important;
        -webkit-line-clamp: none !important;
      }
      .podil-loading-box {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 0;
        color: rgba(128, 128, 128, 0.9);
        font-size: 14px;
      }
      .podil-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(128, 128, 128, 0.2);
        border-top-color: #002f34;
        border-radius: 50%;
        animation: podil-spin 0.8s linear infinite;
      }
      @keyframes podil-spin {
        to { transform: rotate(360deg); }
      }
      .podil-error-box {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        background-color: rgba(239, 68, 68, 0.08);
        border: 1px solid rgba(239, 68, 68, 0.25);
        border-radius: 6px;
        color: #b91c1c;
        font-size: 13px;
        background-clip: padding-box;
      }
      .podil-retry-btn {
        background-color: #002f34;
        color: #ffffff;
        border: none;
        border-radius: 4px;
        padding: 4px 10px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        transition: opacity 0.2s ease;
        background-clip: padding-box;
      }
      .podil-retry-btn:hover {
        opacity: 0.85;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // 2. Load and listen for target language changes
  function initLanguageSettings() {
    try {
      browserAPI.storage.local.get(['targetLang'], (result) => {
        if (result && result.targetLang) {
          currentTargetLang = result.targetLang;
        }
      });

      browserAPI.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.targetLang) {
          const newLang = changes.targetLang.newValue || 'en';
          if (newLang !== currentTargetLang) {
            currentTargetLang = newLang;
            // Instantly trigger re-translation to the newly chosen language
            handleTranslation(true);
          }
        }
      });
    } catch (e) {
      console.warn('Podil Translator: Could not access storage, using default "en":', e);
    }
  }

  // 3. Request translation through background script (CSP & CORS safe)
  function requestTranslationFromBackground(text, targetLang) {
    return new Promise((resolve) => {
      try {
        browserAPI.runtime.sendMessage(
          {
            action: 'translate',
            text: text,
            sourceLang: 'pl',
            targetLang: targetLang
          },
          (response) => {
            if (browserAPI.runtime.lastError) {
              resolve({
                success: false,
                error: browserAPI.runtime.lastError.message || 'Background communication error'
              });
            } else {
              resolve(response || { success: false, error: 'Empty response from background' });
            }
          }
        );
      } catch (err) {
        resolve({ success: false, error: err.message || 'Messaging failed' });
      }
    });
  }

  // 4. Asynchronous click on "Rozwiń" (Show more) with wait for React state update
  async function expandDescriptionAsync(wrapper) {
    try {
      const candidates = wrapper.querySelectorAll('button, [role="button"], a');
      let clicked = false;

      for (const btn of candidates) {
        if (btn.closest('.userscript-translation')) continue;

        const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
        const cy = (btn.getAttribute('data-cy') || '').toLowerCase();

        if (
          text.includes('rozwiń') ||
          text.includes('pokaż więcej') ||
          text.includes('pokaż pełny opis') ||
          text.includes('read more') ||
          testId.includes('expand') ||
          cy.includes('expand')
        ) {
          btn.click();
          clicked = true;
          break;
        }
      }

      if (clicked) {
        // Wait for React/Next.js to unclamp and render full content in DOM
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } catch (e) {
      console.warn('Podil Translator: Error expanding description:', e);
    }
  }

  // 5. Cleanly extract and cache the pure original Polish text
  function getOriginalListingText(wrapper) {
    // A. Check in-memory cache for this exact URL
    if (cachedOriginalText && cachedUrl === location.href) {
      return cachedOriginalText;
    }

    // B. Check wrapper dataset cache
    if (wrapper.dataset && wrapper.dataset.podilOriginalText && wrapper.dataset.podilOriginalText.length >= 5) {
      cachedOriginalText = wrapper.dataset.podilOriginalText;
      cachedUrl = location.href;
      return cachedOriginalText;
    }

    // C. Temporarily detach .userscript-translation to ensure it is NEVER included in extraction
    const translationBlock = wrapper.querySelector('.userscript-translation');
    let parentNode = null;
    let nextSibling = null;

    if (translationBlock) {
      parentNode = translationBlock.parentNode;
      nextSibling = translationBlock.nextSibling;
      translationBlock.remove();
    }

    let rawText = '';
    try {
      const textWrapper = wrapper.querySelector('[data-cy="adPageAdDescription"]') || 
                          wrapper.querySelector('[data-testid="textWrapper"]') || 
                          wrapper.querySelector('div.css-fl29zg') || 
                          wrapper.querySelector('[data-testid="content-description-section"]') ||
                          wrapper;

      const paragraphs = Array.from(textWrapper.querySelectorAll('p'))
        .filter(p => !p.closest('.userscript-translation'));

      if (paragraphs.length > 0) {
        rawText = paragraphs.map(p => p.textContent.trim()).filter(Boolean).join('\n');
      } else {
        rawText = textWrapper.innerText || textWrapper.textContent || '';
      }
    } finally {
      // Reattach translation block if it was detached
      if (translationBlock && parentNode) {
        parentNode.insertBefore(translationBlock, nextSibling);
      }
    }

    let cleanText = rawText.trim();

    // Guard against any leftover translation headers or markers
    cleanText = cleanText.replace(/^DESCRIPTION\s*\([A-Z-]+\)[\s▲▼]*/gi, '').trim();

    if (cleanText.startsWith('Opis\n') || cleanText.startsWith('Opis ')) {
      cleanText = cleanText.replace(/^Opis\s*/i, '').trim();
    }

    if (cleanText.length >= 5) {
      wrapper.dataset.podilOriginalText = cleanText;
      cachedOriginalText = cleanText;
      cachedUrl = location.href;
    }

    return cleanText;
  }

  // 6. Build or retrieve the container element
  function getOrCreateTranslationBlock(wrapper) {
    let container = wrapper.querySelector('.userscript-translation');
    if (!container) {
      container = document.createElement('div');
      container.className = 'userscript-translation';

      const origHeader = Array.from(wrapper.querySelectorAll('h2, h3'))
        .find(h => !h.closest('.userscript-translation'));

      const origContent = wrapper.querySelector('[data-cy="adPageAdDescription"], [data-testid="textWrapper"], div.css-fl29zg') || 
        Array.from(wrapper.querySelectorAll('div')).find(d => !d.closest('.userscript-translation'));

      const headerTag = origHeader ? origHeader.tagName : 'H2';
      const headerClass = origHeader ? origHeader.className : '';

      const header = document.createElement(headerTag);
      if (headerClass) header.className = headerClass;
      header.classList.add('podil-header');

      const body = document.createElement('div');
      if (origContent && origContent.className) {
        body.className = origContent.className;
      }
      body.classList.add('podil-body');

      container.appendChild(header);
      container.appendChild(body);

      // Header click collapses/expands the translated body
      header.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;

        const icon = header.querySelector('.podil-toggle-icon');
        if (body.style.display === 'none') {
          body.style.display = 'block';
          if (icon) icon.textContent = '▲';
        } else {
          body.style.display = 'none';
          if (icon) icon.textContent = '▼';
        }
      });

      wrapper.insertBefore(container, wrapper.firstChild);
    }
    return container;
  }

  // 7. Set container to Loading State
  function renderLoadingState(container) {
    const header = container.querySelector('.podil-header');
    const body = container.querySelector('.podil-body');

    header.innerHTML = `
      <span class="podil-header-title">DESCRIPTION</span>
      <span class="podil-badge podil-badge-loading">Translating...</span>
      <span class="podil-toggle-icon">▲</span>
    `;

    body.innerHTML = `
      <div class="podil-loading-box">
        <div class="podil-spinner"></div>
        <span>Translating description...</span>
      </div>
    `;
    body.style.display = 'block';
  }

  // 8. Set container to Success State
  function renderSuccessState(container, translatedText) {
    const header = container.querySelector('.podil-header');
    const body = container.querySelector('.podil-body');

    header.innerHTML = `
      <span class="podil-header-title">DESCRIPTION</span>
      <span class="podil-toggle-icon">▲</span>
    `;

    body.innerHTML = '';
    body.textContent = translatedText;
    body.style.display = 'block';
  }

  // 9. Set container to Error State with Retry Button
  function renderErrorState(container, errorMessage, onRetry) {
    const header = container.querySelector('.podil-header');
    const body = container.querySelector('.podil-body');

    header.innerHTML = `
      <span class="podil-header-title">DESCRIPTION</span>
      <span class="podil-toggle-icon">▲</span>
    `;

    body.innerHTML = `
      <div class="podil-error-box">
        <span>⚠️ Translation failed (${errorMessage}).</span>
        <button type="button" class="podil-retry-btn">↻ Retry</button>
      </div>
    `;
    body.style.display = 'block';

    const retryBtn = body.querySelector('.podil-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        onRetry();
      });
    }
  }

  // 10. Main Translation Controller
  async function handleTranslation(force = false) {
    const thisRequestId = ++currentRequestId;

    const wrapper = document.querySelector([
      '[data-sentry-component="AdDescriptionBase"]',
      '[data-cy="ad_description"]',
      '[data-testid="ad_description"]',
      '[data-testid="content-description-section"]'
    ].join(', '));

    if (!wrapper) return;

    let existingContainer = wrapper.querySelector('.userscript-translation');
    if (existingContainer && !force) {
      if (existingContainer.dataset.translatedLang === currentTargetLang) {
        return;
      }
    }

    injectStyles();

    try {
      // Wait for async "Rozwiń" expansion if needed
      await expandDescriptionAsync(wrapper);
      if (thisRequestId !== currentRequestId) return;

      // Extract the immutable original Polish text
      const cleanText = getOriginalListingText(wrapper);

      if (!cleanText || cleanText.length < 5) {
        return;
      }

      // Prepare UI with Loading State
      const targetLangAtStart = currentTargetLang;
      const container = getOrCreateTranslationBlock(wrapper);
      renderLoadingState(container);

      // Request Translation via Background Script
      const response = await requestTranslationFromBackground(cleanText, targetLangAtStart);

      // Check if a newer request was dispatched while this was fetching
      if (thisRequestId !== currentRequestId) {
        return;
      }

      // Check if language changed while fetching
      if (targetLangAtStart !== currentTargetLang) {
        handleTranslation(true);
        return;
      }

      if (response && response.success && response.translatedText) {
        container.dataset.translatedLang = targetLangAtStart;
        renderSuccessState(container, response.translatedText);
      } else {
        const errorMsg = (response && response.error) ? response.error : 'Network or parsing error';
        renderErrorState(container, errorMsg, () => {
          handleTranslation(true);
        });
      }
    } catch (err) {
      console.error('Podil Translator error:', err);
    }
  }

  // 11. SPA Navigation Support (Next.js / React client-side route changes)
  function handleUrlChange() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      cachedOriginalText = '';
      cachedUrl = location.href;
      currentRequestId++;

      // Remove stale translation from previous listing
      const stale = document.querySelector('.userscript-translation');
      if (stale) stale.remove();

      scheduleTranslation(350);
    }
  }

  // Monkey-patch pushState & replaceState to capture Next.js client-side navigations
  function patchHistoryMethods() {
    const trigger = () => {
      window.dispatchEvent(new Event('podillocationchange'));
    };

    const origPushState = history.pushState;
    if (origPushState) {
      history.pushState = function() {
        const res = origPushState.apply(this, arguments);
        trigger();
        return res;
      };
    }

    const origReplaceState = history.replaceState;
    if (origReplaceState) {
      history.replaceState = function() {
        const res = origReplaceState.apply(this, arguments);
        trigger();
        return res;
      };
    }

    window.addEventListener('popstate', trigger);
    window.addEventListener('podillocationchange', handleUrlChange);
  }

  function scheduleTranslation(delay = 400) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      handleTranslation();
    }, delay);
  }

  // 12. Mutation Observer to detect dynamic content mounting
  const observer = new MutationObserver((mutations) => {
    handleUrlChange();
    for (const mutation of mutations) {
      if (mutation.addedNodes.length) {
        scheduleTranslation(400);
        break;
      }
    }
  });

  // Start initialization
  initLanguageSettings();
  patchHistoryMethods();
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleTranslation(300);
})();
