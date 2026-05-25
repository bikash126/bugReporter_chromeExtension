document.getElementById('captureBtn').addEventListener('click', () => {
  // Capture the screen, save it, and open the editor in Image Mode
  chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
    chrome.storage.local.set({ capturedImage: dataUrl }, () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('editor.html?mode=image') });
    });
  });
});

document.getElementById('recordBtn').addEventListener('click', () => {
  // Just open the editor in Video Mode
  chrome.tabs.create({ url: 'editor.html?mode=video' });
});