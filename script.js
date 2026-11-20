/**
 * ArcForge Designs Website - Interactive Scripts
 * Handles dark/light theme toggling, mobile navigation, navbar scroll effects,
 * file drag-and-drop, gallery filtering, interactive quote request form, and toast alerts.
 */

document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initNavbar();
  initMobileMenu();
  initFileUpload();
  initServiceTypeToggle();
  initGalleryFilters();
  initQuoteForm();
  initTurnstile();
  initDynamicYear();
});

/**
 * Dark & Light Mode Theme Management
 * Persists choice to localStorage and seamlessly switches theme
 */
function initThemeToggle() {
  const themeToggles = document.querySelectorAll('.theme-toggle-btn');
  const html = document.documentElement;

  // Retrieve saved preference or default to dark
  const savedTheme = localStorage.getItem('arcforge_theme');

  if (savedTheme === 'light') {
    applyTheme('light');
  } else {
    // Default to dark mode for ArcForge Designs
    applyTheme('dark');
  }

  function applyTheme(theme) {
    if (theme === 'light') {
      html.classList.remove('dark');
      html.classList.add('light');
      localStorage.setItem('arcforge_theme', 'light');
      updateButtons(false);
    } else {
      html.classList.remove('light');
      html.classList.add('dark');
      localStorage.setItem('arcforge_theme', 'dark');
      updateButtons(true);
    }
    // Update navbar background if already scrolled
    if (typeof window._refreshNavbarScroll === 'function') {
      window._refreshNavbarScroll();
    }
  }

  function updateButtons(isDark) {
    themeToggles.forEach((btn) => {
      btn.setAttribute('aria-label', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
      btn.setAttribute('title', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
      
      const sunIcon = btn.querySelector('.sun-icon');
      const moonIcon = btn.querySelector('.moon-icon');
      
      if (sunIcon && moonIcon) {
        if (isDark) {
          sunIcon.classList.remove('hidden');
          moonIcon.classList.add('hidden');
        } else {
          sunIcon.classList.add('hidden');
          moonIcon.classList.remove('hidden');
        }
      }
    });
  }

  themeToggles.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const currentIsDark = html.classList.contains('dark');
      applyTheme(currentIsDark ? 'light' : 'dark');
    });
  });
}

/**
 * Navbar blur and elevation effect on scroll
 */
function initNavbar() {
  const navbar = document.getElementById('main-navbar');
  if (!navbar) return;

  const handleScroll = () => {
    const isDark = document.documentElement.classList.contains('dark');
    if (window.scrollY > 20) {
      navbar.classList.remove('bg-transparent', 'border-transparent');
      if (isDark) {
        navbar.classList.add('navbar-scrolled-dark');
        navbar.classList.remove('navbar-scrolled-light');
      } else {
        navbar.classList.add('navbar-scrolled-light');
        navbar.classList.remove('navbar-scrolled-dark');
      }
    } else {
      navbar.classList.remove('navbar-scrolled-dark', 'navbar-scrolled-light');
      navbar.classList.add('bg-transparent', 'border-transparent');
    }
  };

  window._refreshNavbarScroll = handleScroll;
  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll(); // Initial check
}

/**
 * Mobile navigation toggle and backdrop handling
 */
function initMobileMenu() {
  const menuBtn = document.getElementById('mobile-menu-btn');
  const mobileMenu = document.getElementById('mobile-menu');
  const menuLinks = mobileMenu ? mobileMenu.querySelectorAll('a') : [];

  if (!menuBtn || !mobileMenu) return;

  const toggleMenu = () => {
    const isExpanded = menuBtn.getAttribute('aria-expanded') === 'true';
    menuBtn.setAttribute('aria-expanded', String(!isExpanded));
    mobileMenu.classList.toggle('hidden');

    const hamburgerIcon = menuBtn.querySelector('.hamburger-icon');
    const closeIcon = menuBtn.querySelector('.close-icon');
    if (hamburgerIcon && closeIcon) {
      hamburgerIcon.classList.toggle('hidden');
      closeIcon.classList.toggle('hidden');
    }
  };

  menuBtn.addEventListener('click', toggleMenu);

  // Close menu when clicking on nav links
  menuLinks.forEach((link) => {
    link.addEventListener('click', () => {
      if (!mobileMenu.classList.contains('hidden')) {
        toggleMenu();
      }
    });
  });

  // Close menu when pressing Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !mobileMenu.classList.contains('hidden')) {
      toggleMenu();
    }
  });
}

