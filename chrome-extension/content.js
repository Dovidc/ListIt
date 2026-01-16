// Trovelr Chrome Extension - Content Script
// Runs on Facebook Marketplace create page to fill form fields

(function() {
  'use strict';

  // Listen for fill form messages
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FILL_FACEBOOK_FORM') {
      fillForm(message.listing)
        .then(() => sendResponse({ success: true }))
        .catch((err) => {
          console.error('Failed to fill form:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true; // Keep channel open for async response
    }
  });

  // Fill the Facebook Marketplace form
  async function fillForm(listing) {
    console.log('Trovelr: Filling form with listing:', listing);

    // Wait for the form to be ready
    await waitForForm();

    // Fill each field with delays to allow React to process
    await fillTitle(listing.title);
    await delay(100);

    await fillPrice(listing.price);
    await delay(100);

    await fillDescription(listing.description);
    await delay(100);

    // Location is usually auto-detected by Facebook, but we can try
    // await fillLocation(listing.location);

    console.log('Trovelr: Form filled successfully');
  }

  // Wait for the form to be ready
  function waitForForm(timeout = 10000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      function check() {
        // Look for title input - Facebook uses aria-label
        const titleInput = findTitleInput();
        if (titleInput) {
          resolve(titleInput);
          return;
        }

        if (Date.now() - startTime > timeout) {
          reject(new Error('Form not found - make sure you are on Facebook Marketplace create page'));
          return;
        }

        setTimeout(check, 200);
      }

      check();
    });
  }

  // Find the title input field
  function findTitleInput() {
    // Try various selectors Facebook might use
    const selectors = [
      'input[aria-label="Title"]',
      'label[aria-label="Title"] input',
      'input[placeholder*="Title"]',
      'input[name="title"]'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }

    // Fallback: find by looking at the form structure
    const inputs = document.querySelectorAll('input[type="text"]');
    for (const input of inputs) {
      const label = input.closest('label');
      if (label && label.textContent.includes('Title')) {
        return input;
      }
      // Check parent for label text
      const parent = input.parentElement?.parentElement;
      if (parent && parent.textContent.includes('Title') && !parent.textContent.includes('Price')) {
        return input;
      }
    }

    return null;
  }

  // Find the price input field
  function findPriceInput() {
    const selectors = [
      'input[aria-label="Price"]',
      'label[aria-label="Price"] input',
      'input[placeholder*="Price"]',
      'input[name="price"]'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }

    // Fallback: find input near "Price" text
    const inputs = document.querySelectorAll('input[type="text"]');
    for (const input of inputs) {
      const parent = input.parentElement?.parentElement;
      if (parent && parent.textContent.includes('Price') && !parent.textContent.includes('Title')) {
        return input;
      }
    }

    return null;
  }

  // Find the description textarea
  function findDescriptionInput() {
    const selectors = [
      'textarea[aria-label="Description"]',
      'label[aria-label="Description"] textarea',
      'textarea[placeholder*="Description"]',
      'textarea[placeholder*="description"]',
      'textarea[name="description"]'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }

    // Fallback: find any textarea
    const textareas = document.querySelectorAll('textarea');
    for (const textarea of textareas) {
      const parent = textarea.closest('div[role="textbox"]')?.parentElement;
      if (parent && parent.textContent.toLowerCase().includes('description')) {
        return textarea;
      }
    }

    // Try contenteditable divs (Facebook sometimes uses these)
    const editables = document.querySelectorAll('div[contenteditable="true"]');
    for (const editable of editables) {
      const label = editable.closest('label');
      if (label && label.textContent.toLowerCase().includes('description')) {
        return editable;
      }
    }

    return textareas[0] || null;
  }

  // Fill title field
  async function fillTitle(title) {
    if (!title) return;

    const input = findTitleInput();
    if (!input) {
      console.warn('Trovelr: Title input not found');
      return;
    }

    await setInputValue(input, title);
    console.log('Trovelr: Title filled');
  }

  // Fill price field
  async function fillPrice(price) {
    const priceValue = String(Math.round(parseFloat(price) || 0));

    const input = findPriceInput();
    if (!input) {
      console.warn('Trovelr: Price input not found');
      return;
    }

    await setInputValue(input, priceValue);
    console.log('Trovelr: Price filled');
  }

  // Fill description field
  async function fillDescription(description) {
    if (!description) return;

    const input = findDescriptionInput();
    if (!input) {
      console.warn('Trovelr: Description input not found');
      return;
    }

    if (input.tagName === 'TEXTAREA') {
      await setInputValue(input, description);
    } else if (input.contentEditable === 'true') {
      // Handle contenteditable div
      input.focus();
      input.textContent = description;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      await setInputValue(input, description);
    }

    console.log('Trovelr: Description filled');
  }

  // Set input value in a way that React recognizes
  async function setInputValue(input, value) {
    // Focus the input
    input.focus();
    await delay(50);

    // Clear existing value
    input.value = '';

    // Get the native value setter
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;

    // Use the appropriate setter
    if (input.tagName === 'TEXTAREA' && nativeTextareaValueSetter) {
      nativeTextareaValueSetter.call(input, value);
    } else if (nativeInputValueSetter) {
      nativeInputValueSetter.call(input, value);
    } else {
      input.value = value;
    }

    // Dispatch events to notify React
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

    // Blur and refocus to trigger validation
    input.blur();
    await delay(50);
  }

  // Delay helper
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Let background script know content script is ready
  console.log('Trovelr content script loaded on Facebook Marketplace');
})();
