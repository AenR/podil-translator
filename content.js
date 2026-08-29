(function() {
    'use strict';

    async function translateText(text) {
        const url = "https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=pl&tl=en&dt=t&q=" + encodeURIComponent(text);

        try {
            const response = await fetch(url);
            const result = await response.json();
            if (result && result[0]) {
                return result[0].map(x => x[0]).join("");
            }
        } catch (e) {
            console.error("Translate error:", e);
        }
        return null;
    }

    function createTranslationBlock(wrapper, translatedText) {
    if (wrapper.querySelector('.userscript-translation')) return;

    const origHeader = wrapper.querySelector('h2, h3');
    const origContent = wrapper.querySelector('[data-cy="adPageAdDescription"], [data-testid="textWrapper"], div.css-fl29zg') || wrapper.querySelector('div');

    const headerTag = origHeader ? origHeader.tagName : 'H2';
    const headerClass = origHeader ? origHeader.className : '';
    const contentClass = origContent ? origContent.className : '';

    const container = document.createElement("div");
    container.className = "userscript-translation";
    container.style.marginBottom = "24px";
    container.style.paddingBottom = "16px";
    container.style.borderBottom = "1px solid rgba(128,128,128,0.2)";

    // 1. DESCRIPTION Başlığı (Tıklanabilir ve İkonlu)
    const header = document.createElement(headerTag);
    if (headerClass) header.className = headerClass;
    header.style.cursor = "pointer"; // Tıklanabilir imleç
    header.style.userSelect = "none";
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "8px";
    
    // Başlık metni ve Aç/Kapat İkonu
    header.innerHTML = `<span>DESCRIPTION</span> <span class="toggle-icon" style="font-size: 0.8em; opacity: 0.7;">▲</span>`;

    // 2. Çevrilmiş Metin Gövdesi
    const body = document.createElement("div");
    if (contentClass) body.className = contentClass;
    body.style.whiteSpace = "pre-wrap";
    body.style.marginTop = "12px";
    // Otomoto CSS kısıtlamalarını kaldırma
    body.style.maxHeight = "none";
    body.style.height = "auto";
    body.style.overflow = "visible";
    body.style.webkitLineClamp = "none";
    body.textContent = translatedText;

    // 3. Tıklama Olayı (Toggle Yapısı)
    header.addEventListener('click', () => {
        const icon = header.querySelector('.toggle-icon');
        if (body.style.display === "none") {
            body.style.display = "block"; // Aç
            icon.textContent = "▲";
        } else {
            body.style.display = "none";  // Kapat
            icon.textContent = "▼";
        }
    });

    container.appendChild(header);
    container.appendChild(body);

    wrapper.insertBefore(container, wrapper.firstChild);
}

    function expandDescription(wrapper) {
        const expandButtons = wrapper.querySelectorAll('button');
        expandButtons.forEach(btn => {
            const btnText = btn.innerText.toLowerCase();
            if (btnText.includes('rozwiń') || btnText.includes('pokaż więcej') || btnText.includes('read more')) {
                btn.click();
            }
        });
    }

    async function handleTranslation() {
        const wrapper = document.querySelector([
            '[data-sentry-component="AdDescriptionBase"]',
            '[data-cy="ad_description"]',
            '[data-testid="ad_description"]',
            '[data-testid="content-description-section"]'
        ].join(', '));

        if (!wrapper) return;
        if (wrapper.querySelector('.userscript-translation')) return;

        expandDescription(wrapper);

        const textWrapper = wrapper.querySelector('[data-cy="adPageAdDescription"]') || 
                            wrapper.querySelector('[data-testid="textWrapper"]') || 
                            wrapper.querySelector('div.css-fl29zg') || 
                            wrapper;
                            
        let rawText = "";
        const paragraphs = textWrapper.querySelectorAll('p');
        
        if (paragraphs.length > 0) {
            rawText = Array.from(paragraphs).map(p => p.textContent).join('\n');
        } else {
            rawText = textWrapper.innerText || textWrapper.textContent || "";
        }

        let cleanText = rawText.trim();
        if (cleanText.startsWith("Opis\n") || cleanText.startsWith("Opis ")) {
            cleanText = cleanText.replace(/^Opis\s*/i, "");
        }

        if (!cleanText || cleanText.length < 5) return;

        const translatedText = await translateText(cleanText);
        if (translatedText) {
            createTranslationBlock(wrapper, translatedText);
        }
    }

    let timeout = null;
    function init() {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            handleTranslation();
        }, 500);
    }

    const observer = new MutationObserver((mutations) => {
        for (let mutation of mutations) {
            if (mutation.addedNodes.length) {
                init();
                break;
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    init();
})();