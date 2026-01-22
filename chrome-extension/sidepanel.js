// Trovelr Chrome Extension - Side Panel Logic
// Handles login, listing search, selection, and form filling

let authToken = null;
let apiUrl = 'https://trovelr.com';
let allListings = [];
let selectedListing = null;
let savedScrollPosition = 0;

// DOM Elements
const loginView = document.getElementById('loginView');
const mainView = document.getElementById('mainView');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const logoutBtn = document.getElementById('logoutBtn');
const searchInput = document.getElementById('searchInput');
const clearSearch = document.getElementById('clearSearch');
const listingsContainer = document.getElementById('listingsContainer');
const loadingState = document.getElementById('loadingState');
const emptyState = document.getElementById('emptyState');
const selectedPanel = document.getElementById('selectedPanel');
const backBtn = document.getElementById('backBtn');
const statusMessage = document.getElementById('statusMessage');
const categoryStatus = document.getElementById('categoryStatus');
const fillFormBtn = document.getElementById('fillFormBtn');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  setupEventListeners();
  listenForAutoCategory();
});

// Listen for auto category selection from content script
function listenForAutoCategory() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CATEGORY_AUTO_SELECTED') {
      // Update the category status display
      if (message.success) {
        categoryStatus.className = 'category-status success';
        categoryStatus.textContent = `Category: ${message.selectedCategory}`;
        categoryStatus.style.display = 'block';
      } else {
        categoryStatus.className = 'category-status error';
        categoryStatus.textContent = message.error || 'Could not auto-select category';
        categoryStatus.style.display = 'block';
      }
    }

    if (message.type === 'PUBLISH_CLICKED') {
      console.log('Sidepanel: Received PUBLISH_CLICKED message');
      // User clicked publish, go back to listings view
      handlePublishComplete();
    }
  });
}

// Check if user is authenticated
async function checkAuth() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_AUTH_TOKEN' }, (response) => {
      if (response && response.token) {
        authToken = response.token;
        apiUrl = response.apiUrl || 'https://trovelr.com';
        document.getElementById('apiUrl').value = apiUrl;
        showMainView();
        loadListings();
      } else {
        showLoginView();
      }
      resolve();
    });
  });
}

// Setup event listeners
function setupEventListeners() {
  // Login form
  loginForm.addEventListener('submit', handleLogin);

  // Logout
  logoutBtn.addEventListener('click', handleLogout);

  // Search
  searchInput.addEventListener('input', handleSearch);
  clearSearch.addEventListener('click', () => {
    searchInput.value = '';
    clearSearch.style.display = 'none';
    renderListings(allListings);
  });

  // Back button
  backBtn.addEventListener('click', hideSelectedPanel);

  // Fill form button
  fillFormBtn.addEventListener('click', () => {
    if (selectedListing) {
      fillFacebookForm(selectedListing);
    }
  });
}

