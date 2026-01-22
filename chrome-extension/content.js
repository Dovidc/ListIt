// Trovelr Chrome Extension - Content Script
// Runs on Facebook Marketplace create page to fill form fields

(function() {
  'use strict';

  // Track state for auto category selection
  let pendingCategorySelection = null; // Stores the title when waiting for image upload
  let categorySelectionDone = false;
  let imageObserver = null;
  let publishObserver = null;

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

    if (message.type === 'SELECT_FACEBOOK_CATEGORY') {
      selectCategoryFromPills(message.title)
        .then((result) => sendResponse(result))
        .catch((err) => {
          console.error('Failed to select category:', err);
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

    // Try to select category from FB's suggested categories (based on uploaded image)
    // Pass the full listing so it can use the title to pick the best category
    await fillCategory(listing);
    await delay(200);

    // Try to select condition
    await fillCondition(listing.condition);
    await delay(200);

    // Fill description last (it's a textarea that might need extra handling)
    await fillDescription(listing.description);
    await delay(100);

    // Start observing for publish button clicks
    startPublishObserver();

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

  // Fill category - set up observer to auto-select when image is uploaded
  async function fillCategory(listingData) {
    console.log('Trovelr: Setting up auto-category selection for when image is uploaded');

    // Store the title for when we detect image upload
    pendingCategorySelection = listingData.title || '';
    categorySelectionDone = false;

    // Start observing for image uploads
    startImageObserver();
  }

  // Start observing DOM for image upload
  function startImageObserver() {
    // Stop any existing observer
    if (imageObserver) {
      imageObserver.disconnect();
    }

    const checkForCategoryPills = () => {
      // Don't trigger if we've already done category selection
      if (categorySelectionDone || !pendingCategorySelection) {
        return false;
      }

      // Check if category pills now exist
      const categoryLabel = findCategoryLabel();
      if (!categoryLabel) return false;

      const categoryRect = categoryLabel.getBoundingClientRect();
      const conditionLabel = findConditionLabel();
      const conditionTop = conditionLabel ? conditionLabel.getBoundingClientRect().top : categoryRect.bottom + 200;

      const pills = findCategoryPills(categoryRect.bottom, conditionTop);

      if (pills.length > 0) {
        console.log('Trovelr: Detected', pills.length, 'category pills, waiting 1000ms then selecting...');
        categorySelectionDone = true; // Prevent multiple triggers

        // Wait 1000ms for pills to fully render, then select
        setTimeout(async () => {
          const result = await selectCategoryFromPills(pendingCategorySelection);
          console.log('Trovelr: Auto category selection result:', result);

          // Notify sidepanel of the result
          chrome.runtime.sendMessage({
            type: 'CATEGORY_AUTO_SELECTED',
            ...result
          });
        }, 1000);
        return true;
      }
      return false;
    };

    // Create a MutationObserver to watch for changes in the photo area
    imageObserver = new MutationObserver((mutations) => {
      checkForCategoryPills();
    });

    // Observe the entire form area for changes
    const formArea = document.querySelector('[role="main"]') || document.body;
    imageObserver.observe(formArea, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });

    // Also poll every 2 seconds as a fallback (Facebook might load pills slowly)
    let pollCount = 0;
    const maxPolls = 30; // Poll for up to 60 seconds
    const pollInterval = setInterval(() => {
      pollCount++;
      console.log('Trovelr: Polling for category pills (attempt', pollCount, '/', maxPolls, ')');

      if (checkForCategoryPills() || pollCount >= maxPolls) {
        clearInterval(pollInterval);
        if (pollCount >= maxPolls) {
          console.log('Trovelr: Stopped polling - category pills did not appear after 60 seconds');
        }
      }
    }, 2000);

    // Also set a timeout to stop observing after 5 minutes (in case user never adds image)
    setTimeout(() => {
      if (imageObserver) {
        console.log('Trovelr: Stopping image observer after timeout');
        imageObserver.disconnect();
        imageObserver = null;
      }
      clearInterval(pollInterval);
    }, 5 * 60 * 1000);
  }

  // Select category from FB's suggested pills (called when user clicks "Select Best Category" button)
  async function selectCategoryFromPills(title) {
    console.log('Trovelr: Looking for category pills for title:', title);

    // Find the Category dropdown/label area first
    const categoryLabel = findCategoryLabel();
    if (!categoryLabel) {
      console.log('Trovelr: Category label not found');
      return { success: false, error: 'Category section not found on page' };
    }

    // Get the bounding rect of the Category label to find pills below it
    const categoryRect = categoryLabel.getBoundingClientRect();
    console.log('Trovelr: Category label position:', categoryRect.top, categoryRect.bottom);

    // Find the Condition label to establish the lower boundary
    const conditionLabel = findConditionLabel();
    const conditionTop = conditionLabel ? conditionLabel.getBoundingClientRect().top : categoryRect.bottom + 200;
    console.log('Trovelr: Condition label top:', conditionTop);

    // Find all potential pill buttons in the area between Category and Condition labels
    const pills = findCategoryPills(categoryRect.bottom, conditionTop);
    console.log('Trovelr: Found', pills.length, 'category pills');

    if (pills.length === 0) {
      return { success: false, error: 'No category pills found. Make sure an image is uploaded first.' };
    }

    // Extract text from each pill
    const pillData = pills.map(pill => {
      const text = extractPillText(pill);
      return { element: pill, text };
    }).filter(p => p.text && p.text.length > 0 && p.text.length < 50);

    console.log('Trovelr: Pill texts:', pillData.map(p => p.text));

    if (pillData.length === 0) {
      return { success: false, error: 'Could not read category pill text' };
    }

    // Use AI to pick the best category based on the title
    const categories = pillData.map(p => p.text);
    const bestCategory = await pickBestCategory(title, categories);

    // Helper function to reliably click a pill
    const clickPill = async (pill) => {
      console.log('Trovelr: Attempting to click pill element:', pill);
      // Scroll pill into view first
      pill.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(200);

      // Try multiple click methods to ensure it works
      pill.click();
      await delay(50);
      pill.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      pill.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      pill.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await delay(300);
      console.log('Trovelr: Click completed');
    };

    if (!bestCategory) {
      // Fallback: just pick the first one
      console.log('Trovelr: AI matching failed, selecting first pill');
      await clickPill(pillData[0].element);
      return { success: true, selectedCategory: pillData[0].text };
    }

    // Find and click the matching pill
    const matchingPill = pillData.find(p => p.text === bestCategory);
    if (matchingPill) {
      console.log('Trovelr: Clicking category pill:', bestCategory);
      await clickPill(matchingPill.element);
      return { success: true, selectedCategory: bestCategory };
    }

    // Partial match fallback
    const partialMatch = pillData.find(p =>
      p.text.toLowerCase().includes(bestCategory.toLowerCase()) ||
      bestCategory.toLowerCase().includes(p.text.toLowerCase())
    );
    if (partialMatch) {
      console.log('Trovelr: Clicking partial match:', partialMatch.text);
      await clickPill(partialMatch.element);
      return { success: true, selectedCategory: partialMatch.text };
    }

    // Last resort: click first pill
    console.log('Trovelr: No match found, selecting first pill');
    await clickPill(pillData[0].element);
    return { success: true, selectedCategory: pillData[0].text };
  }

  // Find the Category label element
  function findCategoryLabel() {
    const spans = document.querySelectorAll('span');
    for (const span of spans) {
      if (span.textContent?.trim() === 'Category') {
        return span;
      }
    }
    return null;
  }

  // Find the Condition label element
  function findConditionLabel() {
    const spans = document.querySelectorAll('span');
    for (const span of spans) {
      if (span.textContent?.trim() === 'Condition') {
        return span;
      }
    }
    return null;
  }

  // Find category pill buttons in the specified vertical range
  function findCategoryPills(topBoundary, bottomBoundary) {
    const pills = [];

    // Look for clickable elements (buttons, divs with role="button") in the category area
    const candidates = document.querySelectorAll('[role="button"], button, div[tabindex="0"]');

    for (const el of candidates) {
      const rect = el.getBoundingClientRect();

      // Check if element is in the vertical range between Category and Condition
      if (rect.top > topBoundary && rect.bottom < bottomBoundary) {
        // Check if it looks like a pill (small, rounded element)
        const width = rect.width;
        const height = rect.height;

        // Pills are typically small (under 200px wide, 25-50px tall)
        if (width > 40 && width < 250 && height > 20 && height < 60) {
          // Additional check: pills should have some visual content
          const styles = window.getComputedStyle(el);
          const hasBorder = styles.border !== 'none' && styles.border !== '';
          const hasBackground = styles.backgroundColor !== 'rgba(0, 0, 0, 0)' && styles.backgroundColor !== 'transparent';
          const hasBorderRadius = parseFloat(styles.borderRadius) > 0;

          // If it has pill-like styling, add it
          if (hasBorderRadius || hasBorder || hasBackground) {
            pills.push(el);
          }
        }
      }
    }

    return pills;
  }

  // Extract text from a pill element (handles CSS ::before pseudo-elements)
  function extractPillText(element) {
    // First try direct text content
    let text = element.textContent?.trim();
    if (text && text.length > 0 && text.length < 50) {
      return text;
    }

    // Try innerText
    text = element.innerText?.trim();
    if (text && text.length > 0 && text.length < 50) {
      return text;
    }

    // Try getting text from child spans
    const spans = element.querySelectorAll('span');
    for (const span of spans) {
      text = span.textContent?.trim();
      if (text && text.length > 0 && text.length < 50) {
        return text;
      }
    }

    // Try CSS ::before pseudo-element content
    const beforeContent = window.getComputedStyle(element, '::before').content;
    if (beforeContent && beforeContent !== 'none' && beforeContent !== '""') {
      // Remove quotes from CSS content value
      text = beforeContent.replace(/^["']|["']$/g, '');
      if (text && text.length > 0 && text.length < 50) {
        return text;
      }
    }

    // Try ::after pseudo-element
    const afterContent = window.getComputedStyle(element, '::after').content;
    if (afterContent && afterContent !== 'none' && afterContent !== '""') {
      text = afterContent.replace(/^["']|["']$/g, '');
      if (text && text.length > 0 && text.length < 50) {
        return text;
      }
    }

    // Check child elements for pseudo-element content
    const children = element.querySelectorAll('*');
    for (const child of children) {
      const childBefore = window.getComputedStyle(child, '::before').content;
      if (childBefore && childBefore !== 'none' && childBefore !== '""') {
        text = childBefore.replace(/^["']|["']$/g, '');
        if (text && text.length > 0 && text.length < 50) {
          return text;
        }
      }
    }

    return '';
  }

  // Use API to pick the best category match
  async function pickBestCategory(title, categories) {
    console.log('Trovelr: Asking AI to pick best category from:', categories);

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'CATEGORY_MATCH',
        title: title,
        suggestedCategories: categories
      }, (response) => {
        if (response && response.success && response.category) {
          console.log('Trovelr: AI selected category:', response.category);
          resolve(response.category);
        } else {
          console.log('Trovelr: AI category match failed:', response?.error);
          resolve(null);
        }
      });
    });
  }

  // Fill condition dropdown
  async function fillCondition(condition) {
    // Default to "Used - Fair"
    let fbCondition = 'Used - Fair';

    if (condition) {
      const lowerCond = condition.toLowerCase();
      if (lowerCond === 'new') {
        fbCondition = 'New';
      } else if (lowerCond.includes('like new')) {
        fbCondition = 'Used - Like New';
      } else if (lowerCond.includes('good')) {
        fbCondition = 'Used - Good';
      } else if (lowerCond.includes('fair')) {
        fbCondition = 'Used - Fair';
      }
    }

    console.log('Trovelr: Setting condition to:', fbCondition);

    // Find and click the Condition dropdown
    const clicked = await findAndClickDropdown('Condition');
    if (clicked) {
      await delay(500);
      await selectDropdownOption(fbCondition);
    } else {
      console.warn('Trovelr: Condition dropdown not found');
    }
  }

  // Find and click a dropdown by label text
  async function findAndClickDropdown(labelText) {
    console.log('Trovelr: Looking for dropdown:', labelText);

    // Strategy 0: Look for label element directly (Facebook's new structure)
    const labels = document.querySelectorAll('label');
    for (const label of labels) {
      const labelSpan = label.querySelector('span');
      if (labelSpan && labelSpan.textContent?.trim() === labelText) {
        console.log('Trovelr: Found label element for:', labelText);
        // Click the label itself - Facebook often makes the whole label clickable
        label.click();
        await delay(100);
        // Also try clicking any input/div inside
        const inner = label.querySelector('div[tabindex], input, [role="combobox"], [role="button"]');
        if (inner) {
          console.log('Trovelr: Clicking inner element');
          inner.click();
        }
        return true;
      }
    }

    // Strategy 1: Find label span and click its parent container
    const allSpans = document.querySelectorAll('span');
    for (const span of allSpans) {
      if (span.textContent?.trim() === labelText) {
        console.log('Trovelr: Found span with text:', labelText);
        // Found label, traverse up to find clickable container
        let parent = span.parentElement;
        for (let i = 0; i < 6 && parent; i++) {
          // Look for clickable attributes
          if (parent.getAttribute('role') === 'combobox' ||
              parent.getAttribute('role') === 'button' ||
              parent.getAttribute('aria-haspopup') ||
              parent.getAttribute('tabindex') === '0') {
            console.log('Trovelr: Clicking dropdown container');
            parent.click();
            return true;
          }
          // Check if any child is the clickable part
          const clickable = parent.querySelector('[role="combobox"], [role="button"], [aria-haspopup]');
          if (clickable) {
            console.log('Trovelr: Clicking dropdown child');
            clickable.click();
            return true;
          }
          parent = parent.parentElement;
        }

        // Fallback: click the span's grandparent (often the clickable area)
        const grandparent = span.parentElement?.parentElement;
        if (grandparent) {
          console.log('Trovelr: Clicking grandparent');
          grandparent.click();
          return true;
        }

        // Fallback: just click the closest div container
        const container = span.closest('label, div[class]');
        if (container) {
          console.log('Trovelr: Clicking label container');
          container.click();
          return true;
        }
      }
    }

    // Strategy 2: Find by aria-label
    const ariaElements = document.querySelectorAll(`[aria-label*="${labelText}"]`);
    for (const el of ariaElements) {
      console.log('Trovelr: Clicking aria-label element');
      el.click();
      return true;
    }

    // Strategy 3: Look for label element (fallback)
    const allLabels = document.querySelectorAll('label');
    for (const lbl of allLabels) {
      if (lbl.textContent?.includes(labelText)) {
        const input = lbl.querySelector('input, [role="combobox"], [role="button"]');
        if (input) {
          console.log('Trovelr: Clicking input in label');
          input.click();
          return true;
        }
        console.log('Trovelr: Clicking label directly');
        lbl.click();
        return true;
      }
    }

    return false;
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
    // Wait longer for dropdown to render
    await delay(500);

    console.log('Trovelr: Looking for option:', optionText);

    // Log what options we can see for debugging
    const visibleOptions = document.querySelectorAll('[role="option"], [role="menuitem"], [role="listitem"]');
    console.log('Trovelr: Found', visibleOptions.length, 'options in dropdown');
    if (visibleOptions.length > 0 && visibleOptions.length < 30) {
      const optionTexts = Array.from(visibleOptions).map(o => o.textContent?.trim()).filter(Boolean);
      console.log('Trovelr: Available options:', optionTexts.slice(0, 10));
    }

    // Find all potential options - be very broad
    const allClickables = document.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], [role="listitem"], [data-visualcompletion="ignore-dynamic"]');

    // First pass - exact match
    for (const el of allClickables) {
      const text = el.textContent?.trim() || '';
      if (text === optionText) {
        console.log('Trovelr: Found exact match, clicking:', text);
        el.click();
        await delay(200);
        return true;
      }
    }

    // Second pass - partial match (option contains our text or vice versa)
    for (const el of allClickables) {
      const text = el.textContent?.trim() || '';
      if (text && (text.includes(optionText) || optionText.includes(text))) {
        console.log('Trovelr: Found partial match, clicking:', text);
        el.click();
        await delay(200);
        return true;
      }
    }

    // Third pass - word-level match in visible list items
    const searchWords = optionText.toLowerCase().split(/\s+/).filter(w => w.length > 3);

    // Look for visible category items in the dropdown list
    const categoryItems = document.querySelectorAll('div[role="button"], div[tabindex="0"], span[dir="auto"]');
    for (const el of categoryItems) {
      const text = (el.textContent?.trim() || '').toLowerCase();
      if (text.length > 50) continue; // Skip long text blocks

      for (const word of searchWords) {
        if (text.includes(word)) {
          console.log('Trovelr: Found category with word "' + word + '":', el.textContent?.trim());

          // Find the clickable row (parent div with role or the element itself)
          let clickTarget = el;
          let parent = el;
          for (let i = 0; i < 5 && parent; i++) {
            if (parent.getAttribute('role') === 'button' ||
                parent.getAttribute('role') === 'option' ||
                parent.getAttribute('role') === 'menuitem' ||
                parent.classList?.contains('x1i10hfl')) {
              clickTarget = parent;
              break;
            }
            parent = parent.parentElement;
          }

          console.log('Trovelr: Clicking target element');
          clickTarget.click();
          await delay(400);

          // Press Escape to close any remaining dropdown
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
          await delay(100);
          return true;
        }
      }
    }

    console.warn('Trovelr: Option not found:', optionText, '- closing dropdown');
    // Close the dropdown
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    await delay(100);
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

  // Start observing for publish button clicks
  function startPublishObserver() {
    // Stop any existing observer
    if (publishObserver) {
      publishObserver.disconnect();
    }

    console.log('Trovelr: Starting publish button observer');

    // Find all buttons and set up click listeners
    const checkForPublishButton = () => {
      // Facebook's publish button typically has text "Publish", "Next", or similar
      const buttons = document.querySelectorAll('[role="button"], button');

      buttons.forEach(button => {
        const text = button.textContent?.trim().toLowerCase();

        // Look for "Publish" button - check if we're on the final preview/publish step
        // We can detect this by checking if the URL contains certain patterns or if specific elements exist
        const isPublishButton = text === 'publish' || text === 'list';

        if (isPublishButton) {
          // Check if we already added a listener
          if (!button.dataset.trovelrListenerAdded) {
            button.dataset.trovelrListenerAdded = 'true';

            button.addEventListener('click', () => {
              // Check if this is really the final publish (not earlier in flow)
              // Look for preview elements or check URL
              const isPreviewPage = document.querySelector('[aria-label="Preview"]') ||
                                    document.body.textContent.includes('Preview');

              if (isPreviewPage || text === 'publish') {
                // Wait a bit for the publish action to process, then notify
                setTimeout(() => {
                  chrome.runtime.sendMessage({ type: 'PUBLISH_CLICKED' });
                }, 1500);
              }
            }, { capture: true });
          }
        }
      });
    };

    // Check immediately
    checkForPublishButton();

    // Create a MutationObserver to watch for new buttons being added
    publishObserver = new MutationObserver(() => {
      checkForPublishButton();
    });

    // Observe the entire document for changes
    publishObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Stop observing after 30 minutes
    setTimeout(() => {
      if (publishObserver) {
        console.log('Trovelr: Stopping publish observer after timeout');
        publishObserver.disconnect();
        publishObserver = null;
      }
    }, 30 * 60 * 1000);
  }

  // Monitor for URL changes (Facebook uses client-side routing)
  let lastUrl = location.href;
  let wasOnCreatePage = location.href.includes('/marketplace/create');

  new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      const isOnCreatePage = currentUrl.includes('/marketplace/create');

      // Detect when we LEAVE the create page (likely published successfully)
      if (wasOnCreatePage && !isOnCreatePage) {
        // We just left the create page - likely published!
        chrome.runtime.sendMessage({ type: 'PUBLISH_CLICKED' });
      }

      // If we're back on the create page, reset the observers
      if (isOnCreatePage) {
        // Reset state
        categorySelectionDone = false;
        pendingCategorySelection = null;

        // Stop old observers
        if (imageObserver) {
          imageObserver.disconnect();
          imageObserver = null;
        }
        if (publishObserver) {
          publishObserver.disconnect();
          publishObserver = null;
        }
      }

      wasOnCreatePage = isOnCreatePage;
      lastUrl = currentUrl;
    }
  }).observe(document, { subtree: true, childList: true });

  console.log('Trovelr content script loaded on Facebook Marketplace');
})();
