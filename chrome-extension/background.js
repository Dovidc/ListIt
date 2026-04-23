// Trovelr Chrome Extension - Background Service Worker
// Handles extension icon click and side panel management

const API_URL = 'https://trovelr.com';
const FACEBOOK_CREATE_URL = 'https://www.facebook.com/marketplace/create/item';

// Trusted domains for image downloads
const TRUSTED_DOWNLOAD_DOMAINS = [
  'trovelr.com',
  '.trovelr.com',
  '.cloudfront.net',
  '.amazonaws.com'
];

function isAllowedDownloadUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return TRUSTED_DOWNLOAD_DOMAINS.some(domain =>
      domain.startsWith('.') ? parsed.hostname.endsWith(domain) : parsed.hostname === domain
    );
  } catch {
    return false;
  }
}

function isInternalSender(sender) {
  return sender.id === chrome.runtime.id;
}

// When user clicks the extension icon - open side panel AND navigate
chrome.action.onClicked.addListener(async (tab) => {
  // Open side panel first (requires user gesture, which we have from the click)
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (err) {
    console.error('Failed to open side panel:', err);
  }

  // Navigate to FB Marketplace create page
  await chrome.tabs.update(tab.id, { url: FACEBOOK_CREATE_URL });
});

// Listen for messages from content script or side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only accept messages from our own extension
  if (!isInternalSender(sender)) return;

  if (message.type === 'GET_AUTH_TOKEN') {
    // Get stored auth token
    chrome.storage.local.get(['trovelrToken'], (result) => {
      sendResponse({
        token: result.trovelrToken || null
      });
    });
    return true; // Keep channel open for async response
  }

  if (message.type === 'SAVE_AUTH_TOKEN') {
    // Save auth token
    chrome.storage.local.set({
      trovelrToken: message.token
    }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'LOGOUT') {
    // Clear auth token
    chrome.storage.local.remove(['trovelrToken'], () => {
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

  if (message.type === 'SELECT_CATEGORY') {
    // Forward category selection request to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'SELECT_FACEBOOK_CATEGORY',
          title: message.title
        }, (response) => {
          sendResponse(response);
        });
      }
    });
    return true;
  }

  if (message.type === 'DOWNLOAD_IMAGE') {
    // Validate download URL against trusted domains
    if (!isAllowedDownloadUrl(message.url)) {
      console.error('Download blocked - untrusted URL:', message.url);
      sendResponse({ success: false, error: 'Download URL not allowed' });
      return true;
    }

    const downloadOptions = {
      url: message.url
    };

    // Use custom filename if provided (sanitized by generateFilename in sidepanel.js)
    if (message.filename) {
      downloadOptions.filename = message.filename;
    }

    chrome.downloads.download(downloadOptions, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('Download error:', chrome.runtime.lastError.message);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log('Download started:', downloadId);
        sendResponse({ success: true, downloadId });
      }
    });
    return true;
  }

  if (message.type === 'OPEN_DOWNLOADS_FOLDER') {
    chrome.downloads.showDefaultFolder();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'CATEGORY_MATCH') {
    // Proxy API call to avoid CORS issues from content script
    chrome.storage.local.get(['trovelrToken'], async (result) => {
      const token = result.trovelrToken;

      if (!token) {
        sendResponse({ success: false, error: 'No auth token' });
        return;
      }

      try {
        const response = await fetch(`${API_URL}/api/facebook/category-match`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            title: message.title,
            suggestedCategories: message.suggestedCategories
          })
        });

        if (response.ok) {
          const data = await response.json();
          sendResponse({ success: true, category: data.category });
        } else {
          sendResponse({ success: false, error: 'API request failed' });
        }
      } catch (err) {
        console.error('Category match error:', err);
        sendResponse({ success: false, error: err.message });
      }
    });
    return true;
  }

  if (message.type === 'NAVIGATE_TO_CREATE') {
    console.log('Background: Received NAVIGATE_TO_CREATE');
    // Navigate the active tab to Facebook Marketplace create page
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        console.log('Background: Navigating tab to:', FACEBOOK_CREATE_URL);
        chrome.tabs.update(tabs[0].id, { url: FACEBOOK_CREATE_URL });
      } else {
        console.log('Background: No active tab found');
      }
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'PUBLISH_CLICKED') {
    console.log('Background: Received PUBLISH_CLICKED, forwarding to sidepanel');
    // Forward the message to the side panel
    chrome.runtime.sendMessage({ type: 'PUBLISH_CLICKED' });
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
