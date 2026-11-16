const DB_NAME = 'ai_tts_ext_folder_db';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'unduhan_dir_handle';

function openHandleDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Gagal membuka IndexedDB ekstensi.'));
  });
}

async function saveDirHandle(handle, label) {
  const db = await openHandleDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  await new Promise((resolve) => {
    chrome.storage.local.set(
      {
        linkedFolderName: label || handle.name || 'unduhan',
        linkedFolderMode: 'fs_handle',
        linkedFolderAt: Date.now(),
      },
      resolve
    );
  });
}

async function loadDirHandle() {
  try {
    const db = await openHandleDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

async function clearDirHandle() {
  try {
    const db = await openHandleDb();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (e) {}
  await new Promise((resolve) => {
    chrome.storage.local.remove(['linkedFolderName', 'linkedFolderMode', 'linkedFolderAt'], resolve);
  });
}

function setMsg(text, kind = '') {
  const el = document.getElementById('feedback-msg');
  if (!el) return;
  el.textContent = text;
  el.className = `msg ${kind}`;
}

async function refreshStatus() {
  const badge = document.getElementById('status-badge');
  const detail = document.getElementById('status-detail');
  const btnRegrant = document.getElementById('btn-regrant');

  const handle = await loadDirHandle();
  const meta = await new Promise((resolve) =>
    chrome.storage.local.get(['linkedFolderName', 'detectedExtFolder'], resolve)
  );

  if (!handle) {
    if (btnRegrant) btnRegrant.style.display = 'none';
    if (meta?.detectedExtFolder) {
      badge.className = 'badge badge-warn';
      badge.textContent = 'AUTO-DETEKSI FOLDER EKSTENSI';
      detail.textContent = `Cadangan aktif: Downloads\\${meta.detectedExtFolder}\\unduhan\\. Untuk akses tulis langsung di mana saja (termasuk drive D:/E:), pilih folder "unduhan" milik ekstensi di bawah.`;
    } else {
      badge.className = 'badge badge-err';
      badge.textContent = 'BELUM TERHUBUNG';
      detail.textContent = 'Folder "unduhan" di dalam ekstensi belum disambungkan. Klik tombol di bawah untuk memilihnya.';
    }
    return;
  }

  let perm = 'prompt';
  try {
    perm = await handle.queryPermission({ mode: 'readwrite' });
  } catch (e) {}

  if (perm === 'granted') {
    badge.className = 'badge badge-ok';
    badge.textContent = 'TERHUBUNG PERMANEN';
    detail.textContent = `Folder aktif: ${meta?.linkedFolderName || handle.name}. Semua file WAV antrean otomatis masuk ke folder unduhan ini tanpa membuat folder baru.`;
    if (btnRegrant) btnRegrant.style.display = 'none';
  } else {
    badge.className = 'badge badge-warn';
    badge.textContent = 'PERLU IZIN ULANG';
    detail.textContent = `Folder "${meta?.linkedFolderName || handle.name}" tersimpan, namun Chrome meminta konfirmasi ulang izin tulis setelah restart.`;
    if (btnRegrant) btnRegrant.style.display = 'inline-block';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btnPick = document.getElementById('btn-pick-folder');
  const btnRegrant = document.getElementById('btn-regrant');
  const btnUnlink = document.getElementById('btn-unlink');

  btnPick?.addEventListener('click', async () => {
    try {
      if (typeof window.showDirectoryPicker !== 'function') {
        setMsg('Browser Anda tidak mendukung pemilihan folder langsung.', 'err');
        return;
      }

      const picked = await window.showDirectoryPicker({ mode: 'readwrite' });
      let targetHandle = picked;
      let displayLabel = picked.name;

      // Check if user picked the root extension folder (contains manifest.json & unduhan/)
      let hasManifest = false;
      try {
        await picked.getFileHandle('manifest.json', { create: false });
        hasManifest = true;
      } catch (e) {}

      let subUnduhan = null;
      try {
        subUnduhan = await picked.getDirectoryHandle('unduhan', { create: false });
      } catch (e) {}

      if (subUnduhan) {
        // Strict: NEVER create a new folder; use the EXISTING 'unduhan' folder inside the extension directory!
        targetHandle = subUnduhan;
        displayLabel = `${picked.name}/unduhan`;
      } else if (hasManifest) {
        setMsg('Folder ekstensi terdeteksi tetapi subfolder "unduhan" tidak ditemukan di dalamnya.', 'err');
        return;
      } else {
        // User intentionally chose a custom folder (or selected `unduhan` directly)
        targetHandle = picked;
        displayLabel = picked.name;
      }

      const perm = await targetHandle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        setMsg('Izin tulis ke folder ditolak. Klik tombol lagi dan pilih Izinkan / Edit files.', 'err');
        return;
      }

      await saveDirHandle(targetHandle, displayLabel);
      chrome.runtime.sendMessage({ type: 'EXTENSION_FOLDER_LINKED', payload: { label: displayLabel } }).catch(() => {});
      setMsg(`Berhasil! Folder "${displayLabel}" sekarang terhubung sebagai tujuan WAV default.`, 'ok');
      await refreshStatus();
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setMsg(`Gagal menyambungkan folder: ${err?.message || err}`, 'err');
      }
    }
  });

  btnRegrant?.addEventListener('click', async () => {
    try {
      const handle = await loadDirHandle();
      if (!handle) return;
      const perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        setMsg('Izin folder berhasil diaktifkan ulang!', 'ok');
        await refreshStatus();
      } else {
        setMsg('Izin belum diberikan.', 'err');
      }
    } catch (err) {
      setMsg(`Gagal meminta izin ulang: ${err?.message || err}`, 'err');
    }
  });

  btnUnlink?.addEventListener('click', async () => {
    await clearDirHandle();
    setMsg('Koneksi folder diputuskan.', 'ok');
    await refreshStatus();
  });

  refreshStatus();
});
