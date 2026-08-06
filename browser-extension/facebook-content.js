(() => {
  if (window.__strealFacebookGroupAssistantLoaded) return;
  window.__strealFacebookGroupAssistantLoaded = true;

  const state = {
    requestId: '',
    taskId: '',
    groupId: '',
    groupName: '',
    message: '',
    media: [],
    editor: null,
    dialog: null,
    postClickedAt: 0,
    completionTimer: null,
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  function isVisible(node) {
    if (!(node instanceof Element)) return false;
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function showStatus(message, tone = 'info') {
    let panel = document.getElementById('streal-facebook-assistant-status');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'streal-facebook-assistant-status';
      Object.assign(panel.style, {
        position: 'fixed',
        right: '18px',
        bottom: '18px',
        zIndex: '2147483647',
        maxWidth: '360px',
        padding: '12px 14px',
        borderRadius: '12px',
        boxShadow: '0 12px 36px rgba(15, 23, 42, .28)',
        font: '600 14px/1.45 Arial, sans-serif',
        whiteSpace: 'pre-line',
      });
      document.documentElement.appendChild(panel);
    }
    panel.style.background = tone === 'error' ? '#fee2e2' : tone === 'success' ? '#dcfce7' : '#eff6ff';
    panel.style.color = tone === 'error' ? '#991b1b' : tone === 'success' ? '#166534' : '#1e3a8a';
    panel.textContent = message;
  }

  function sendProgress(status, extra = {}) {
    chrome.runtime.sendMessage({
      type: 'STREAL_FACEBOOK_GROUP_QUEUE_EVENT',
      requestId: state.requestId,
      taskId: state.taskId,
      groupId: state.groupId,
      groupName: state.groupName,
      status,
      ...extra,
    });
  }

  function findComposerDialog() {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(isVisible);
    return dialogs.find((dialog) => {
      const text = normalize(dialog.innerText || dialog.textContent || '').toLowerCase();
      return text.includes('tạo bài viết') || text.includes('create post') || text.includes('đăng bài');
    }) || dialogs.find((dialog) => dialog.querySelector('[contenteditable="true"][role="textbox"]')) || null;
  }

  function findComposerEditor(dialog) {
    const root = dialog || document;
    const candidates = Array.from(root.querySelectorAll('[contenteditable="true"][role="textbox"], [contenteditable="true"]'));
    return candidates.find((node) => {
      if (!isVisible(node)) return false;
      const label = normalize(`${node.getAttribute('aria-label') || ''} ${node.getAttribute('data-lexical-editor') || ''}`).toLowerCase();
      return !label.includes('comment') && !label.includes('bình luận') && !label.includes('search') && !label.includes('tìm kiếm');
    }) || null;
  }

  function findComposerTrigger() {
    const phrases = [
      'bạn viết gì đi',
      'bạn đang nghĩ gì',
      'viết gì đó',
      'tạo bài viết',
      'write something',
      "what's on your mind",
      'create post',
    ];
    const nodes = Array.from(document.querySelectorAll('[role="button"], button, [tabindex="0"]'));
    return nodes.find((node) => {
      if (!isVisible(node)) return false;
      const text = normalize(`${node.getAttribute('aria-label') || ''} ${node.innerText || node.textContent || ''}`).toLowerCase();
      return phrases.some((phrase) => text.includes(phrase));
    }) || null;
  }

  function setEditorText(editor, message) {
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    try {
      document.execCommand('insertText', false, message);
    } catch {
      // Fall through to the DOM-based fallback below.
    }
    if (normalize(editor.innerText || editor.textContent) !== normalize(message)) {
      editor.replaceChildren(document.createTextNode(message));
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: null,
      }));
    }
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    return normalize(editor.innerText || editor.textContent) === normalize(message);
  }

  function normalizeMedia(items) {
    return (Array.isArray(items) ? items : [])
      .slice(0, 10)
      .map((item) => ({
        url: String(item?.url || '').trim(),
        type: item?.type === 'video' ? 'video' : 'image',
        name: String(item?.name || '').trim(),
      }))
      .filter((item) => /^https?:\/\//i.test(item.url));
  }

  function mediaExtension(type, mimeType) {
    const byMime = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/webm': 'webm',
    };
    return byMime[String(mimeType || '').toLowerCase()] || (type === 'video' ? 'mp4' : 'jpg');
  }

  function mediaFilename(item, index, mimeType) {
    let filename = item.name;
    if (!filename) {
      try {
        filename = decodeURIComponent(new URL(item.url).pathname.split('/').pop() || '');
      } catch {
        filename = '';
      }
    }
    filename = filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
    const extension = mediaExtension(item.type, mimeType);
    if (!filename) filename = `facebook-media-${index + 1}.${extension}`;
    if (!/\.[a-z0-9]{2,5}$/i.test(filename)) filename = `${filename}.${extension}`;
    return filename;
  }

  async function downloadMediaFile(item, index) {
    const response = await fetch(item.url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`không tải được ${item.name || `media ${index + 1}`} (HTTP ${response.status})`);
    const blob = await response.blob();
    if (!blob.size) throw new Error(`${item.name || `media ${index + 1}`} là file rỗng`);
    const fallbackMime = item.type === 'video' ? 'video/mp4' : 'image/jpeg';
    const mimeType = blob.type || fallbackMime;
    if (!/^(image|video)\//i.test(mimeType)) {
      throw new Error(`${item.name || `media ${index + 1}`} không phải file ảnh/video trực tiếp`);
    }
    return new File([blob], mediaFilename(item, index, mimeType), {
      type: mimeType,
      lastModified: Date.now(),
    });
  }

  function findMediaInput(dialog) {
    const roots = [dialog].filter(Boolean);
    const candidates = [];
    roots.forEach((root, rootIndex) => {
      root.querySelectorAll('input[type="file"]').forEach((input) => {
        if (candidates.some((item) => item.input === input)) return;
        const accept = String(input.getAttribute('accept') || '').toLowerCase();
        if (!accept.includes('image') && !accept.includes('video')) return;
        let score = rootIndex === 0 ? 20 : 0;
        if (accept.includes('image')) score += 8;
        if (accept.includes('video')) score += 8;
        if (input.multiple) score += 3;
        candidates.push({ input, score });
      });
    });
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.input || null;
  }

  function findMediaTrigger(dialog) {
    if (!dialog) return null;
    const phrases = ['ảnh/video', 'ảnh hoặc video', 'photo/video', 'photo or video', 'add photos', 'add photo'];
    return Array.from(dialog.querySelectorAll('button, [role="button"], [aria-label]')).find((node) => {
      if (!isVisible(node)) return false;
      const text = normalize(`${node.getAttribute('aria-label') || ''} ${node.innerText || node.textContent || ''}`).toLowerCase();
      return phrases.some((phrase) => text.includes(phrase));
    }) || null;
  }

  async function waitForMediaInput(dialog) {
    let input = findMediaInput(dialog);
    if (input) return input;
    const trigger = findMediaTrigger(dialog);
    if (trigger) trigger.click();
    for (let attempt = 0; attempt < 20 && !input; attempt += 1) {
      await sleep(250);
      input = findMediaInput(dialog);
    }
    return input;
  }

  async function attachMedia(dialog, items) {
    if (!items.length) return { ok: true, attachedCount: 0 };
    const input = await waitForMediaInput(dialog);
    if (!input) return { ok: false, error: 'Không tìm thấy nút chọn ảnh/video trong hộp soạn bài Facebook.' };

    const files = [];
    for (let index = 0; index < items.length; index += 1) {
      showStatus(`Đang tải media ${index + 1}/${items.length} cho ${state.groupName}...`);
      try {
        files.push(await downloadMediaFile(items[index], index));
      } catch (error) {
        return { ok: false, error: error?.message || String(error) };
      }
    }

    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    const mediaNodeCountBefore = dialog.querySelectorAll('img, video').length;
    let assignedCount = 0;
    try {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
      if (setter) setter.call(input, transfer.files);
      else input.files = transfer.files;
      assignedCount = Number(input.files?.length || 0);
      if (assignedCount < files.length) {
        return { ok: false, error: 'Facebook không nhận đủ danh sách file ảnh/video.' };
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) {
      return { ok: false, error: `Facebook không nhận danh sách media: ${error?.message || String(error)}` };
    }

    for (let attempt = 0; attempt < 24; attempt += 1) {
      if (!dialog?.isConnected) return { ok: false, error: 'Hộp soạn bài Facebook đã đóng khi đang gắn media.' };
      const mediaNodeCount = dialog.querySelectorAll('img, video').length;
      const hasMediaControl = Array.from(dialog.querySelectorAll('button, [role="button"], [aria-label]')).some((node) => {
        const label = normalize(`${node.getAttribute('aria-label') || ''} ${node.innerText || node.textContent || ''}`).toLowerCase();
        return ['xóa ảnh', 'xóa video', 'remove photo', 'remove video', 'chỉnh sửa', 'edit photo'].some((phrase) => label.includes(phrase));
      });
      if (mediaNodeCount > mediaNodeCountBefore || hasMediaControl) {
        return { ok: true, attachedCount: assignedCount, previewDetected: true };
      }
      await sleep(250);
    }
    // Facebook often consumes and clears input.files immediately after accepting the
    // change event. The successful assignment above is the reliable hand-off signal;
    // the employee still verifies the Facebook preview before clicking Post.
    return { ok: true, attachedCount: assignedCount, previewDetected: false };
  }

  async function preparePost(payload) {
    state.requestId = String(payload.requestId || '');
    state.taskId = String(payload.taskId || '');
    state.groupId = String(payload.groupId || '');
    state.groupName = String(payload.groupName || payload.groupId || 'Facebook Group');
    state.message = String(payload.message || '').trim();
    state.media = normalizeMedia(payload.media);
    state.postClickedAt = 0;
    if (state.completionTimer) clearInterval(state.completionTimer);

    if (!state.message) return { ok: false, error: 'Bài đăng chưa có nội dung.' };

    showStatus(`Đang chuẩn bị bài cho ${state.groupName}...`);
    let dialog = findComposerDialog();
    let editor = findComposerEditor(dialog);
    if (!editor) {
      const trigger = findComposerTrigger();
      if (!trigger) {
        const error = 'Không tìm thấy ô tạo bài viết. Hãy kiểm tra đã tham gia Group và tải lại trang.';
        showStatus(error, 'error');
        return { ok: false, error };
      }
      trigger.click();
      for (let attempt = 0; attempt < 30 && !editor; attempt += 1) {
        await sleep(300);
        dialog = findComposerDialog();
        editor = findComposerEditor(dialog);
      }
    }
    if (!editor) {
      const error = 'Facebook đã mở nhưng chưa xuất hiện ô nhập bài viết.';
      showStatus(error, 'error');
      return { ok: false, error };
    }

    const filled = setEditorText(editor, state.message);
    if (!filled) {
      const error = 'Không điền được caption. Hãy dán nội dung thủ công rồi bấm Đăng.';
      showStatus(error, 'error');
      return { ok: false, error };
    }

    state.editor = editor;
    state.dialog = dialog || editor.closest('[role="dialog"]');
    const mediaResult = await attachMedia(state.dialog, state.media);
    if (!mediaResult.ok) {
      const error = `Không gắn được media: ${mediaResult.error}`;
      showStatus(`${error}\nHàng đợi đã dừng để tránh đăng bài thiếu ảnh/video.`, 'error');
      sendProgress('media_error', { error });
      return { ok: false, final: true, error };
    }

    const mediaHint = mediaResult.attachedCount
      ? ` và chọn ${mediaResult.attachedCount} media`
      : '';
    const previewHint = mediaResult.attachedCount && !mediaResult.previewDetected
      ? '\nFile đã được chuyển cho Facebook; đợi preview xuất hiện rồi mới bấm Đăng.'
      : '';
    showStatus(`Đã điền caption${mediaHint} cho ${state.groupName}.${previewHint}\nKiểm tra preview và tự bấm Đăng. Xong sẽ chuyển ngay sang Group tiếp theo.`);
    sendProgress('ready', { mediaAttachedCount: mediaResult.attachedCount });
    return { ok: true, ready: true, media_attached_count: mediaResult.attachedCount };
  }

  function isPostButton(node) {
    const button = node instanceof Element ? node.closest('button, [role="button"]') : null;
    if (!button || !isVisible(button)) return false;
    const label = normalize(button.getAttribute('aria-label') || '').toLowerCase();
    const text = normalize(button.innerText || button.textContent || '').toLowerCase();
    if (![label, text].some((value) => ['đăng', 'post', 'publish'].includes(value))) return false;
    const dialog = button.closest('[role="dialog"]');
    return Boolean(dialog && state.editor && dialog.contains(state.editor));
  }

  function watchForCompletion() {
    if (state.completionTimer) clearInterval(state.completionTimer);
    state.completionTimer = setInterval(() => {
      if (!state.postClickedAt) return;
      const dialogGone = !state.dialog || !state.dialog.isConnected || !isVisible(state.dialog);
      if (dialogGone) {
        clearInterval(state.completionTimer);
        state.completionTimer = null;
        showStatus(`Đã ghi nhận đăng xong ${state.groupName}. Đang chuyển Group tiếp theo...`, 'success');
        sendProgress('confirmed', { confirmedAt: new Date().toISOString() });
        return;
      }
      if (Date.now() - state.postClickedAt > 45000) {
        clearInterval(state.completionTimer);
        state.completionTimer = null;
        state.postClickedAt = 0;
        showStatus('Facebook chưa xác nhận đăng xong. Kiểm tra thông báo lỗi rồi bấm Đăng lại.', 'error');
        sendProgress('confirmation_timeout');
      }
    }, 500);
  }

  document.addEventListener('click', (event) => {
    if (!state.requestId || !state.editor || !isPostButton(event.target)) return;
    state.postClickedAt = Date.now();
    showStatus(`Đang chờ Facebook xác nhận bài tại ${state.groupName}...`);
    sendProgress('submitting');
    watchForCompletion();
  }, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'STREAL_FACEBOOK_PREPARE_GROUP_POST') return false;
    preparePost(message.payload || {})
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });
})();
