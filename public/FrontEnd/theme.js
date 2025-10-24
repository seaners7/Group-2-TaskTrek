// Shared theme functionality for TaskTrek
// This file can be easily integrated with backend systems

class ThemeManager {
  constructor() {
    this.currentTheme = localStorage.getItem('theme') || 'dark';
    this.init();
  }

  init() {
    // Set initial theme
    document.documentElement.setAttribute('data-theme', this.currentTheme);
    
    // Update all theme toggle buttons on the page
    this.updateThemeButtons();
    
    // Listen for theme changes from other tabs/windows
    window.addEventListener('storage', (e) => {
      if (e.key === 'theme') {
        this.currentTheme = e.newValue;
        document.documentElement.setAttribute('data-theme', this.currentTheme);
        this.updateThemeButtons();
      }
    });
  }

  toggle() {
    this.currentTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', this.currentTheme);
    localStorage.setItem('theme', this.currentTheme);
    this.updateThemeButtons();
    
    // Dispatch custom event for other components to listen
    window.dispatchEvent(new CustomEvent('themeChanged', { 
      detail: { theme: this.currentTheme } 
    }));
  }

  updateThemeButtons() {
    const sunIcons = document.querySelectorAll('.theme-icon--sun');
    const moonIcons = document.querySelectorAll('.theme-icon--moon');
    
    if (this.currentTheme === 'light') {
      sunIcons.forEach(icon => icon.style.display = 'none');
      moonIcons.forEach(icon => icon.style.display = 'block');
    } else {
      sunIcons.forEach(icon => icon.style.display = 'block');
      moonIcons.forEach(icon => icon.style.display = 'none');
    }
  }

  getCurrentTheme() {
    return this.currentTheme;
  }

  setTheme(theme) {
    if (theme === 'light' || theme === 'dark') {
      this.currentTheme = theme;
      document.documentElement.setAttribute('data-theme', this.currentTheme);
      localStorage.setItem('theme', this.currentTheme);
      this.updateThemeButtons();
      
      window.dispatchEvent(new CustomEvent('themeChanged', { 
        detail: { theme: this.currentTheme } 
      }));
    }
  }
}

// Global theme manager instance
window.themeManager = new ThemeManager();

// Global function for HTML onclick handlers
function toggleTheme() {
  window.themeManager.toggle();
}

// API for backend integration
window.TaskTrekTheme = {
  toggle: () => window.themeManager.toggle(),
  getCurrentTheme: () => window.themeManager.getCurrentTheme(),
  setTheme: (theme) => window.themeManager.setTheme(theme),
  onThemeChange: (callback) => {
    window.addEventListener('themeChanged', (e) => callback(e.detail.theme));
  }
};
