'use strict';
// Manual light/dark toggle. The inline script in <head> sets data-theme before first
// paint (stored choice, else the system setting) so there's no flash; here we just
// reflect it on the button + status-bar colour and let the user flip it.
const THEME_KEY = 'slayqueens_theme';

function currentTheme(){
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function reflectTheme(){
  const dark = currentTheme() === 'dark';
  const btn = $('themeToggle');
  if(btn){
    btn.textContent = dark ? '☀️' : '🌙';
    btn.setAttribute('aria-label', dark ? 'Byt till ljust tema' : 'Byt till mörkt tema');
  }
  const meta = $('themeColor');
  if(meta) meta.setAttribute('content', dark ? '#0f0d18' : '#eae7f1');
}

function toggleTheme(){
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try{ localStorage.setItem(THEME_KEY, next); }catch(e){}
  reflectTheme();
}
