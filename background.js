/**
 * Podil Translator - Background Service Script
 * 
 * Handles translation requests from content scripts:
 * - Solves CSP (Content-Security-Policy) & CORS restrictions by performing network fetches in extension context.
 * - Handles query parameter URL limits (~2000 chars) by splitting long listing descriptions (4000+ chars) into safe chunks.
 * - Manages storage and settings defaults.
 */

const browserAPI = (typeof browser !== 'undefined') ? browser : chrome;

// Initialize default settings on install
browserAPI.runtime.onInstalled.addListener(() => {
  try {
    browserAPI.storage.local.get(['targetLang'], (result) => {
      if (!result || !result.targetLang) {
        browserAPI.storage.local.set({ targetLang: 'en' });
      }
    });
  } catch (e) {
    console.error('Failed to initialize default storage:', e);
  }
});

/**
 * Splits long text into chunks that will not exceed the ~2000 character URL GET query limit.
 * Respects paragraph (\n) and sentence boundaries where possible.
 */
function splitTextIntoChunks(text, maxChunkSize = 900) {
  if (!text || text.length <= maxChunkSize) {
    return [text];
  }

  const chunks = [];
  const paragraphs = text.split('\n');
  let currentChunk = '';

  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i];
    const candidate = currentChunk ? currentChunk + '\n' + paragraph : paragraph;

    if (candidate.length <= maxChunkSize) {
      currentChunk = candidate;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = '';
      }

      if (paragraph.length > maxChunkSize) {
        const sentences = paragraph.match(/[^.!?]+(?:[.!?]+|$)/g) || [paragraph];
        for (const sentence of sentences) {
          const sCandidate = currentChunk ? currentChunk + ' ' + sentence.trim() : sentence.trim();
          if (sCandidate.length <= maxChunkSize) {
            currentChunk = sCandidate;
          } else {
            if (currentChunk) {
              chunks.push(currentChunk);
              currentChunk = '';
            }

            if (sentence.length > maxChunkSize) {
              let rem = sentence.trim();
              while (rem.length > maxChunkSize) {
                let cut = rem.lastIndexOf(' ', maxChunkSize);
                if (cut <= 0) cut = maxChunkSize;
                chunks.push(rem.slice(0, cut).trim());
                rem = rem.slice(cut).trim();
              }
              currentChunk = rem;
            } else {
              currentChunk = sentence.trim();
            }
          }
        }
      } else {
        currentChunk = paragraph;
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Requests translation for a single text chunk from Google Translate API.
 * Uses primary (gtx) and secondary (dict-chrome-ex) clients for resilience.
 */
async function translateChunk(chunk, sourceLang, targetLang) {
  const clients = ['gtx', 'dict-chrome-ex'];
  let lastError = null;

  for (const client of clients) {
    const url = `https://translate.googleapis.com/translate_a/single?client=${client}&sl=${encodeURIComponent(sourceLang)}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(chunk)}`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Google Translate HTTP ${response.status}`);
      }
      const data = await response.json();
      if (data && Array.isArray(data[0])) {
        return data[0].map(item => (item && item[0]) ? item[0] : '').join('');
      }
      throw new Error('Unexpected translation response structure');
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Translation failed');
}

/**
 * Translates full listing text, automatically chunking if length exceeds safety threshold.
 */
async function translateFullText(text, sourceLang = 'pl', targetLang = 'en') {
  if (!text || !text.trim()) {
    return '';
  }

  // Safety check: Avoid translating unreasonably oversized payloads
  if (text.length > 30000) {
    text = text.substring(0, 30000);
  }

  const chunks = splitTextIntoChunks(text, 900);
  const translatedParts = [];

  for (const chunk of chunks) {
    if (!chunk.trim()) {
      translatedParts.push(chunk);
      continue;
    }
    const result = await translateChunk(chunk, sourceLang, targetLang);
    translatedParts.push(result);
  }

  return translatedParts.join('\n');
}

// Message Listener for Content Scripts
browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.action === 'translate') {
    const text = request.text || '';
    const sourceLang = request.sourceLang || 'pl';
    const targetLang = request.targetLang || 'en';

    translateFullText(text, sourceLang, targetLang)
      .then((translatedText) => {
        sendResponse({ success: true, translatedText });
      })
      .catch((err) => {
        console.error('Podil Translator background translation error:', err);
        sendResponse({ success: false, error: err.message || 'Unknown translation error' });
      });

    // Return true to indicate asynchronous response
    return true;
  }
});