/**
 * Interactive CAD/DXF File Upload Zone
 */
function initFileUpload() {
  const dropzone = document.getElementById('file-dropzone');
  const fileInput = document.getElementById('dxf-file-input');
  const fileDetails = document.getElementById('file-details');
  const fileNameDisplay = document.getElementById('file-name-display');
  const removeFileBtn = document.getElementById('remove-file-btn');
  const dropzonePrompt = document.getElementById('dropzone-prompt');

  if (!dropzone || !fileInput) return;

  // Handle Drag & Drop events
  ['dragenter', 'dragover'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      fileInput.files = files;
      updateFileDisplay(files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      updateFileDisplay(fileInput.files[0]);
    }
  });

  function updateFileDisplay(file) {
    if (!file) return;
    if (fileNameDisplay) {
      const sizeKB = (file.size / 1024).toFixed(1);
      fileNameDisplay.textContent = `${file.name} (${sizeKB} KB)`;
    }
    if (dropzonePrompt) dropzonePrompt.classList.add('hidden');
    if (fileDetails) fileDetails.classList.remove('hidden');
  }

  if (removeFileBtn) {
    removeFileBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fileInput.value = '';
      if (dropzonePrompt) dropzonePrompt.classList.remove('hidden');
      if (fileDetails) fileDetails.classList.add('hidden');
    });
  }
}

/**
 * Quote form: "Other" service type turns the form into a plain message
 * (hides the drawing upload and relabels the details box)
 */
function initServiceTypeToggle() {
  const select = document.getElementById('service-type');
  const uploadField = document.getElementById('drawing-upload-field');
  const labelText = document.getElementById('project-details-label-text');
  const details = document.getElementById('project-details');
  const fileInput = document.getElementById('dxf-file-input');
  const dropzonePrompt = document.getElementById('dropzone-prompt');
  const fileDetails = document.getElementById('file-details');

  if (!select) return;

  const quoteLabel = labelText ? labelText.textContent : '';
  const quotePlaceholder = details ? details.placeholder : '';

  const sync = () => {
    const isOther = select.value === 'other';

    if (uploadField) uploadField.classList.toggle('hidden', isOther);
    if (labelText) labelText.textContent = isOther ? 'Your Message' : quoteLabel;
    if (details) {
      details.placeholder = isOther
        ? 'How can we help? Ask us anything, e.g. general questions, material availability or a project idea...'
        : quotePlaceholder;
    }

    // Drop any file already chosen so it isn't sent with a general message
    if (isOther && fileInput && fileInput.value) {
      fileInput.value = '';
      if (dropzonePrompt) dropzonePrompt.classList.remove('hidden');
      if (fileDetails) fileDetails.classList.add('hidden');
    }
  };

  select.addEventListener('change', sync);
  // form.reset() fires 'reset' before the values change, so re-sync after it
  if (select.form) select.form.addEventListener('reset', () => setTimeout(sync, 0));
  sync();
}

/**
 * Filterable Gallery Showcase Items
 */
function initGalleryFilters() {
  const filterButtons = document.querySelectorAll('.gallery-filter-btn');
  const galleryItems = document.querySelectorAll('.gallery-item');

  if (!filterButtons.length || !galleryItems.length) return;

  filterButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const category = btn.getAttribute('data-filter');

      // Update active styling
      filterButtons.forEach((b) => {
        b.classList.remove('bg-[#00e5ff]', 'text-slate-950', 'shadow-lg', 'shadow-[#00e5ff]/20');
        b.classList.add('bg-slate-800/80', 'text-slate-300');
      });
      btn.classList.remove('bg-slate-800/80', 'text-slate-300');
      btn.classList.add('bg-[#00e5ff]', 'text-slate-950', 'shadow-lg', 'shadow-[#00e5ff]/20');

      // Filter gallery cards
      galleryItems.forEach((item) => {
        const itemCat = item.getAttribute('data-category');
        if (category === 'all' || itemCat === category) {
          item.classList.remove('hidden');
        } else {
          item.classList.add('hidden');
        }
      });
    });
  });
}

