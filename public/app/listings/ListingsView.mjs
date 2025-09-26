import {
  Fragment,
  createElement,
  useMemo,
  useState
} from '../shared/runtime.mjs';
import { useListings } from './ListingsContext.mjs';

function useFilterState(filters) {
  const [query, setQuery] = useState(filters.query || '');
  const [location, setLocation] = useState(filters.location || '');
  const [sort, setSort] = useState(filters.sort || 'new');
  return {
    query,
    location,
    sort,
    setQuery,
    setLocation,
    setSort
  };
}

export function ListingsView() {
  const { filters, setFilters, listings, status, hasNext, loadNext } = useListings();
  const state = useFilterState(filters);

  const handleSubmit = (event) => {
    event.preventDefault();
    setFilters({
      query: state.query,
      location: state.location,
      sort: state.sort
    });
  };

  const loading = status === 'loading' || status === 'idle';
  const loadingMore = status === 'loading-more';

  const content = useMemo(() => {
    if (loading) {
      return createElement('div', { className: 'listings-empty' }, 'Loading listings…');
    }
    if (!listings.length) {
      return createElement('div', { className: 'listings-empty' }, 'No listings found. Try adjusting your search.');
    }
    return createElement('div', { className: 'listings-grid' },
      listings.map((item) => createElement('article', { key: item.id, className: 'listing-card' },
        item.cover && createElement('div', { className: 'listing-cover' },
          createElement('img', { src: item.cover, alt: item.title || 'Listing image' })
        ),
        createElement('div', { className: 'listing-body' },
          createElement('h3', { className: 'listing-title' }, item.title || 'Untitled listing'),
          createElement('div', { className: 'listing-price' }, item.price_label),
          item.distance_label && createElement('div', { className: 'listing-distance' }, item.distance_label),
          item.description && createElement('p', { className: 'listing-description' }, item.description)
        )
      ))
    );
  }, [loading, listings]);

  return createElement(Fragment, null,
    createElement('section', { className: 'listings-panel' },
      createElement('header', { className: 'listings-toolbar' },
        createElement('h2', null, 'Listings'),
        createElement('form', { className: 'listings-filters', onSubmit: handleSubmit },
          createElement('input', {
            name: 'query',
            placeholder: 'Search listings…',
            value: state.query,
            onInput: (event) => state.setQuery(event.target.value)
          }),
          createElement('input', {
            name: 'location',
            placeholder: 'City or ZIP',
            value: state.location,
            onInput: (event) => state.setLocation(event.target.value)
          }),
          createElement('select', {
            name: 'sort',
            value: state.sort,
            onChange: (event) => state.setSort(event.target.value)
          },
            createElement('option', { value: 'new' }, 'Newest'),
            createElement('option', { value: 'price_asc' }, 'Price: Low to High'),
            createElement('option', { value: 'price_desc' }, 'Price: High to Low')
          ),
          createElement('button', { type: 'submit', className: 'btn' }, 'Apply')
        )
      ),
      content,
      hasNext && createElement('div', { className: 'listings-footer' },
        createElement('button', {
          type: 'button',
          className: 'btn',
          onClick: () => loadNext(),
          disabled: loadingMore
        }, loadingMore ? 'Loading…' : 'Load more')
      )
    )
  );
}
