// Options page: progress, checklist, all copy in English

const PROGRESS_KEYS = ['progressDownload', 'progressFiltering', 'progressSort', 'progressRename', 'progressFolderOpen'];
const STEPS = ['download', 'filtering', 'sort', 'rename', 'folder'];

function getProgressState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(PROGRESS_KEYS, (stored) => {
      resolve({
        download: !!stored.progressDownload,
        filtering: !!stored.progressFiltering,
        sort: !!stored.progressSort,
        rename: !!stored.progressRename,
        folder: !!stored.progressFolderOpen
      });
    });
  });
}

function renderProgress(state) {
  const segments = document.querySelectorAll('.progress-bar .segment');
  const doneCount = [state.download, state.filtering, state.sort, state.rename, state.folder].filter(Boolean).length;
  segments.forEach((seg, i) => {
    seg.classList.remove('done', 'current');
    if (i < doneCount) seg.classList.add('done');
    else if (i === doneCount) seg.classList.add('current');
  });
  document.getElementById('progressBar').setAttribute('aria-valuenow', doneCount);

  STEPS.forEach((step, i) => {
    const li = document.getElementById(`item-${step}`);
    const done = [state.download, state.filtering, state.sort, state.rename, state.folder][i];
    if (done) {
      li.classList.add('done');
      li.querySelector('.check').textContent = '✓';
    } else {
      li.classList.remove('done');
      li.querySelector('.check').textContent = '';
    }
  });

  const confirmBtn = document.getElementById('confirmFilteringBtn');
  confirmBtn.style.display = state.download && !state.filtering ? 'block' : 'none';
}

document.addEventListener('DOMContentLoaded', async () => {
  const startAutoScrollBtn = document.getElementById('startAutoScrollBtn');
  const cleanupFolderBtn = document.getElementById('cleanupFolderBtn');
  const confirmFilteringBtn = document.getElementById('confirmFilteringBtn');
  const statusDiv = document.getElementById('status');

  async function refresh() {
    const state = await getProgressState();
    renderProgress(state);
  }

  await refresh();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (PROGRESS_KEYS.some((k) => changes[k])) refresh();
  });

  startAutoScrollBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0] || !tabs[0].url.includes('studydrive.net')) {
        showStatus('Please open a Studydrive document preview page first.', 'error');
        return;
      }
      chrome.storage.local.set({
        progressDownload: false,
        progressFiltering: false,
        progressSort: false,
        progressRename: false,
        progressFolderOpen: false
      }, () => {
        renderProgress({
          download: false,
          filtering: false,
          sort: false,
          rename: false,
          folder: false
        });
      });
      chrome.tabs.sendMessage(tabs[0].id, { type: 'START_AUTO_SCROLL' }, (response) => {
        if (response && response.success) {
          showStatus('Auto-scroll started.', 'success');
        } else {
          showStatus('Failed. Open a Studydrive document preview page.', 'error');
        }
      });
    });
  });

  confirmFilteringBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RUN_FILTERING' }, () => {
      showStatus('Filtering: duplicate files removed.', 'success');
    });
  });

  cleanupFolderBtn.addEventListener('click', async () => {
    let docName = 'Document';
    try {
      const stored = await chrome.storage.local.get(['studydriveDocumentName']);
      if (stored.studydriveDocumentName) docName = stored.studydriveDocumentName;
    } catch (e) {}

    if (!window.showDirectoryPicker) {
      showStatus('Folder picker is not supported in this browser.', 'error');
      return;
    }

    try {
      const dirHandle = await window.showDirectoryPicker();
      const studydriveFiles = [];

      for await (const entry of dirHandle.values()) {
        if (entry.kind !== 'file') continue;
        const name = entry.name;
        if (!name.startsWith('studydrive_image_') || !name.toLowerCase().endsWith('.png')) continue;
        const file = await entry.getFile();
        const tsMatch = name.match(/studydrive_image_(\d+)_/);
        const ts = tsMatch ? parseInt(tsMatch[1], 10) : 0;
        studydriveFiles.push({ name, size: file.size, handle: entry, ts });
      }

      if (studydriveFiles.length === 0) {
        showStatus('No studydrive_image_*.png files in this folder.', 'error');
        return;
      }

      studydriveFiles.sort((a, b) => a.ts - b.ts);

      const toKeep = [];
      for (let i = 0; i < studydriveFiles.length; i += 3) {
        const group = studydriveFiles.slice(i, i + 3);
        const best = group.reduce((max, f) => (f.size > max.size ? f : max), group[0]);
        toKeep.push(best);
      }

      const safeName = docName.replace(/[/\\:*?"<>|]/g, '_').trim() || 'Document';

      for (let i = 0; i < toKeep.length; i++) {
        const item = toKeep[i];
        const newName = `${safeName} (${i + 1}).png`;
        const file = await item.handle.getFile();
        const buffer = await file.arrayBuffer();
        const newHandle = await dirHandle.getFileHandle(newName, { create: true });
        const writable = await newHandle.createWritable();
        await writable.write(buffer);
        await writable.close();
        await dirHandle.removeEntry(item.name);
      }

      await chrome.storage.local.set({ progressRename: true });
      showStatus(`${toKeep.length} files renamed. Opening folder…`, 'success');
      chrome.runtime.sendMessage({ type: 'CLEANUP_DONE' });
    } catch (err) {
      if (err.name === 'AbortError') return;
      showStatus('Error: ' + (err.message || String(err)), 'error');
    }
  });

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
    setTimeout(() => {
      statusDiv.className = 'status';
    }, 5000);
  }
});
