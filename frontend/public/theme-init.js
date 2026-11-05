(() => {
  const themes = ['clarity', 'large', 'night', 'console'];
  const savedTheme = localStorage.getItem('lab-theme');
  const theme = themes.includes(savedTheme)
    ? savedTheme
    : matchMedia('(prefers-color-scheme: dark)').matches
      ? 'night'
      : 'clarity';
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.motion = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'full';

  const language = localStorage.getItem('lab-language');
  document.documentElement.lang = language === 'te' ? 'te-IN' : language === 'hi' ? 'hi-IN' : 'en-IN';
  const font = language === 'te' ? 'noto-sans-telugu' : language === 'hi' ? 'noto-sans-devanagari' : 'noto-sans-latin';
  const preload = document.createElement('link');
  preload.rel = 'preload';
  preload.as = 'font';
  preload.type = 'font/woff2';
  preload.crossOrigin = 'anonymous';
  preload.dataset.languageFont = 'true';
  preload.href = `/fonts/${font}.woff2`;
  document.head.appendChild(preload);
})();