// Handle login
async function handleLogin(e) {
  e.preventDefault();

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  apiUrl = document.getElementById('apiUrl').value.trim() || 'https://trovelr.com';

  // Remove trailing slash
  apiUrl = apiUrl.replace(/\/$/, '');

  loginError.textContent = '';
  const loginBtn = document.getElementById('loginBtn');
  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in...';

  try {
    const response = await fetch(`${apiUrl}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Login failed');
    }

    if (!data.token) {
      throw new Error('No token received');
    }

    // Save token
    authToken = data.token;
    chrome.runtime.sendMessage({
      type: 'SAVE_AUTH_TOKEN',
      token: authToken,
      apiUrl: apiUrl
    });

    showMainView();
    loadListings();

  } catch (err) {
    loginError.textContent = err.message || 'Failed to sign in';
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';
  }
}

// Handle logout
function handleLogout() {
  chrome.runtime.sendMessage({ type: 'LOGOUT' }, () => {
    authToken = null;
    allListings = [];
    selectedListing = null;
    showLoginView();
  });
}

// Show/hide views
function showLoginView() {
  loginView.style.display = 'flex';
  mainView.style.display = 'none';
}

function showMainView() {
  loginView.style.display = 'none';
  mainView.style.display = 'flex';
}

// Load user's listings
async function loadListings() {
  showLoading(true);
  emptyState.style.display = 'none';
  listingsContainer.innerHTML = '';

  try {
    // First get the current user's ID
    const meResponse = await fetch(`${apiUrl}/api/me`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (meResponse.status === 401) {
      handleLogout();
      return;
    }

    if (!meResponse.ok) {
      throw new Error('Failed to get user info');
    }

    const userData = await meResponse.json();
    const userId = userData.id || userData.user?.id;

    if (!userId) {
      throw new Error('Could not determine user ID');
    }

    // Now fetch user's listings
    const response = await fetch(`${apiUrl}/api/users/${userId}/listings`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to load listings');
    }

    const data = await response.json();
    allListings = Array.isArray(data) ? data : (data.rows || []);

    // Filter out sold items
    allListings = allListings.filter(l => !l.sold);

    renderListings(allListings);

  } catch (err) {
    console.error('Failed to load listings:', err);
    listingsContainer.innerHTML = `
      <div class="error-state">
        <p>Failed to load listings</p>
        <button class="btn-secondary" onclick="loadListings()">Retry</button>
      </div>
    `;
  } finally {
    showLoading(false);
  }
}

// Render listings grid
function renderListings(listings) {
  listingsContainer.innerHTML = '';

  if (!listings || listings.length === 0) {
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';

  listings.forEach(listing => {
    const card = createListingCard(listing);
    listingsContainer.appendChild(card);
  });
}

// Create a listing card element
function createListingCard(listing) {
  const card = document.createElement('div');
  card.className = 'listing-card';
  card.dataset.id = listing.id;

  const imageUrl = listing.image_data || listing.thumb_url || '';
  const price = formatPrice(listing.price);
  const title = listing.title || 'Untitled';

  card.innerHTML = `
    <div class="listing-image" style="background-image: url('${escapeHtml(imageUrl)}')">
      ${!imageUrl ? '<div class="no-image">No Image</div>' : ''}
    </div>
    <div class="listing-info">
      <span class="listing-price">${price}</span>
      <span class="listing-title">${escapeHtml(title)}</span>
    </div>
  `;

  card.addEventListener('click', () => selectListing(listing));

  return card;
}

// Handle search
function handleSearch(e) {
  const query = e.target.value.trim().toLowerCase();
  clearSearch.style.display = query ? 'flex' : 'none';

  if (!query) {
    renderListings(allListings);
    return;
  }

  const filtered = allListings.filter(listing => {
    const title = (listing.title || '').toLowerCase();
    const description = (listing.description || '').toLowerCase();
    const location = (listing.location || '').toLowerCase();
    const tags = (listing.tags || '').toLowerCase();

    return title.includes(query) ||
           description.includes(query) ||
           location.includes(query) ||
           tags.includes(query);
  });

  renderListings(filtered);
}

// Select a listing
async function selectListing(listing) {
  selectedListing = listing;

  // Save current scroll position
  savedScrollPosition = document.documentElement.scrollTop || document.body.scrollTop || listingsContainer.scrollTop;
  console.log('Saved scroll position:', savedScrollPosition);

  // Download images immediately (in background)
  loadListingImages(listing);

  // Fill the Facebook form immediately
  fillFacebookForm(listing);
}

// Load listing images
async function loadListingImages(listing) {
  const imagesContainer = document.getElementById('imagesContainer');
  imagesContainer.innerHTML = '<div class="loading-images">Loading images...</div>';

  try {
    // Fetch images using the dedicated images endpoint
    const response = await fetch(`${apiUrl}/api/listings/${listing.id}/images`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to load listing images');
    }

    const data = await response.json();
    console.log('Loaded images:', data);

    // The endpoint returns { images: ['url1', 'url2', ...] }
    let images = [];
    if (Array.isArray(data.images)) {
      images = data.images.filter(Boolean);
    } else if (Array.isArray(data)) {
      images = data.filter(Boolean);
    }

    // Update selected listing with images
    selectedListing = { ...listing, imageUrls: images };

    // Render and auto-download images
    renderDraggableImages(images, listing.title);

  } catch (err) {
    console.error('Failed to load images:', err);
    // Fall back to cover image
    const images = listing.image_data ? [listing.image_data] : [];
    selectedListing.imageUrls = images;
    renderDraggableImages(images, listing.title);
  }
}

// Generate a safe filename from the listing title
function generateFilename(title, index, totalImages) {
  // Clean the title for use as filename
  let safeName = (title || 'listing')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')  // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '')       // Remove leading/trailing hyphens
    .substring(0, 40);             // Limit length

  // Add image number if multiple images
  if (totalImages > 1) {
    return `${safeName}-${index + 1}.jpg`;
  }
  return `${safeName}.jpg`;
}

// Render draggable images and auto-download them
async function renderDraggableImages(imageUrls, listingTitle) {
  const imagesContainer = document.getElementById('imagesContainer');
  const downloadStatus = document.getElementById('downloadStatus');
  imagesContainer.innerHTML = '';

  if (!imageUrls || imageUrls.length === 0) {
    imagesContainer.innerHTML = '<p class="no-images">No images available</p>';
    downloadStatus.style.display = 'none';
    return;
  }

  // Show download status
  downloadStatus.style.display = 'flex';
  downloadStatus.className = 'download-status loading';
  downloadStatus.innerHTML = `
    <div class="download-spinner"></div>
    <span>Downloading ${imageUrls.length} image(s)...</span>
  `;

  // Show image previews
  imageUrls.forEach((url, index) => {
    const imgWrapper = document.createElement('div');
    imgWrapper.className = 'draggable-image-wrapper';

    const img = document.createElement('img');
    img.src = url;
    img.alt = `Image ${index + 1}`;
    img.className = 'draggable-image';
    img.style.opacity = '0.5'; // Dimmed until downloaded

    imgWrapper.appendChild(img);
    imagesContainer.appendChild(imgWrapper);
  });

  // Auto-download all images with descriptive filenames
  let downloadedCount = 0;
  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    const filename = generateFilename(listingTitle, i, imageUrls.length);

    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_IMAGE',
      url: url,
      filename: filename
    }, () => {
      downloadedCount++;
      // Update image opacity to show it's downloaded
      const imgs = imagesContainer.querySelectorAll('.draggable-image');
      if (imgs[i]) {
        imgs[i].style.opacity = '1';
        imgs[i].parentElement.classList.add('downloaded');
      }
      // Update status
      if (downloadedCount === imageUrls.length) {
        downloadStatus.className = 'download-status success';
        downloadStatus.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span>${imageUrls.length} image(s) ready! Drag from Downloads folder to Facebook.</span>
        `;
      } else {
        downloadStatus.querySelector('span').textContent = `Downloading ${downloadedCount}/${imageUrls.length} images...`;
      }
    });
    // Small delay between downloads
    await new Promise(r => setTimeout(r, 200));
  }
}