/**
 * Quote Request Form: posts the form (incl. the drawing file) to the
 * Cloudflare Pages Function at /api/quote (functions/api/quote.js), which
 * emails it to ArcForge. The success toast only shows once the server
 * confirms the email went out; otherwise an error toast offers WhatsApp,
 * phone and email instead.
 */
const QUOTE_ENDPOINT = '/api/quote';
const QUOTE_MAX_FILE_BYTES = 25 * 1024 * 1024; // keep in sync with functions/api/quote.js
const QUOTE_TIMEOUT_MS = 90000;
const QUOTE_FALLBACK = 'Please WhatsApp or call us on +27 61 493 6965, or email gean@arcforgedesigns.co.za.';
const QUOTE_ERRORS = {
  'file-too-large': 'Your file is larger than 25 MB. Please attach a smaller file, or email it to gean@arcforgedesigns.co.za.',
  'file-type': 'That file type isn\'t supported. Please attach a DXF, DWG, SVG, PDF, PNG or JPG file.',
  'missing-email': 'Please enter your email address so we can send you your quote.',
  'invalid-email': 'That email address doesn\'t look right. Please check it (e.g. name@example.co.za) and try again.',
  'missing-name': 'Please enter your name so we know who the quote is for.',
  'security-check': 'Please complete the security check and try again.',
  invalid: 'Some details are missing or invalid. Please check the form and try again.',
};

function initQuoteForm() {
  const form = document.getElementById('quote-form');
  const toast = document.getElementById('toast-notification');
  const toastMessage = document.getElementById('toast-message');
  const toastTitle = document.getElementById('toast-title');
  const toastIcon = document.getElementById('toast-icon');
  const toastIconPath = document.getElementById('toast-icon-path');
  const toastClose = document.getElementById('toast-close');
  const dropzonePrompt = document.getElementById('dropzone-prompt');
  const fileDetails = document.getElementById('file-details');
  const fileInput = document.getElementById('dxf-file-input');

  const termsCheckbox = document.getElementById('terms-agree');
  const submitButton = form ? form.querySelector('button[type="submit"]') : null;

  if (!form) return;

  // Keep the submit button disabled until the Terms box is ticked and the
  // Turnstile check has passed (initTurnstile sets data-verified on the widget)
  const turnstileEl = form ? form.querySelector('.cf-turnstile') : null;
  const syncSubmitState = () => {
    if (!submitButton) return;
    const termsOk = !termsCheckbox || termsCheckbox.checked;
    const turnstileOk = !turnstileEl || turnstileEl.dataset.verified === 'true';
    submitButton.disabled = !(termsOk && turnstileOk);
  };
  if (termsCheckbox) termsCheckbox.addEventListener('change', syncSubmitState);
  if (form) form.addEventListener('turnstile:change', syncSubmitState);
  syncSubmitState();

  const showToast = (message, { error = false, title } = {}) => {
    if (!toast) return;
    if (toastMessage) toastMessage.textContent = message;
    if (toastTitle) toastTitle.textContent = title || (error ? 'Request Not Sent' : 'Quote Request Dispatched');
    if (toastIconPath) toastIconPath.setAttribute('d', error ? 'M12 8v5m0 3.5v.01' : 'M5 13l4 4L19 7');
    if (toastIcon) {
      toastIcon.classList.toggle('bg-red-500/20', error);
      toastIcon.classList.toggle('text-red-400', error);
      toastIcon.classList.toggle('bg-[#00e5ff]/20', !error);
      toastIcon.classList.toggle('text-[#00e5ff]', !error);
    }
    toast.setAttribute('role', error ? 'alert' : 'status');

    toast.classList.remove('hidden-toast');
    toast.classList.add('visible-toast');

    // Errors stay up longer so there's time to read the contact details
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => {
      hideToast();
    }, error ? 12000 : 5000);
  };

  const hideToast = () => {
    if (!toast) return;
    toast.classList.add('hidden-toast');
    toast.classList.remove('visible-toast');
  };

  if (toastClose) {
    toastClose.addEventListener('click', hideToast);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = form.querySelector('button[type="submit"]');
    const serviceType = form.querySelector('#service-type');
    const isGeneralMessage = serviceType && serviceType.value === 'other';
    const originalContent = submitBtn ? submitBtn.innerHTML : 'Submit Quote Request';

    // Catch an oversized file before uploading it
    const chosenFile = fileInput && fileInput.files && fileInput.files[0];
    if (!isGeneralMessage && chosenFile && chosenFile.size > QUOTE_MAX_FILE_BYTES) {
      showToast(QUOTE_ERRORS['file-too-large'], { error: true, title: 'File Too Large' });
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `
        <svg class="animate-spin -ml-1 mr-2 h-5 w-5 text-slate-950 inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
        <span>Processing Request...</span>
      `;
    }

    const data = new FormData(form);
    // The upload field is hidden for general messages; never send a stale file
    if (isGeneralMessage) data.delete('drawing-file');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS);
    let result = { ok: false, error: 'network' };

    try {
      const response = await fetch(QUOTE_ENDPOINT, {
        method: 'POST',
        body: data,
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      result = await response.json().catch(() => ({ ok: false, error: 'server' }));
      if (!response.ok) result.ok = false;
    } catch {
      result = { ok: false, error: 'network' };
    } finally {
      clearTimeout(timeout);
    }

    if (submitBtn) {
      submitBtn.innerHTML = originalContent;
      syncSubmitState();
    }

    if (result.ok) {
      // Only clear the form once it has really been sent
      form.reset();
      if (fileInput) fileInput.value = '';
      if (dropzonePrompt) dropzonePrompt.classList.remove('hidden');
      if (fileDetails) fileDetails.classList.add('hidden');
      syncSubmitState();

      showToast(isGeneralMessage
        ? 'Message received! We\'ll get back to you shortly.'
        : 'Quote request received! Our engineering team will review your files and respond promptly.',
        isGeneralMessage ? { title: 'Message Sent' } : {});
    } else {
      // Keep everything the visitor typed so they can retry or copy it
      showToast(QUOTE_ERRORS[result.error] || `Sorry, we couldn't send your request just now. ${QUOTE_FALLBACK}`, { error: true });
    }

    // A Turnstile token works only once: get a fresh one for the next submit
    // (after form.reset(), which would otherwise clear the new token's field)
    // and keep the button disabled until it has passed again
    if (window.turnstile && window._turnstileWidgetId != null) {
      const widget = form.querySelector('.cf-turnstile');
      if (widget) widget.dataset.verified = 'false';
      syncSubmitState();
      try { window.turnstile.reset(window._turnstileWidgetId); } catch { /* widget gone */ }
    }
  });
}

