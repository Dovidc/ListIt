// Trovelr Chrome Extension - Side Panel Logic
// Handles login, listing search, selection, and form filling

let authToken = null;
let apiUrl = 'https://trovelr.com';
let allListings = [];
let selectedListing = null;

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

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  setupEventListeners();
});

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
  logoutBtn.style.display = 'none';
}

function showMainView() {
  loginView.style.display = 'none';
  mainView.style.display = 'flex';
  logoutBtn.style.display = 'flex';
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

  // Update selected panel UI
  document.getElementById('selectedTitle').textContent = listing.title || 'Untitled';
  document.getElementById('selectedPrice').textContent = formatPrice(listing.price);
  document.getElementById('selectedDescription').textContent = listing.description || '';

  // Load images
  await loadListingImages(listing);

  // Show selected panel
  showSelectedPanel();

  // Fill the Facebook form
  fillFacebookForm(listing);
}

// Load listing images
async function loadListingImages(listing) {
  const imagesContainer = document.getElementById('imagesContainer');
  imagesContainer.innerHTML = '<div class="loading-images">Loading images...</div>';

  try {
    // Fetch full listing details with images
    const response = await fetch(`${apiUrl}/api/listings/${listing.id}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to load listing details');
    }

    const fullListing = await response.json();

    // Get images array
    let images = [];
    if (fullListing.images && Array.isArray(fullListing.images)) {
      images = fullListing.images.map(img => img.url || img.image_data).filter(Boolean);
    } else if (fullListing.image_data) {
      images = [fullListing.image_data];
    }

    // Update selected listing with full data
    selectedListing = { ...listing, ...fullListing, imageUrls: images };

    // Render draggable images
    renderDraggableImages(images);

  } catch (err) {
    console.error('Failed to load images:', err);
    // Fall back to cover image
    const images = listing.image_data ? [listing.image_data] : [];
    selectedListing.imageUrls = images;
    renderDraggableImages(images);
  }
}

// Render draggable images
async function renderDraggableImages(imageUrls) {
  const imagesContainer = document.getElementById('imagesContainer');
  imagesContainer.innerHTML = '';

  if (!imageUrls || imageUrls.length === 0) {
    imagesContainer.innerHTML = '<p class="no-images">No images available</p>';
    return;
  }

  // Add "Open Downloads Folder" button
  const openFolderBtn = document.createElement('button');
  openFolderBtn.className = 'btn-download-all';
  openFolderBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
    Save Images & Open Folder
  `;
  openFolderBtn.addEventListener('click', async () => {
    openFolderBtn.disabled = true;
    openFolderBtn.textContent = 'Saving...';

    try {
      for (let i = 0; i < imageUrls.length; i++) {
        const url = imageUrls[i];
        const filename = `trovelr-${(selectedListing?.title || 'image').slice(0,20).replace(/[^a-z0-9]/gi, '_')}-${i + 1}.jpg`;

        // Use Chrome downloads API
        await chrome.downloads.download({
          url: url,
          filename: filename,
          saveAs: false
        });

        await new Promise(r => setTimeout(r, 200));
      }

      // Open downloads folder
      chrome.downloads.showDefaultFolder();

      openFolderBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Done! Drag from folder to Facebook
      `;
    } catch (err) {
      console.error('Download failed:', err);
      openFolderBtn.textContent = 'Download failed - click images instead';
    }

    openFolderBtn.disabled = false;
  });
  imagesContainer.appendChild(openFolderBtn);

  // Show image previews
  imageUrls.forEach((url, index) => {
    const imgWrapper = document.createElement('div');
    imgWrapper.className = 'draggable-image-wrapper';

    const img = document.createElement('img');
    img.src = url;
    img.alt = `Image ${index + 1}`;
    img.className = 'draggable-image';

    // Click individual image to download
    img.addEventListener('click', async () => {
      const filename = `trovelr-${(selectedListing?.title || 'image').slice(0,20).replace(/[^a-z0-9]/gi, '_')}-${index + 1}.jpg`;
      try {
        await chrome.downloads.download({
          url: url,
          filename: filename,
          saveAs: false
        });
        chrome.downloads.showDefaultFolder();
      } catch (err) {
        // Fallback to blob download
        downloadImage(url, filename);
      }
    });

    const downloadHint = document.createElement('span');
    downloadHint.className = 'download-hint';
    downloadHint.textContent = 'Click to save';

    imgWrapper.appendChild(img);
    imgWrapper.appendChild(downloadHint);
    imagesContainer.appendChild(imgWrapper);
  });

  // Helper text
  const helperText = document.createElement('p');
  helperText.className = 'images-helper';
  helperText.textContent = 'Click button above, then drag images from the folder to Facebook';
  imagesContainer.appendChild(helperText);
}

// Download image helper
async function downloadImage(url, filename) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.error('Failed to download image:', err);
    // Fallback: open in new tab
    window.open(url, '_blank');
  }
}

// Generate a description from listing data if none exists
function generateDescription(listing) {
  // If listing already has a description, use it
  if (listing.description && listing.description.trim()) {
    return listing.description;
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

  // Add location if available
  if (listing.location) {
    parts.push(`Location: ${listing.location}`);
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

  chrome.runtime.sendMessage({
    type: 'FILL_FORM',
    listing: {
      title: listing.title || '',
      price: listing.price || 0,
      description: description,
      location: listing.location || '',
      condition: 'Used - Fair',
      category: listing.tags || listing.category || ''
    }
  }, (response) => {
    if (response && response.success) {
      statusMessage.style.display = 'flex';
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