// Download image using anchor tag (simple approach)
async function downloadImageAsBlob(url, filename) {
  try {
    // Fetch the image as blob
    const response = await fetch(url);
    const blob = await response.blob();

    // Create object URL and trigger download
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Clean up
    setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
    return true;
  } catch (err) {
    console.error('Download failed:', err);
    return false;
  }
}

// Generate a description from listing data if none exists
function generateDescription(listing) {
  // If listing already has a description, use it and append branding
  if (listing.description && listing.description.trim()) {
    return listing.description + '\n\nListed with Trovelr';
  }

  // Build description from available data
  const parts = [];

  // Add title as first line
  if (listing.title) {
    parts.push(listing.title);
  }

  // Add category/tags if available
  if (listing.tags) {
    parts.push(`Category: ${listing.tags}`);
  } else if (listing.category) {
    parts.push(`Category: ${listing.category}`);
  }

  // Add a generic line
  if (parts.length > 0) {
    parts.push('');
    parts.push('Listed with Trovelr');
  }

  return parts.join('\n');
}

// Fill Facebook form via content script
function fillFacebookForm(listing) {
  statusMessage.style.display = 'none';

  const description = generateDescription(listing);

  // Send listing data to content script
  // Category selection is now done by content script after reading FB's suggested categories
  chrome.runtime.sendMessage({
    type: 'FILL_FORM',
    listing: {
      title: listing.title || '',
      price: listing.price || 0,
      description: description,
      location: listing.location || '',
      condition: 'Used - Fair'
      // Category is handled by content script based on FB's image-based suggestions
    }
  }, (response) => {
    if (response && response.success) {
      statusMessage.style.display = 'flex';
      // Category will be auto-selected when user adds an image
      // Show a hint that category will be auto-selected
      categoryStatus.className = 'category-status loading';
      categoryStatus.textContent = 'Category will be auto-selected when you add an image...';
      categoryStatus.style.display = 'block';
    }
  });
}

