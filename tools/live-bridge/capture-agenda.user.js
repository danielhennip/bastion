// ==UserScript==
// @name         Zuidplas → Claude: vergaderinhoud kopiëren
// @namespace    bastion.zuidplas
// @version      1.0
// @description  Leest de zichtbare agenda/inhoud van de Notubiz-vergaderpagina en kopieert die naar je klembord, zodat je het in de Claude-chat kunt plakken. Draait in JOUW browser (komt door Cloudflare).
// @match        https://zuidplas.notubiz.nl/*
// @grant        none
// ==/UserScript==

// Gebruik:
//  - Als Tampermonkey/Violentmonkey-script: installeer en klik op de knop
//    rechtsonder op de vergaderpagina.
//  - Of als bookmarklet: plak de geminificeerde variant onderaan als bladwijzer-URL.

(function () {
  'use strict';

  function extract() {
    const clean = s => (s || '').replace(/\s+/g, ' ').trim();
    const title = clean(document.querySelector('h1, .meeting-title, [class*="title"]')?.textContent) || document.title;

    // Agenda-achtige elementen.
    const items = [];
    const seen = new Set();
    document.querySelectorAll('[class*="agenda" i] li, [class*="agenda" i] a, li[class*="point" i], li[class*="punt" i], ol li, ul li').forEach(el => {
      const t = clean(el.textContent);
      if (t && t.length > 3 && t.length < 220 && !seen.has(t)) { seen.add(t); items.push(t); }
    });

    // Actief/geselecteerd item (huidig onderwerp), indien gemarkeerd.
    const active = clean(document.querySelector('.active, [class*="current" i], [aria-current]')?.textContent);

    const lines = [];
    lines.push(`# ${title}`);
    lines.push(`URL: ${location.href}`);
    lines.push(`Gekopieerd: ${new Date().toLocaleString('nl-NL')}`);
    if (active) lines.push(`\nHuidig onderwerp: ${active}`);
    lines.push('\n## Agenda / inhoud');
    items.slice(0, 100).forEach(t => lines.push(`- ${t}`));
    return lines.join('\n');
  }

  async function copy() {
    const text = extract();
    try {
      await navigator.clipboard.writeText(text);
      alert('Vergaderinhoud gekopieerd! Plak het in de Claude-chat.');
    } catch {
      // Fallback: toon in een prompt om handmatig te kopiëren.
      window.prompt('Kopieer onderstaande tekst (Ctrl/Cmd+C) en plak in de chat:', text);
    }
  }

  // Knop rechtsonder.
  const btn = document.createElement('button');
  btn.textContent = '📋 Kopieer voor Claude';
  Object.assign(btn.style, {
    position: 'fixed', right: '16px', bottom: '16px', zIndex: 999999,
    padding: '10px 14px', background: '#c9a227', color: '#0a1428',
    border: 'none', borderRadius: '6px', fontWeight: '700', cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)', fontFamily: 'system-ui, sans-serif',
  });
  btn.addEventListener('click', copy);
  document.body.appendChild(btn);
})();

/*
BOOKMARKLET (maak een bladwijzer met deze URL):

javascript:(function(){function c(s){return(s||'').replace(/\s+/g,' ').trim()}var t=c(document.querySelector('h1')?.textContent)||document.title,i=[],seen=new Set();document.querySelectorAll('[class*="agenda" i] li,[class*="agenda" i] a,ol li,ul li').forEach(function(e){var x=c(e.textContent);if(x&&x.length>3&&x.length<220&&!seen.has(x)){seen.add(x);i.push(x)}});var out='# '+t+'\nURL: '+location.href+'\n\n## Agenda / inhoud\n'+i.slice(0,100).map(function(x){return'- '+x}).join('\n');navigator.clipboard.writeText(out).then(function(){alert('Gekopieerd voor Claude!')},function(){window.prompt('Kopieer:',out)})})();
*/
