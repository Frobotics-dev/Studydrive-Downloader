// Service Worker für StudyDrive Blob Image Downloader

console.log('[StudyDrive Downloader] Service Worker geladen');

const MAX_PARALLEL_DOWNLOADS = 3;
const downloadQueue = [];
let activeDownloads = 0;
const downloadedUrls = new Set();

// MIME-Type zu Dateiendung Mapping
function getFileExtension(mimeType) {
  const mimeMap = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp'
  };
  return mimeMap[mimeType] || 'png';
}

// Generiert einen Dateinamen basierend auf Blob-URL und MIME-Type
function generateFileName(blobUrl, mimeType, index) {
  const extension = getFileExtension(mimeType);
  const timestamp = Date.now();
  const hash = blobUrl.split('/').pop().substring(0, 8);
  return `studydrive_image_${timestamp}_${index}_${hash}.${extension}`;
}

// Verarbeitet einen Download aus der Queue
async function processDownload() {
  if (activeDownloads >= MAX_PARALLEL_DOWNLOADS) {
    console.log(`[StudyDrive Downloader] Max. parallele Downloads erreicht (${activeDownloads}/${MAX_PARALLEL_DOWNLOADS})`);
    return;
  }
  
  if (downloadQueue.length === 0) {
    console.log('[StudyDrive Downloader] Download-Queue ist leer');
    return;
  }

  activeDownloads++;
  const item = downloadQueue.shift();
  
  console.log(`[StudyDrive Downloader] Starte Download (${activeDownloads}/${MAX_PARALLEL_DOWNLOADS} aktiv, ${downloadQueue.length} in Queue)`);

  try {
    const fileName = generateFileName(item.blobUrl, item.mimeType, downloadedUrls.size);
    
    console.log('[StudyDrive Downloader] Lade herunter:', fileName, 'MIME-Type:', item.mimeType);
    
    await chrome.downloads.download({
      url: item.dataUrl,
      filename: fileName,
      saveAs: false
    });

    downloadedUrls.add(item.blobUrl);
    console.log(`[StudyDrive Downloader] Download gestartet: ${fileName}`);
  } catch (error) {
    console.error('[StudyDrive Downloader] Fehler beim Download:', error);
    activeDownloads--;
    // Verarbeite nächsten Download in der Queue
    processDownload();
  }
}

// Fügt einen Download zur Queue hinzu
function queueDownload(data) {
  // Dedupliziere basierend auf Blob-URL
  if (downloadedUrls.has(data.blobUrl)) {
    console.log('[StudyDrive Downloader] Blob-URL bereits heruntergeladen, überspringe:', data.blobUrl);
    return;
  }

  console.log('[StudyDrive Downloader] Füge Download zur Queue hinzu:', data.blobUrl);
  downloadQueue.push(data);
  processDownload();
}

// Höre auf Nachrichten vom Content Script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[StudyDrive Downloader] Nachricht erhalten im Service Worker:', message.type);
  
  if (message.type === 'DOWNLOAD_BLOB') {
    if (!message.dataUrl) {
      console.error('[StudyDrive Downloader] Keine dataUrl in Nachricht erhalten');
      sendResponse({ success: false, error: 'Keine dataUrl' });
      return true;
    }
    
    queueDownload({
      dataUrl: message.dataUrl,
      mimeType: message.mimeType,
      blobUrl: message.blobUrl
    });
    sendResponse({ success: true });
  }
  return true;
});

// Höre auf Download-Events
chrome.downloads.onChanged.addListener((downloadDelta) => {
  if (downloadDelta.state && downloadDelta.state.current === 'complete') {
    console.log('[StudyDrive Downloader] Download abgeschlossen');
    activeDownloads--;
    processDownload();
  } else if (downloadDelta.error) {
    console.error('[StudyDrive Downloader] Download-Fehler:', downloadDelta.error);
    activeDownloads--;
    processDownload();
  }
});

// Dokumentname aus Seitenkontext lesen (sdWindow.document)
function getDocumentNameFromPage() {
  const doc = typeof window !== 'undefined' && window.sdWindow && window.sdWindow.document;
  if (!doc) return '';
  const display = doc.display_file_name;
  if (display && typeof display === 'string') return display.trim();
  const filename = doc.filename;
  if (filename && typeof filename === 'string') return filename.replace(/\.[^.]+$/, '').trim();
  return '';
}

// Nach Auto-Scroll-Ende: Tab-ID merken (für Schließen nach Cleanup), Dokumentname speichern, Duplikate löschen
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'AUTO_SCROLL_FINISHED') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId) {
      chrome.storage.local.set({ studydriveTabId: tabId });
    }
  }

  if (message.type === 'CLEANUP_DONE') {
    chrome.storage.local.get(['studydriveTabId'], (stored) => {
      if (chrome.downloads.showDefaultFolder) {
        chrome.downloads.showDefaultFolder();
      }
      if (stored.studydriveTabId) {
        chrome.tabs.remove(stored.studydriveTabId, () => {
          chrome.storage.local.remove(['studydriveTabId']);
        });
      }
      chrome.storage.local.set({ progressFolderOpen: true });
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.type !== 'AUTO_SCROLL_FINISHED') return true;
  const tabId = sender.tab && sender.tab.id;
  if (!tabId) return true;

  chrome.scripting.executeScript({
    target: { tabId },
    func: getDocumentNameFromPage
  }, (results) => {
    const docName = (results && results[0] && results[0].result) ? String(results[0].result) : '';
    if (docName) {
      chrome.storage.local.set({ studydriveDocumentName: docName });
    }
    chrome.storage.local.set({ progressDownload: true });
    sendResponse({ success: true });
  });

  return true;
});

// Run duplicate removal (filtering) only after user confirmation
function runFiltering() {
  chrome.downloads.search({}, (items) => {
    const studydrive = items.filter((item) => {
      const name = (item.filename || '').split(/[/\\]/).pop() || '';
      return /^studydrive_image_\d+_.*\.png$/i.test(name);
    });
    if (studydrive.length === 0) {
      chrome.storage.local.set({ progressFiltering: true, progressSort: true });
      return;
    }
    const withTs = studydrive.map((item) => {
      const name = (item.filename || '').split(/[/\\]/).pop() || '';
      const m = name.match(/studydrive_image_(\d+)_/);
      return { id: item.id, filename: name, ts: m ? parseInt(m[1], 10) : 0, fileSize: item.fileSize || 0 };
    });
    withTs.sort((a, b) => a.ts - b.ts);
    const toRemove = [];
    for (let i = 0; i < withTs.length; i += 3) {
      const group = withTs.slice(i, i + 3);
      const best = group.reduce((max, x) => (x.fileSize > max.fileSize ? x : max), group[0]);
      group.forEach((x) => { if (x.id !== best.id) toRemove.push(x.id); });
    }
    toRemove.forEach((id) => { chrome.downloads.removeFile(id, () => {}); });
    chrome.storage.local.set({ progressFiltering: true, progressSort: true });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RUN_FILTERING') {
    runFiltering();
    sendResponse({ success: true });
    return true;
  }
  return false;
});

// Installations-Handler
chrome.runtime.onInstalled.addListener(() => {
  console.log('[StudyDrive Downloader] Extension installiert');
});
