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
  initGalleryFilters();
  initQuoteForm();
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
        b.classList.remove('bg-[#00f0ff]', 'text-slate-950', 'shadow-lg', 'shadow-[#00f0ff]/20');
        b.classList.add('bg-slate-800/80', 'text-slate-300');
      });
      btn.classList.remove('bg-slate-800/80', 'text-slate-300');
      btn.classList.add('bg-[#00f0ff]', 'text-slate-950', 'shadow-lg', 'shadow-[#00f0ff]/20');

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
 * Interactive Quote Request Form Handler
 */
function initQuoteForm() {
  const form = document.getElementById('quote-form');
  const toast = document.getElementById('toast-notification');
  const toastMessage = document.getElementById('toast-message');
  const toastClose = document.getElementById('toast-close');
  const dropzonePrompt = document.getElementById('dropzone-prompt');
  const fileDetails = document.getElementById('file-details');
  const fileInput = document.getElementById('dxf-file-input');

  if (!form) return;

  const showToast = (message) => {
    if (!toast) return;
    if (toastMessage) toastMessage.textContent = message;

    toast.classList.remove('hidden-toast');
    toast.classList.add('visible-toast');

    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => {
      hideToast();
    }, 5000);
  };

  const hideToast = () => {
    if (!toast) return;
    toast.classList.add('hidden-toast');
    toast.classList.remove('visible-toast');
  };

  if (toastClose) {
    toastClose.addEventListener('click', hideToast);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalContent = submitBtn ? submitBtn.innerHTML : 'Submit Quote Request';

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

    setTimeout(() => {
      form.reset();
      if (fileInput) fileInput.value = '';
      if (dropzonePrompt) dropzonePrompt.classList.remove('hidden');
      if (fileDetails) fileDetails.classList.add('hidden');

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalContent;
      }

      showToast('Quote request received! Our engineering team will review your files and respond promptly.');
    }, 1000);
  });
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
