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
    await delay(200);

    await fillPrice(listing.price);
    await delay(200);

    // Try to select category
    await fillCategory(listing.category || listing.tags);
    await delay(200);

    // Try to select condition (default to "Used - Good")
    await fillCondition(listing.condition);
    await delay(200);

    // Fill description last (it's a textarea that might need extra handling)
    await fillDescription(listing.description);
    await delay(100);

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

    const inputs = document.querySelectorAll('input[type="text"]');
    for (const input of inputs) {
      const parent = input.parentElement?.parentElement;
      if (parent && parent.textContent.includes('Price') && !parent.textContent.includes('Title')) {
        return input;
      }
    }

    return null;
  }

  // Find the description input
  function findDescriptionInput() {
    // Facebook uses a span with specific attributes for description
    const selectors = [
      'span[data-lexical-text="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea[aria-label*="escription"]',
      'label[aria-label="Description"] textarea',
      'textarea[placeholder*="Description"]',
      'textarea[placeholder*="description"]'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }

    // Look for Description label and find nearby editable
    const labels = document.querySelectorAll('span, label');
    for (const label of labels) {
      if (label.textContent === 'Description') {
        // Find the editable area near this label
        const container = label.closest('div')?.parentElement?.parentElement;
        if (container) {
          const editable = container.querySelector('[contenteditable="true"]');
          if (editable) return editable;
        }
      }
    }

    // Fallback: find any contenteditable div
    const editables = document.querySelectorAll('div[contenteditable="true"]');
    if (editables.length > 0) {
      return editables[editables.length - 1]; // Usually the last one is description
    }

    return document.querySelector('textarea');
  }

  // Find and click a dropdown, then select an option
  async function clickDropdownAndSelect(labelText, optionText) {
    // Find the dropdown by label
    const allElements = document.querySelectorAll('div[role="button"], div[role="combobox"], label');

    for (const el of allElements) {
      const text = el.textContent || '';
      if (text.includes(labelText) || el.getAttribute('aria-label')?.includes(labelText)) {
        // Found the dropdown area, look for clickable element
        const clickable = el.querySelector('[role="button"]') || el;

        // Click to open dropdown
        clickable.click();
        await delay(300);

        // Find and click the option
        const options = document.querySelectorAll('[role="option"], [role="menuitem"], div[role="button"]');
        for (const option of options) {
          if (option.textContent?.includes(optionText)) {
            option.click();
            await delay(200);
            console.log(`Trovelr: Selected "${optionText}" for ${labelText}`);
            return true;
          }
        }

        // If no exact match, try partial match
        for (const option of options) {
          const optText = option.textContent?.toLowerCase() || '';
          if (optText.includes(optionText.toLowerCase())) {
            option.click();
            await delay(200);
            console.log(`Trovelr: Selected "${option.textContent}" for ${labelText}`);
            return true;
          }
        }

        // Close dropdown if no match found (click elsewhere)
        document.body.click();
        await delay(100);
        break;
      }
    }
    return false;
  }

  // Fill category dropdown
  async function fillCategory(category) {
    if (!category) {
      // Default to "Miscellaneous" or similar
      category = 'Miscellaneous';
    }

    // Map common categories
    const categoryMap = {
      'electronics': 'Electronics',
      'furniture': 'Furniture',
      'clothing': 'Clothing',
      'home': 'Home',
      'garden': 'Garden',
      'toys': 'Toys',
      'sports': 'Sporting Goods',
      'auto': 'Auto Parts',
      'books': 'Books',
      'music': 'Musical Instruments',
      'tools': 'Tools',
      'baby': 'Baby & Kids',
      'jewelry': 'Jewelry',
      'art': 'Art',
      'collectibles': 'Collectibles',
      'antiques': 'Antiques',
      'appliances': 'Appliances',
      'health': 'Health & Beauty',
      'office': 'Office Supplies',
      'pets': 'Pet Supplies'
    };

    // Try to match category
    let fbCategory = 'Miscellaneous';
    const lowerCat = (category || '').toLowerCase();

    for (const [key, value] of Object.entries(categoryMap)) {
      if (lowerCat.includes(key)) {
        fbCategory = value;
        break;
      }
    }

    // Click on Category dropdown
    const categorySection = findClickableByText('Category');
    if (categorySection) {
      categorySection.click();
      await delay(400);

      // Look for the category in the dropdown
      const found = await selectDropdownOption(fbCategory);
      if (!found) {
        // Try "Miscellaneous" as fallback
        await selectDropdownOption('Miscellaneous');
      }
    } else {
      console.warn('Trovelr: Category dropdown not found');
    }
  }

  // Fill condition dropdown
  async function fillCondition(condition) {
    // Default to "Used - Good"
    let fbCondition = 'Used - Good';

    if (condition) {
      const lowerCond = condition.toLowerCase();
      if (lowerCond.includes('new')) {
        fbCondition = 'New';
      } else if (lowerCond.includes('like new')) {
        fbCondition = 'Used - Like New';
      } else if (lowerCond.includes('fair')) {
        fbCondition = 'Used - Fair';
      } else if (lowerCond.includes('good')) {
        fbCondition = 'Used - Good';
      }
    }

    // Click on Condition dropdown
    const conditionSection = findClickableByText('Condition');
    if (conditionSection) {
      conditionSection.click();
      await delay(400);

      await selectDropdownOption(fbCondition);
    } else {
      console.warn('Trovelr: Condition dropdown not found');
    }
  }

  // Find a clickable element by its label text
  function findClickableByText(labelText) {
    // Look for label or span containing the text
    const elements = document.querySelectorAll('label, span, div');

    for (const el of elements) {
      if (el.childNodes.length <= 3 && el.textContent?.trim() === labelText) {
        // Found the label, now find the clickable dropdown near it
        let parent = el.parentElement;
        for (let i = 0; i < 5 && parent; i++) {
          const clickable = parent.querySelector('[role="combobox"], [role="button"], [aria-haspopup="listbox"]');
          if (clickable) return clickable;

          // Check if parent itself is clickable
          if (parent.getAttribute('role') === 'button' || parent.getAttribute('role') === 'combobox') {
            return parent;
          }
          parent = parent.parentElement;
        }

        // Try clicking the container itself
        const container = el.closest('div[class]');
        if (container) return container;
      }
    }

    return null;
  }

  // Select an option from an open dropdown
  async function selectDropdownOption(optionText) {
    await delay(200);

    // Find all potential options
    const optionSelectors = [
      '[role="option"]',
      '[role="menuitem"]',
      '[role="menuitemradio"]',
      'div[tabindex="-1"]',
      'div[tabindex="0"]'
    ];

    for (const selector of optionSelectors) {
      const options = document.querySelectorAll(selector);
      for (const option of options) {
        const text = option.textContent?.trim() || '';
        if (text === optionText || text.includes(optionText)) {
          option.click();
          await delay(200);
          return true;
        }
      }
    }

    // Try clicking away to close the dropdown
    document.body.click();
    return false;
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

    // Handle different input types
    if (input.tagName === 'TEXTAREA') {
      await setInputValue(input, description);
    } else if (input.contentEditable === 'true' || input.getAttribute('contenteditable') === 'true') {
      // Handle contenteditable div (Facebook's rich text editor)
      input.focus();
      await delay(100);

      // Clear existing content
      input.innerHTML = '';

      // Try using execCommand for contenteditable
      document.execCommand('insertText', false, description);

      // If that didn't work, set directly
      if (!input.textContent) {
        input.textContent = description;
      }

      // Dispatch events
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      console.log('Trovelr: Description filled (contenteditable)');
    } else if (input.hasAttribute('data-lexical-text')) {
      // Lexical editor - find parent and use it
      const editor = input.closest('[contenteditable="true"]');
      if (editor) {
        editor.focus();
        await delay(100);
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, description);
      }
    } else {
      await setInputValue(input, description);
    }

    console.log('Trovelr: Description filled');
  }

  // Set input value in a way that React recognizes
  async function setInputValue(input, value) {
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

    input.blur();
    await delay(50);
  }

  // Delay helper
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  console.log('Trovelr content script loaded on Facebook Marketplace');
})();