/**
 * Cloudflare Turnstile on the quote form. The api.js script is loaded with
 * render=explicit (index.html only), so the widget is rendered here: compact
 * (150px wide) when there's less than 300px of room, as on most phones, and
 * the normal 300px size otherwise. Keeps the site key and theme from the
 * .cf-turnstile element's data attributes.
 */
function initTurnstile() {
  const el = document.querySelector('#quote-form .cf-turnstile');
  if (!el) return;

  let tries = 0;
  const render = () => {
    if (!window.turnstile || typeof window.turnstile.render !== 'function') {
      // api.js loads async; wait for it (up to ~30s)
      if (++tries < 300) setTimeout(render, 100);
      return;
    }
    const compact = (el.parentElement ? el.parentElement.clientWidth : 0) < 300;
    if (compact && el.parentElement) el.parentElement.style.minHeight = '140px';
    // Tell initQuoteForm when the check passes or lapses, so it can enable
    // or disable the submit button
    const setVerified = (ok) => {
      el.dataset.verified = ok ? 'true' : 'false';
      const form = el.closest('form');
      if (form) form.dispatchEvent(new Event('turnstile:change'));
    };
    try {
      window._turnstileWidgetId = window.turnstile.render(el, {
        sitekey: el.dataset.sitekey,
        theme: el.dataset.theme || 'auto',
        size: compact ? 'compact' : 'normal',
        callback: () => setVerified(true),
        'expired-callback': () => setVerified(false),
        'timeout-callback': () => setVerified(false),
        'error-callback': () => setVerified(false),
      });
    } catch { /* already rendered */ }
  };
  render();
}

/**
 * Dynamic footer year
 */
function initDynamicYear() {
  const yearEl = document.getElementById('current-year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
}
