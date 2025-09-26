import {
  createElement,
  useCallback,
  useState
} from '../shared/runtime.mjs';
import { useUploads } from './UploadsContext.mjs';
import { useServices } from '../api/services.mjs';

function parsePrice(input) {
  if (!input) return 0;
  const normalized = Number(String(input).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(normalized) ? Math.max(0, normalized) : 0;
}

export function NewListingForm() {
  const { createListing, isSubmitting } = useUploads();
  const { formatCurrency } = useServices();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [price, setPrice] = useState('');
  const [uploadTokens, setUploadTokens] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = useCallback(async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    const payload = {
      title: title.trim(),
      description: description.trim(),
      location: location.trim(),
      price: parsePrice(price)
    };
    const tokens = uploadTokens.split(/[,\n]/).map((token) => token.trim()).filter(Boolean);
    if (!tokens.length) {
      setError('At least one upload token is required.');
      return;
    }
    try {
      const listing = await createListing({ payload, uploadTokens: tokens });
      setSuccess(`Created “${listing?.title || payload.title || 'listing'}” for ${formatCurrency(payload.price)}.`);
      setTitle('');
      setDescription('');
      setLocation('');
      setPrice('');
      setUploadTokens('');
    } catch (err) {
      setError(err?.message || 'Unable to create listing.');
    }
  }, [createListing, description, formatCurrency, location, price, title, uploadTokens]);

  return createElement('section', { className: 'new-listing' },
    createElement('h2', null, 'Create a listing'),
    createElement('p', { className: 'muted' }, 'Paste one or more upload tokens generated from the uploader to publish a new listing.'),
    createElement('form', { className: 'new-listing-form', onSubmit: handleSubmit },
      createElement('label', null,
        'Title',
        createElement('input', {
          name: 'listing-title',
          placeholder: 'What are you selling?',
          value: title,
          onInput: (event) => setTitle(event.target.value)
        })
      ),
      createElement('label', null,
        'Description',
        createElement('textarea', {
          name: 'listing-description',
          rows: 3,
          placeholder: 'Include key details, condition, and extras.',
          value: description,
          onInput: (event) => setDescription(event.target.value)
        })
      ),
      createElement('label', null,
        'Location',
        createElement('input', {
          name: 'listing-location',
          placeholder: 'City, ST',
          value: location,
          onInput: (event) => setLocation(event.target.value)
        })
      ),
      createElement('label', null,
        'Price',
        createElement('input', {
          name: 'listing-price',
          placeholder: '$0.00',
          value: price,
          onInput: (event) => setPrice(event.target.value)
        })
      ),
      createElement('label', null,
        'Upload tokens',
        createElement('textarea', {
          name: 'upload-tokens',
          rows: 2,
          placeholder: 'token-1, token-2',
          value: uploadTokens,
          onInput: (event) => setUploadTokens(event.target.value)
        })
      ),
      error && createElement('div', { className: 'form-error' }, error),
      success && createElement('div', { className: 'form-success' }, success),
      createElement('button', {
        type: 'submit',
        className: 'btn primary',
        disabled: isSubmitting
      }, isSubmitting ? 'Publishing…' : 'Publish listing')
    )
  );
}
