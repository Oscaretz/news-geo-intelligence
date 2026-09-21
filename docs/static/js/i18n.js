const i18n = {
  currentLang: localStorage.getItem('language') || 'en',
  dictionary: {},
  observer: null,
  async init() {
    await this.loadDictionary();
    this.translateDOM();
    
    const selectEl = document.getElementById('languageSelect');
    if (selectEl) {
        selectEl.value = this.currentLang;
    }
    
    // Setup MutationObserver to translate dynamically added elements without loop
    this.observer = new MutationObserver((mutations) => {
      let shouldTranslate = false;
      for (let mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldTranslate = true;
          break;
        }
      }
      if (shouldTranslate) {
        this.translateDOM();
      }
    });
    
    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  },
  async loadDictionary() {
    try {
      const response = await fetch(`./static/i18n/${this.currentLang}.json`);
      if (response.ok) {
        this.dictionary = await response.json();
      }
    } catch (e) {
      console.error("Error loading dictionary:", e);
    }
  },
  t(key, defaultVal) {
    if (this.dictionary && this.dictionary[key]) {
      return this.dictionary[key];
    }
    return defaultVal !== undefined ? defaultVal : key;
  },
  translateDOM() {
    if (this.observer) this.observer.disconnect();
    
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (this.dictionary[key]) {
        if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'search' || !el.type))) {
          el.placeholder = this.dictionary[key];
        } else {
          el.innerHTML = this.dictionary[key];
        }
      }
    });
    
    if (this.observer) {
      this.observer.observe(document.body, { childList: true, subtree: true });
    }
  }
};

async function changeLanguage(lang) {
  localStorage.setItem('language', lang);
  i18n.currentLang = lang;
  await i18n.loadDictionary();
  i18n.translateDOM();
}

document.addEventListener('DOMContentLoaded', () => {
  i18n.init();
});


document.addEventListener('click', (e) => {
  const btn = document.getElementById('settingsBtn');
  const dd = document.getElementById('settingsDropdown');
  if (btn && dd && !btn.contains(e.target) && !dd.contains(e.target)) {
    dd.classList.add('hidden');
  }
});
