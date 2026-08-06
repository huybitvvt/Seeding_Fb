(() => {
  if (window.__strealFacebookGroupAssistantLoaded) return;
  window.__strealFacebookGroupAssistantLoaded = true;

  const state = {
    requestId: '',
    taskId: '',
    groupId: '',
    groupName: '',
    message: '',
    mediaCount: 0,
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
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, message);
    } catch {
      inserted = false;
    }
    if (!inserted || !normalize(editor.innerText || editor.textContent)) {
      editor.textContent = message;
      editor.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: message,
      }));
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: message,
      }));
    }
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    return normalize(editor.innerText || editor.textContent).length > 0;
  }

  async function preparePost(payload) {
    state.requestId = String(payload.requestId || '');
    state.taskId = String(payload.taskId || '');
    state.groupId = String(payload.groupId || '');
    state.groupName = String(payload.groupName || payload.groupId || 'Facebook Group');
    state.message = String(payload.message || '').trim();
    state.mediaCount = Number(payload.mediaCount || 0) || 0;
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
    const mediaHint = state.mediaCount
      ? `\nBài có ${state.mediaCount} media: hãy thêm file thủ công trước khi đăng.`
      : '';
    showStatus(`Đã điền bài cho ${state.groupName}.${mediaHint}\nKiểm tra nội dung và tự bấm Đăng. Xong sẽ chuyển ngay sang Group tiếp theo.`);
    sendProgress('ready', { mediaCount: state.mediaCount });
    return { ok: true, ready: true, media_manual_required: state.mediaCount > 0 };
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
