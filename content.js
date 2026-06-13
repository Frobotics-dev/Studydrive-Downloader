// Content Script für StudyDrive Blob Image Downloader

(function() {
  'use strict';

  console.log('[StudyDrive Downloader] Content Script geladen');

  const collectedBlobUrls = new Set();
  let isCollecting = false;
  let scrollInterval = null;

  // Sammelt Blob-URLs aus verschiedenen Quellen
  function collectBlobUrls() {
    const blobUrls = new Set();
    const allImageUrls = []; // Debug: Alle gefundenen URLs

    // 1. Sammle aus document.images (src und currentSrc)
    const images = document.querySelectorAll('img');
    console.log(`[StudyDrive Downloader] Gefundene <img> Elemente: ${images.length}`);
    
    images.forEach((img, index) => {
      if (img.src) {
        allImageUrls.push(`img[${index}].src: ${img.src}`);
        if (img.src.startsWith('blob:')) {
          blobUrls.add(img.src);
          console.log('[StudyDrive Downloader] Blob-URL gefunden (img.src):', img.src);
        }
      }
      if (img.currentSrc && img.currentSrc !== img.src) {
        allImageUrls.push(`img[${index}].currentSrc: ${img.currentSrc}`);
        if (img.currentSrc.startsWith('blob:')) {
          blobUrls.add(img.currentSrc);
          console.log('[StudyDrive Downloader] Blob-URL gefunden (img.currentSrc):', img.currentSrc);
        }
      }
      // Prüfe auch data-Attribute
      Array.from(img.attributes).forEach(attr => {
        if (attr.name.startsWith('data-') && attr.value && attr.value.startsWith('blob:')) {
          blobUrls.add(attr.value);
          console.log('[StudyDrive Downloader] Blob-URL gefunden (data-Attribut):', attr.name, attr.value);
        }
      });
    });

    // Debug: Zeige alle gefundenen URLs (erste 10)
    if (allImageUrls.length > 0) {
      console.log('[StudyDrive Downloader] Beispiel-URLs gefunden:', allImageUrls.slice(0, 10));
    }

    // 2. Sammle aus background-image CSS
    const allElements = document.querySelectorAll('*');
    let bgImageCount = 0;
    let bgImageWithBlob = 0;
    allElements.forEach((el, index) => {
      const style = window.getComputedStyle(el);
      const bgImage = style.backgroundImage;
      if (bgImage && bgImage !== 'none') {
        bgImageCount++;
        // Verbesserter Regex für alle möglichen Formate
        if (bgImage.includes('blob:')) {
          bgImageWithBlob++;
          // Versuche verschiedene Regex-Patterns
          const patterns = [
            /blob:[^"')]+/,
            /blob:[^"')}]+/,
            /blob:[^\s"')}]+/
          ];
          for (const pattern of patterns) {
            const match = bgImage.match(pattern);
            if (match) {
              blobUrls.add(match[0]);
              console.log('[StudyDrive Downloader] Blob-URL gefunden (background-image):', match[0]);
              break;
            }
          }
        }
      }
    });
    if (bgImageCount > 0) {
      console.log(`[StudyDrive Downloader] Elemente mit background-image: ${bgImageCount}, mit blob: ${bgImageWithBlob}`);
    }

    // 3. Sammle aus <source> Elementen (für <picture>)
    const sources = document.querySelectorAll('source');
    sources.forEach(source => {
      if (source.srcset) {
        source.srcset.split(',').forEach(src => {
          const url = src.trim().split(' ')[0];
          if (url.startsWith('blob:')) {
            blobUrls.add(url);
            console.log('[StudyDrive Downloader] Blob-URL gefunden (source):', url);
          }
        });
      }
    });

    // 4. Prüfe Shadow DOM
    function traverseShadowDOM(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node;
      while (node = walker.nextNode()) {
        if (node.shadowRoot) {
          // Rekursiv durch Shadow DOM
          const shadowImages = node.shadowRoot.querySelectorAll('img');
          shadowImages.forEach(img => {
            if (img.src && img.src.startsWith('blob:')) {
              console.log('[StudyDrive Downloader] Blob-URL gefunden (Shadow DOM):', img.src);
              blobUrls.add(img.src);
            }
          });
          traverseShadowDOM(node.shadowRoot);
        }
      }
    }
    traverseShadowDOM(document.body);

    // 5. Prüfe auch Canvas-Elemente (können Blob-URLs enthalten)
    const canvases = document.querySelectorAll('canvas');
    canvases.forEach((canvas, index) => {
      try {
        canvas.toBlob((blob) => {
          if (blob) {
            const blobUrl = URL.createObjectURL(blob);
            blobUrls.add(blobUrl);
            console.log('[StudyDrive Downloader] Blob-URL aus Canvas erstellt:', blobUrl);
          }
        });
      } catch (e) {
        // Ignoriere Fehler
      }
    });

    // 6. Suche nach allen Blob-URLs im gesamten DOM (auch in Text-Knoten, Attributen, etc.)
    const allTextNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let textNode;
    while (textNode = walker.nextNode()) {
      if (textNode.textContent && textNode.textContent.includes('blob:')) {
        const matches = textNode.textContent.match(/blob:https?:\/\/[^\s"')}]+/g);
        if (matches) {
          matches.forEach(match => {
            blobUrls.add(match);
            console.log('[StudyDrive Downloader] Blob-URL gefunden (Text-Node):', match);
          });
        }
      }
    }

    return blobUrls;
  }

  // Konvertiert Blob-URL zu Data URL und sendet an Service Worker
  // NEU: Unterstützt auch direktes img-Element (für Shadow DOM)
  async function processBlobUrl(blobUrl, imgElement = null) {
    try {
      console.log('[StudyDrive Downloader] Verarbeite Blob-URL:', blobUrl, imgElement ? '(mit img-Element)' : '(nur URL)');
      
      let blob;
      
      // Wenn img-Element vorhanden, verwende es direkt (umgeht fetch-Problem)
      if (imgElement && imgElement.complete && imgElement.naturalWidth > 0) {
        try {
          // Zeichne img in Canvas und konvertiere zu Blob
          const canvas = document.createElement('canvas');
          canvas.width = imgElement.naturalWidth;
          canvas.height = imgElement.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(imgElement, 0, 0);
          
          // Konvertiere Canvas zu Blob
          blob = await new Promise((resolve, reject) => {
            canvas.toBlob((b) => {
              if (b) resolve(b);
              else reject(new Error('Canvas toBlob failed'));
            }, 'image/png');
          });
          
          console.log('[StudyDrive Downloader] Blob aus img-Element erstellt, MIME-Type:', blob.type, 'Größe:', blob.size, 'bytes');
        } catch (canvasError) {
          console.warn('[StudyDrive Downloader] Canvas-Methode fehlgeschlagen, versuche fetch:', canvasError);
          // Fallback zu fetch
          const response = await fetch(blobUrl);
          blob = await response.blob();
        }
      } else {
        // Normale fetch-Methode
        const response = await fetch(blobUrl);
        blob = await response.blob();
      }
      
      console.log('[StudyDrive Downloader] Blob erhalten, MIME-Type:', blob.type, 'Größe:', blob.size, 'bytes');
      
      // Konvertiere Blob zu Data URL (funktioniert zwischen Kontexten)
      const reader = new FileReader();
      reader.onloadend = function() {
        const dataUrl = reader.result;
        console.log('[StudyDrive Downloader] Data URL erstellt, Länge:', dataUrl.length);
        
        // Sende an Service Worker
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_BLOB',
          dataUrl: dataUrl,
          mimeType: blob.type || 'image/png',
          blobUrl: blobUrl
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('[StudyDrive Downloader] Fehler beim Senden:', chrome.runtime.lastError);
          } else {
            console.log('[StudyDrive Downloader] Nachricht gesendet, Antwort:', response);
          }
        });
      };
      reader.onerror = function(error) {
        console.error('[StudyDrive Downloader] Fehler beim Lesen des Blobs:', error);
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error('[StudyDrive Downloader] Fehler beim Verarbeiten der Blob-URL:', blobUrl, error);
    }
  }

  // Hauptfunktion zum Sammeln und Verarbeiten
  async function collectAndDownload() {
    if (isCollecting) {
      console.log('[StudyDrive Downloader] Sammlung läuft bereits, überspringe');
      return;
    }
    isCollecting = true;

    const shadowDomImages = [];
    const blobUrls = collectBlobUrls();
    
    // Sammle auch Shadow DOM Images mit ihren Elementen
    function collectShadowDOMImages(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node;
      while (node = walker.nextNode()) {
        if (node.shadowRoot) {
          const shadowImages = node.shadowRoot.querySelectorAll('img');
          shadowImages.forEach(img => {
            if (img.src && img.src.startsWith('blob:') && !collectedBlobUrls.has(img.src)) {
              shadowDomImages.push({ img: img, blobUrl: img.src });
            }
          });
          collectShadowDOMImages(node.shadowRoot);
        }
      }
    }
    collectShadowDOMImages(document.body);
    
    const newBlobUrls = Array.from(blobUrls).filter(url => !collectedBlobUrls.has(url));

    console.log(`[StudyDrive Downloader] Gefunden: ${newBlobUrls.length} neue Blob-URLs (gesamt: ${blobUrls.size}, bereits gesammelt: ${collectedBlobUrls.size}, Shadow DOM Images: ${shadowDomImages.length})`);

    // Verarbeite Shadow DOM Images zuerst (mit img-Element)
    for (const { img, blobUrl } of shadowDomImages) {
      if (!collectedBlobUrls.has(blobUrl)) {
        collectedBlobUrls.add(blobUrl);
        // Warte kurz, damit das Bild geladen ist
        if (!img.complete) {
          await new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
            setTimeout(resolve, 1000); // Timeout nach 1 Sekunde
          });
        }
        await processBlobUrl(blobUrl, img);
      }
    }

    // Verarbeite andere neue Blob-URLs (ohne img-Element)
    for (const blobUrl of newBlobUrls) {
      if (!collectedBlobUrls.has(blobUrl)) {
        collectedBlobUrls.add(blobUrl);
        await processBlobUrl(blobUrl);
      }
    }

    isCollecting = false;
  }

  // Auto-Scroll Funktion
  function startAutoScroll() {
    if (scrollInterval) return;

    // Starte auch die Sammlung, wenn Auto-Scroll gestartet wird
    startCollection();

    console.log('[StudyDrive Downloader] Auto-Scroll gestartet');
    scrollInterval = setInterval(() => {
      const scrollHeight = document.documentElement.scrollHeight;
      const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
      const clientHeight = document.documentElement.clientHeight;

      if (scrollTop + clientHeight >= scrollHeight - 100) {
        // Reached end: stop auto-scroll and collection so manual scrolling won't trigger more downloads
        console.log('[StudyDrive Downloader] Reached end of page, stopping auto-scroll and collection');
        stopAutoScroll();
        stopCollection();
        chrome.runtime.sendMessage({ type: 'AUTO_SCROLL_FINISHED' });
        return;
      }

      // Scrolle langsam nach unten
      window.scrollBy(0, 300);
    }, 500);

    // Sammle auch während des Scrollens
    scrollCollectInterval = setInterval(() => {
      collectAndDownload();
      if (!scrollInterval) {
        clearInterval(scrollCollectInterval);
        scrollCollectInterval = null;
      }
    }, 2000);
  }

  function stopAutoScroll() {
    if (scrollInterval) {
      clearInterval(scrollInterval);
      scrollInterval = null;
      console.log('[StudyDrive Downloader] Auto-Scroll gestoppt');
    }
    if (scrollCollectInterval) {
      clearInterval(scrollCollectInterval);
      scrollCollectInterval = null;
    }
  }

  // MutationObserver wird nur aktiviert, wenn Sammlung gestartet wird
  let observer = null;
  let periodicInterval = null;
  let scrollCollectInterval = null;

  function startCollection() {
    if (observer) return; // Bereits aktiv

    console.log('[StudyDrive Downloader] Starte Sammlung...');
    
    // Starte initiale Sammlung
    collectAndDownload();

    // Beobachte neue Bilder (MutationObserver)
    observer = new MutationObserver((mutations) => {
      let hasRelevantChange = false;
      mutations.forEach(mutation => {
        if (mutation.type === 'attributes') {
          const attrName = mutation.attributeName;
          if (attrName === 'src' || attrName === 'srcset' || attrName === 'style') {
            hasRelevantChange = true;
          }
        } else if (mutation.type === 'childList') {
          hasRelevantChange = true;
        }
      });
      if (hasRelevantChange) {
        collectAndDownload();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'style']
    });

    // Sammle periodisch (für dynamisch geladene Inhalte)
    periodicInterval = setInterval(collectAndDownload, 3000);
    console.log('[StudyDrive Downloader] Periodische Sammlung aktiviert (alle 3 Sekunden)');
  }

  function stopCollection() {
    if (observer) {
      observer.disconnect();
      observer = null;
      console.log('[StudyDrive Downloader] MutationObserver gestoppt');
    }
    if (periodicInterval) {
      clearInterval(periodicInterval);
      periodicInterval = null;
      console.log('[StudyDrive Downloader] Periodische Sammlung gestoppt');
    }
    if (scrollCollectInterval) {
      clearInterval(scrollCollectInterval);
      scrollCollectInterval = null;
    }
  }

  // Höre auf Nachrichten vom Service Worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[StudyDrive Downloader] Nachricht erhalten:', message);
    if (message.type === 'START_AUTO_SCROLL') {
      startAutoScroll();
      sendResponse({ success: true });
    }
    return true;
  });

  console.log('[StudyDrive Downloader] Content Script geladen - Sammlung startet nur auf manuellen Befehl');
})();
