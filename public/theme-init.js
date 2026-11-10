// Loaded before the page paints so a saved dark or light choice applies at once.
try {
  var saved = localStorage.getItem('theme');
  if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;
} catch (error) {
  // Storage can be unavailable (private mode); the system theme is used then.
}