// Show/hide selected panel
function showSelectedPanel() {
  selectedPanel.style.display = 'flex';
  document.querySelector('.search-container').style.display = 'none';
  listingsContainer.style.display = 'none';
  emptyState.style.display = 'none';
}

function hideSelectedPanel() {
  selectedPanel.style.display = 'none';
  document.querySelector('.search-container').style.display = 'flex';
  listingsContainer.style.display = 'grid';
  selectedListing = null;
  statusMessage.style.display = 'none';
  categoryStatus.style.display = 'none';

  // Restore scroll position after DOM updates
  requestAnimationFrame(() => {
    restoreScrollPosition();
  });
}

// Handle when publish button is clicked on Facebook
function handlePublishComplete() {
  console.log('Sidepanel: handlePublishComplete called');

  // Show "New Listing" button in the main listings view
  showNewListingButton();
}

// Show "New Listing" button after publishing
function showNewListingButton() {
  let newListingBanner = document.getElementById('newListingBanner');

  if (!newListingBanner) {
    newListingBanner = document.createElement('div');
    newListingBanner.id = 'newListingBanner';
    newListingBanner.style.cssText = `
      position: fixed;
      top: 60px;
      left: 0;
      right: 0;
      background: linear-gradient(135deg, #1e7e34 0%, #166534 100%);
      padding: 16px;
      padding-right: 40px;
      text-align: center;
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;

    newListingBanner.innerHTML = `
      <button id="closeBannerBtn" style="
        position: absolute;
        top: 8px;
        right: 8px;
        background: transparent;
        border: none;
        color: white;
        cursor: pointer;
        font-size: 24px;
        line-height: 1;
        padding: 4px 8px;
        opacity: 0.7;
        transition: opacity 0.2s;
      " onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'">×</button>
      <div style="color: white; font-weight: 600; margin-bottom: 12px; font-size: 16px;">
        ✓ Published Successfully!
      </div>
      <button id="newListingBtn" style="
        background: white;
        color: #166534;
        border: none;
        padding: 12px 32px;
        border-radius: 8px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        transition: background 0.2s;
      " onmouseover="this.style.background='#f0f0f0'" onmouseout="this.style.background='white'">New Listing</button>
    `;

    document.body.appendChild(newListingBanner);

    // Add event listeners
    document.getElementById('newListingBtn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_CREATE' });
      newListingBanner.remove();
    });

    document.getElementById('closeBannerBtn').addEventListener('click', () => {
      newListingBanner.remove();
    });
  }

  newListingBanner.style.display = 'block';
}

// Restore scroll position
function restoreScrollPosition() {
  if (savedScrollPosition > 0) {
    console.log('Restoring scroll position to:', savedScrollPosition);

    // Try multiple times to ensure the DOM is ready
    const attemptRestore = (attempts = 0) => {
      // Restore to the same element that was scrolling (document.documentElement)
      document.documentElement.scrollTop = savedScrollPosition;
      document.body.scrollTop = savedScrollPosition;
      listingsContainer.scrollTop = savedScrollPosition;

      // Verify it worked
      const currentScroll = document.documentElement.scrollTop || document.body.scrollTop || listingsContainer.scrollTop;
      if (currentScroll !== savedScrollPosition && attempts < 5) {
        setTimeout(() => attemptRestore(attempts + 1), 50);
      } else {
        console.log('Scroll restored to:', currentScroll);
      }
    };

    attemptRestore();
  }
}

// Show/hide loading state
function showLoading(show) {
  loadingState.style.display = show ? 'flex' : 'none';
}

// Format price
function formatPrice(price) {
  const num = parseFloat(price) || 0;
  return '$' + num.toFixed(num % 1 === 0 ? 0 : 2);
}

// Escape HTML to prevent XSS
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
