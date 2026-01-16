// Trovelr Chrome Extension - Background Service Worker
// Handles extension icon click and side panel management

const FACEBOOK_CREATE_URL = 'https://www.facebook.com/marketplace/create/item';

// Enable side panel to open on action click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// When user clicks the extension icon
chrome.action.onClicked.addListener(async (tab) => {
  // Open Facebook Marketplace create page in current tab or new tab
  let targetTabId = tab.id;

  if (!tab.url.includes('facebook.com/marketplace/create')) {
    // Navigate to FB Marketplace create page
    await chrome.tabs.update(tab.id, { url: FACEBOOK_CREATE_URL });
  }

  // Open the side panel
  try {
    await chrome.sidePanel.open({ tabId: targetTabId });
  } catch (err) {
    console.error('Failed to open side panel:', err);
  }
});

// Listen for messages from content script or side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_AUTH_TOKEN') {
    // Get stored auth token
    chrome.storage.local.get(['trovelrToken', 'trovelrApiUrl'], (result) => {
      sendResponse({
        token: result.trovelrToken || null,
        apiUrl: result.trovelrApiUrl || 'https://trovelr.com'
      });
    });
    return true; // Keep channel open for async response
  }

  if (message.type === 'SAVE_AUTH_TOKEN') {
    // Save auth token
    chrome.storage.local.set({
      trovelrToken: message.token,
      trovelrApiUrl: message.apiUrl || 'https://trovelr.com'
    }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'LOGOUT') {
    // Clear auth token
    chrome.storage.local.remove(['trovelrToken', 'trovelrApiUrl'], () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'FILL_FORM') {
    // Forward fill request to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'FILL_FACEBOOK_FORM',
          listing: message.listing
        }, (response) => {
          sendResponse(response);
        });
      }
    });
    return true;
  }

  if (message.type === 'DOWNLOAD_IMAGE') {
    // Download image from background script (has full permissions)
    (async () => {
      try {
        const response = await fetch(message.url);
        const blob = await response.blob();
        const reader = new FileReader();

        reader.onloadend = async () => {
          const dataUrl = reader.result;
          await chrome.downloads.download({
            url: dataUrl,
            filename: message.filename,
            saveAs: false
          });
          sendResponse({ success: true });
        };

        reader.onerror = () => {
          sendResponse({ success: false, error: 'Failed to read blob' });
        };

        reader.readAsDataURL(blob);
      } catch (err) {
        console.error('Download failed:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'OPEN_DOWNLOADS_FOLDER') {
    chrome.downloads.showDefaultFolder();
    sendResponse({ success: true });
    return true;
  }
});

// When extension is installed or updated
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Trovelr extension installed');
  } else if (details.reason === 'update') {
    console.log('Trovelr extension updated to version', chrome.runtime.getManifest().version);
  }
});
