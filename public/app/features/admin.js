(() => {
  function createAdminFeature({ React, ReactDOM, api, components = {} } = {}) {
    if (!React || typeof React.createElement !== 'function') {
      throw new Error('Admin feature requires React.');
    }
    if (!ReactDOM || typeof ReactDOM.createPortal !== 'function') {
      throw new Error('Admin feature requires ReactDOM.');
    }
    if (!api) {
      throw new Error('Admin feature requires an API client.');
    }

    const {
      useState,
      useEffect,
      useMemo,
      useCallback,
      useRef
    } = React;

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    const { AdTile } = components;
    if (typeof AdTile !== 'function') {
      throw new Error('Admin feature requires AdTile component.');
    }

    function FlaggedDetailsModal({ open, detail, item, onClose }) {
      const isImage = (detail?.type || '').toLowerCase() === 'image';
      const target = typeof detail?.target === 'string' ? detail.target : '';
      const categories = useMemo(() => {
        if (!detail || !Array.isArray(detail.categories)) return [];
        return detail.categories.filter(Boolean);
      }, [detail]);
      const scores = detail && detail.category_scores && typeof detail.category_scores === 'object'
        ? detail.category_scores
        : null;

      useEffect(() => {
        if (!open) return;
        const onKey = (ev) => { if (ev.key === 'Escape') onClose?.(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [open, onClose]);

      if (!open || !detail) return null;

      const typeLabel = detail?.type ? detail.type.charAt(0).toUpperCase() + detail.type.slice(1) : 'Content';
      let flaggedAt = '';
      if (item?.flagged_at) {
        const dt = new Date(item.flagged_at);
        flaggedAt = Number.isFinite(dt.getTime()) ? dt.toLocaleString() : item.flagged_at;
      }

      const handleOuterClick = (event) => {
        if (event.target.classList?.contains('modal')) onClose?.();
      };

      const scoreEntries = scores ? Object.entries(scores).filter(([key, value]) => key && value != null) : [];

      return ReactDOM.createPortal(
        H('div', {
          className: 'modal open',
          onClick: handleOuterClick
        },
          H('div', {
            className: 'modal-inner',
            style: {
              maxWidth: isImage ? '720px' : '520px',
              width: '90%',
              padding: '24px',
              background: '#fff',
              color: '#111',
              display: 'grid',
              gap: 16
            }
          },
            H('button', { className: 'close', onClick: onClose }, '×'),
            H('div', { style: { display: 'grid', gap: 4 } },
              H('h3', { style: { margin: 0, fontSize: 20, fontWeight: 700 } }, 'Flagged content'),
              item?.username && H('div', { className: 'muted', style: { fontSize: 13 } }, `User: ${item.username}`),
              item?.listing_title && H('div', { className: 'muted', style: { fontSize: 13 } }, `Listing: ${item.listing_title}`),
              flaggedAt && H('div', { className: 'muted', style: { fontSize: 12 } }, `Flagged: ${flaggedAt}`),
              H('div', { className: 'muted', style: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 } }, typeLabel)
            ),
            categories.length ? H('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
              categories.map((category) => H('span', {
                key: category,
                style: {
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: '#fee2e2',
                  color: '#b91c1c',
                  fontSize: 12,
                  fontWeight: 600
                }
              }, category))
            ) : null,
            isImage
              ? (target
                ? H('div', {
                    style: {
                      display: 'grid',
                      gap: 8
                    }
                  },
                    H('img', {
                      src: target,
                      alt: 'Flagged content preview',
                      style: {
                        maxWidth: '100%',
                        borderRadius: 12,
                        border: '1px solid #e5e7eb',
                        background: '#f8fafc'
                      }
                    }),
                    H('div', { className: 'muted', style: { fontSize: 12 } }, 'Right-click or long-press to save this image if needed.')
                  )
                : H('div', { className: 'muted', style: { fontSize: 13 } }, 'No image preview available.'))
              : H('div', {
                  style: {
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                    fontSize: 14,
                    lineHeight: 1.5,
                    padding: 12,
                    borderRadius: 12,
                    border: '1px solid #e5e7eb',
                    background: '#f8fafc'
                  }
                }, target ? target : 'No text was captured for this entry.'),
            scoreEntries.length ? H('div', { style: { display: 'grid', gap: 6 } },
              H('div', { style: { fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: '#111' } }, 'Confidence scores'),
              H('div', { style: { display: 'grid', gap: 4 } },
                scoreEntries.map(([category, value]) => {
                  const numeric = Number(value);
                  if (!Number.isFinite(numeric)) return null;
                  return H('div', { key: category, className: 'muted', style: { fontSize: 12 } }, `${category}: ${(numeric * 100).toFixed(1)}%`);
                }).filter(Boolean)
              )
            ) : null
          )
        ),
        document.body
      );
    }

    function createEmptyAdForm() {
      return {
        title: '',
        subtitle: '',
        target_url: '',
        image_url: '',
        cta_label: '',
        background: '',
        position: 0,
        is_active: true
      };
    }

    function AdminDashboard({ onViewSeller, onMessageUser, onAdsUpdated }) {
      const [tab, setTab] = useState('users');
      const [searchTerm, setSearchTerm] = useState('');
      const [searchResults, setSearchResults] = useState([]);
      const [searchLoading, setSearchLoading] = useState(false);
      const [searchError, setSearchError] = useState('');
      const [selectedUserId, setSelectedUserId] = useState(null);
      const [selectedUser, setSelectedUser] = useState(null);
      const [userLoading, setUserLoading] = useState(false);
      const [userError, setUserError] = useState('');
      const [userReports, setUserReports] = useState([]);
      const [reportsLoading, setReportsLoading] = useState(false);
      const [reportsError, setReportsError] = useState('');
      const [topReports, setTopReports] = useState([]);
      const [clearingUserId, setClearingUserId] = useState(null);
      const [topLoading, setTopLoading] = useState(false);
      const [topError, setTopError] = useState('');
      const [topDays, setTopDays] = useState(7);
      const [topMin, setTopMin] = useState(1);

      const [flaggedList, setFlaggedList] = useState([]);
      const [flaggedLoading, setFlaggedLoading] = useState(false);
      const [flaggedError, setFlaggedError] = useState('');
      const [dismissingFlaggedId, setDismissingFlaggedId] = useState(null);
      const [flaggedDetailModal, setFlaggedDetailModal] = useState(null);

      const [adsList, setAdsList] = useState([]);
      const [adsLoading, setAdsLoading] = useState(false);
      const [adsError, setAdsError] = useState('');
      const [adSaving, setAdSaving] = useState(false);
      const [editingAdId, setEditingAdId] = useState(null);
      const [adForm, setAdForm] = useState(() => createEmptyAdForm());
      const [seedBusy, setSeedBusy] = useState(false);
      const [seedDeleteBusy, setSeedDeleteBusy] = useState(false);
      const [seedMessage, setSeedMessage] = useState('');
      const [seedError, setSeedError] = useState('');
      const [seedCount, setSeedCount] = useState('');

      const searchTimer = useRef(null);

      useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);
      useEffect(() => { loadTopReports(topDays, topMin); }, [topDays, topMin]);

      useEffect(() => {
        if (searchTimer.current) clearTimeout(searchTimer.current);
        const term = searchTerm.trim();
        if (!term) {
          setSearchResults([]);
          setSearchError('');
          return;
        }
        searchTimer.current = setTimeout(() => { fetchSearch(term); }, 300);
      }, [searchTerm]);

      const loadFlagged = useCallback(async () => {
        setFlaggedLoading(true);
        setFlaggedError('');
        try {
          const rows = await api.adminListFlagged({ silent: true });
          setFlaggedList(Array.isArray(rows) ? rows : []);
        } catch (err) {
          setFlaggedError(err?.message || 'Failed to load flagged uploads');
          setFlaggedList([]);
        } finally {
          setFlaggedLoading(false);
        }
      }, []);

      const openFlaggedDetail = useCallback((item, detail) => {
        if (!detail || typeof detail !== 'object') return;
        setFlaggedDetailModal({ item, detail });
      }, []);

      const closeFlaggedDetail = useCallback(() => {
        setFlaggedDetailModal(null);
      }, []);

      const loadAds = useCallback(async () => {
        setAdsLoading(true);
        setAdsError('');
        try {
          const rows = await api.adminListAds({ silent: true });
          setAdsList(Array.isArray(rows) ? rows : []);
        } catch (err) {
          setAdsError(err?.message || 'Failed to load ads');
          setAdsList([]);
        } finally {
          setAdsLoading(false);
        }
      }, []);

      useEffect(() => {
        if (tab === 'ads') {
          loadAds();
        }
      }, [tab, loadAds]);

      useEffect(() => {
        if (tab === 'flagged') {
          loadFlagged();
        }
      }, [tab, loadFlagged]);

      async function handleSeedListings() {
        if (seedBusy || seedDeleteBusy) return;
        setSeedError('');
        setSeedMessage('');
        const trimmed = typeof seedCount === 'string' ? seedCount.trim() : '';
        let desiredCount = null;
        if (trimmed) {
          const parsed = Number.parseInt(trimmed, 10);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            setSeedError('Enter a valid number of images to seed (minimum 1).');
            return;
          }
          desiredCount = parsed;
        }
        setSeedBusy(true);
        try {
          const result = await api.adminSeedListings(desiredCount ? { count: desiredCount } : undefined);
          const count = Number(result?.created || 0);
          setSeedMessage(count
            ? `Created ${count} test listing${count === 1 ? '' : 's'}.`
            : 'No listings were created.');
        } catch (err) {
          setSeedError(err?.message || 'Failed to seed test listings.');
        } finally {
          setSeedBusy(false);
        }
      }

      async function handleDeleteSeedListings() {
        if (seedBusy || seedDeleteBusy) return;
        setSeedError('');
        setSeedMessage('');
        setSeedDeleteBusy(true);
        try {
          const result = await api.adminDeleteSeedListings();
          const count = Number(result?.deleted || 0);
          setSeedMessage(count
            ? `Deleted ${count} test listing${count === 1 ? '' : 's'}.`
            : 'No test listings to delete.');
        } catch (err) {
          setSeedError(err?.message || 'Failed to delete test listings.');
        } finally {
          setSeedDeleteBusy(false);
        }
      }

      const seedActionsDisabled = seedBusy || seedDeleteBusy;

      function formatDate(value) {
        if (!value) return '--';
        const dt = new Date(value);
        return Number.isFinite(dt.getTime()) ? dt.toLocaleDateString() : value;
      }

      function formatDateTime(value) {
        if (!value) return '--';
        const dt = new Date(value);
        return Number.isFinite(dt.getTime()) ? dt.toLocaleString() : value;
      }

      function statusBadge(status) {
        const color = status === 'banned' ? '#fee2e2' : status === 'locked' ? '#fef3c7' : '#d1fae5';
        const textColor = status === 'banned' ? '#b91c1c' : status === 'locked' ? '#92400e' : '#047857';
        return H('span', {
          style: {
            padding: '3px 10px',
            borderRadius: 999,
            background: color,
            color: textColor,
            fontSize: 12,
            fontWeight: 600,
            textTransform: 'uppercase'
          }
        }, status || 'active');
      }

      async function fetchSearch(term) {
        setSearchLoading(true);
        setSearchError('');
        try {
          const results = await api.adminSearchUsers({ q: term, limit: 25 });
          setSearchResults(Array.isArray(results) ? results : []);
        } catch (err) {
          setSearchError(err.message || 'Search failed');
          setSearchResults([]);
        } finally {
          setSearchLoading(false);
        }
      }

      async function loadUser(userId) {
        setSelectedUserId(userId);
        setUserLoading(true);
        setUserError('');
        try {
          const data = await api.adminGetUser(userId);
          setSelectedUser(data || null);
          await loadUserReports(userId);
        } catch (err) {
          setUserError(err.message || 'Failed to load user');
          setSelectedUser(null);
          setUserReports([]);
        } finally {
          setUserLoading(false);
        }
      }

      async function loadUserReports(userId, limit = 50) {
        setReportsLoading(true);
        setReportsError('');
        try {
          const items = await api.adminGetUserReports(userId, { limit });
          setUserReports(Array.isArray(items) ? items : []);
        } catch (err) {
          setReportsError(err.message || 'Failed to load reports');
          setUserReports([]);
        } finally {
          setReportsLoading(false);
        }
      }

      async function loadTopReports(daysValue = topDays, minValue = topMin) {
        setTopLoading(true);
        setTopError('');
        try {
          const payload = await api.adminTopReports({ limit: 20, days: daysValue, min: minValue });
          const items = Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload) ? payload : []);
          setTopReports(items);
        } catch (err) {
          setTopError(err.message || 'Failed to load report summary');
          setTopReports([]);
        } finally {
          setTopLoading(false);
        }
      }

      async function handleStatusChange(status) {
        if (!selectedUser) return;
        if (status === selectedUser.account_status) return;
        const confirmMsg = status === 'active' ? 'Restore account access?' : status === 'locked' ? 'Lock this account?' : 'Ban this account?';
        if (!window.confirm(confirmMsg)) return;
        let note = '';
        if (status !== 'active') {
          note = window.prompt('Add an optional note for this action:', selectedUser.status_note || '') || '';
        } else if (selectedUser.status_note) {
          note = window.prompt('Update note (leave blank to clear):', selectedUser.status_note || '') || '';
        }
        try {
          await api.adminUpdateUserStatus(selectedUser.id, { status, note: note.trim() });
          await loadUser(selectedUser.id);
          await loadTopReports(topDays, topMin);
          if (searchTerm.trim()) await fetchSearch(searchTerm.trim());
        } catch (err) {
          alert(err.message || 'Failed to update status');
        }
      }

      function handleViewUserFromTop(userId) {
        setTab('users');
        loadUser(userId);
      }

      async function handleClearReportsForUser(user) {
        if (!user || !Number.isFinite(Number(user.user_id))) return;
        const name = user.username || 'this user';
        if (!window.confirm(`Clear reports for ${name}?`)) return;
        const noteInput = window.prompt('Optional note for this action:', '') || '';
        try {
          setClearingUserId(Number(user.user_id));
          const payload = noteInput.trim() ? { note: noteInput.trim() } : {};
          await api.adminClearUserReports(Number(user.user_id), payload);
          if (selectedUser?.id === Number(user.user_id)) {
            await loadUser(Number(user.user_id));
          }
          await loadTopReports(topDays, topMin);
          if (searchTerm.trim()) await fetchSearch(searchTerm.trim());
        } catch (err) {
          alert(err.message || 'Failed to clear reports');
        } finally {
          setClearingUserId(null);
        }
      }

      function buildAdPayload(source) {
        const payload = {
          title: String(source.title || '').trim(),
          subtitle: String(source.subtitle || '').trim(),
          target_url: String(source.target_url || '').trim(),
          image_url: String(source.image_url || '').trim(),
          cta_label: String(source.cta_label || '').trim(),
          background: String(source.background || '').trim(),
          position: Number.isFinite(Number(source.position)) ? Math.round(Number(source.position)) : 0,
          is_active: source.is_active ? 1 : 0
        };
        if (payload.position > 9999) payload.position = 9999;
        if (payload.position < -9999) payload.position = -9999;
        return payload;
      }

      function resetAdForm() {
        setEditingAdId(null);
        setAdForm(createEmptyAdForm());
        setAdsError('');
      }

      function handleEditAd(ad) {
        if (!ad) return;
        setAdsError('');
        setEditingAdId(ad.id);
        setAdForm({
          title: ad.title || '',
          subtitle: ad.subtitle || '',
          target_url: ad.target_url || '',
          image_url: ad.image_url || '',
          cta_label: ad.cta_label || '',
          background: ad.background || '',
          position: Number.isFinite(Number(ad.position)) ? Number(ad.position) : 0,
          is_active: !!ad.is_active
        });
      }

      async function handleAdSubmit(e) {
        e.preventDefault();
        setAdSaving(true);
        setAdsError('');
        try {
          const payload = buildAdPayload(adForm);
          if (!payload.title || !payload.target_url) {
            setAdsError('Title and target URL are required.');
            setAdSaving(false);
            return;
          }
          if (editingAdId) {
            await api.adminUpdateAd(editingAdId, payload);
          } else {
            await api.adminCreateAd(payload);
          }
          await loadAds();
          resetAdForm();
          onAdsUpdated?.();
        } catch (err) {
          setAdsError(err?.message || 'Failed to save ad');
        } finally {
          setAdSaving(false);
        }
      }

      async function handleDeleteAd(id) {
        if (!Number.isFinite(Number(id))) return;
        if (!window.confirm('Delete this ad?')) return;
        try {
          await api.adminDeleteAd(id);
          if (editingAdId === id) resetAdForm();
          await loadAds();
          onAdsUpdated?.();
        } catch (err) {
          alert(err?.message || 'Failed to delete ad');
        }
      }

      async function handleToggleAdActive(ad) {
        if (!ad) return;
        try {
          const payload = buildAdPayload({ ...ad, is_active: ad.is_active ? 0 : 1 });
          await api.adminUpdateAd(ad.id, payload);
          await loadAds();
          onAdsUpdated?.();
        } catch (err) {
          alert(err?.message || 'Failed to update ad');
        }
      }

      const lockToggleLabel = selectedUser?.account_status === 'locked' ? 'Unlock account' : 'Lock account';
      const lockToggleTarget = selectedUser?.account_status === 'locked' ? 'active' : 'locked';
      const showRestore = selectedUser?.account_status === 'banned';

      const userSummary = selectedUser ? H('div', { style: { display: 'grid', gap: 8 } },
        H('div', { style: { display: 'flex', gap: 12, alignItems: 'center' } },
          H('div', { style: { fontSize: 20, fontWeight: 700 } }, selectedUser.username || '(no username)'),
          statusBadge(selectedUser.account_status || 'active')
        ),
        H('div', { className: 'muted' }, selectedUser.email || 'No email on file'),
        H('div', { className: 'muted', style: { fontSize: 13 } }, `Joined: ${formatDate(selectedUser.created_at)}`),
        H('div', { className: 'muted', style: { fontSize: 13 } }, `Last login: ${formatDateTime(selectedUser.last_login_at)}`),
        H('div', { className: 'muted', style: { fontSize: 13 } }, `Listings: ${Number(selectedUser.listing_count || 0)} | Reports: ${Number(selectedUser.report_count || 0)} | Open reports: ${Number(selectedUser.open_report_count || 0)}`),
        selectedUser.status_note && H('div', { style: { fontSize: 13, background: '#fef3c7', padding: 8, borderRadius: 8, color: '#92400e' } }, `Note: ${selectedUser.status_note}`),
        H('div', { className: 'row', style: { gap: 8, marginTop: 8, flexWrap: 'wrap' } },
          onViewSeller && H('button', { className: 'btn', onClick: handleViewProfile }, 'View profile'),
          onMessageUser && H('button', { className: 'btn', onClick: handleMessageUser }, 'Message user'),
          H('button', { className: 'btn', onClick: () => handleStatusChange(lockToggleTarget) }, lockToggleLabel),
          H('button', { className: 'btn danger', onClick: () => handleStatusChange('banned') }, 'Ban account'),
          showRestore && H('button', { className: 'btn', onClick: () => handleStatusChange('active') }, 'Restore account'),
          H('button', { className: 'btn', onClick: () => loadUser(selectedUser.id) }, 'Refresh')
        )
      ) : H('div', { className: 'muted' }, userError || 'Select a user to view details.');

      function handleViewProfile() {
        if (!selectedUser || !onViewSeller) return;
        const label = selectedUser.username || selectedUser.email || `User #${selectedUser.id}`;
        onViewSeller(selectedUser.id, label);
      }

      async function handleMessageUser() {
        if (!selectedUser || !onMessageUser) return;
        try {
          await onMessageUser(selectedUser.id);
        } catch (err) {
          alert(err?.message || 'Failed to open conversation.');
        }
      }

      async function handleMessageFlagged(userId) {
        if (!onMessageUser) return;
        const targetId = Number(userId);
        if (!Number.isFinite(targetId)) return;
        try {
          await onMessageUser(targetId);
        } catch (err) {
          alert(err?.message || 'Failed to open conversation.');
        }
      }

      async function handleDismissFlagged(id) {
        const numericId = Number(id);
        if (!Number.isFinite(numericId)) return;
        if (dismissingFlaggedId === numericId) return;
        try {
          setDismissingFlaggedId(numericId);
          await api.adminDeleteFlagged(numericId);
          setFlaggedList(list => list.filter(item => Number(item.id) !== numericId));
        } catch (err) {
          alert(err?.message || 'Failed to dismiss flagged attempt.');
        } finally {
          setDismissingFlaggedId(null);
        }
      }

      const reportsList = userReports.length
        ? H('div', { style: { display: 'grid', gap: 8, maxHeight: 260, overflowY: 'auto', marginTop: 12 } },
            userReports.map(r => H('div', {
              key: r.id,
              className: 'card',
              style: { padding: 12, border: '1px solid #e5e7eb' }
            },
              H('div', { style: { fontSize: 13, fontWeight: 600 } }, `Report #${r.id}`),
              H('div', { className: 'muted', style: { fontSize: 12 } }, `Filed: ${formatDateTime(r.created_at)}`),
              H('div', { className: 'muted', style: { fontSize: 12 } }, `Reporter: ${r.reporter?.username || 'anonymous'} (${r.reporter?.email || 'no email'})`),
              Array.isArray(r.reasons) && r.reasons.length
                ? H('div', { style: { fontSize: 12, marginTop: 4 } }, `Reasons: ${r.reasons.join(', ')}`)
                : null,
              r.details && H('div', { style: { fontSize: 12, marginTop: 4 } }, r.details)
            ))
          )
        : H('div', { className: 'muted', style: { marginTop: 12 } }, reportsError || (reportsLoading ? 'Loading reports...' : 'No reports for this user.'));

      const topList = topReports.length
        ? H('div', { style: { display: 'grid', gap: 8, marginTop: 12 } },
            topReports.map(item => H('div', {
              key: item.user_id,
              className: 'card',
              style: { padding: 12, border: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }
            },
              H('div', { style: { display: 'grid', gap: 4 } },
                H('div', { style: { fontWeight: 600 } }, item.username || '(no username)'),
                H('div', { className: 'muted', style: { fontSize: 12 } }, item.email || 'No email'),
                H('div', { className: 'muted', style: { fontSize: 12 } }, `Reports: ${Number(item.total_reports || 0)} | Open: ${Number(item.open_reports || 0)} | Recent: ${Number(item.recent_reports || 0)}`),
                H('div', { className: 'muted', style: { fontSize: 12 } }, `Last report: ${formatDateTime(item.last_report_at)}`)
              ),
              H('div', { className: 'row', style: { gap: 8, alignItems: 'center' } },
                statusBadge(item.account_status || 'active'),
                H('button', {
                  className: 'btn danger',
                  onClick: () => handleClearReportsForUser(item),
                  disabled: clearingUserId === Number(item.user_id)
                }, clearingUserId === Number(item.user_id) ? 'Clearing...' : 'Clear'),
                H('button', { className: 'btn', onClick: () => handleViewUserFromTop(item.user_id) }, 'View')
              )
            ))
          )
        : H('div', { className: 'muted', style: { marginTop: 12 } }, topError || (topLoading ? 'Loading...' : 'No reported accounts yet.'));

      return H('div', { className: 'admin-dashboard', style: { display: 'grid', gap: 16 } },
        H('div', { className: 'row', style: { gap: 8 } },
          H('button', { className: `btn ${tab === 'users' ? 'primary' : ''}`, onClick: () => setTab('users') }, 'Users'),
          H('button', { className: `btn ${tab === 'reports' ? 'primary' : ''}`, onClick: () => setTab('reports') }, 'Reports'),
          H('button', { className: `btn ${tab === 'flagged' ? 'primary' : ''}`, onClick: () => setTab('flagged') }, 'Flagged'),
          H('button', { className: `btn ${tab === 'ads' ? 'primary' : ''}`, onClick: () => setTab('ads') }, 'Ads'),
          H('button', { className: `btn ${tab === 'testing' ? 'primary' : ''}`, onClick: () => setTab('testing') }, 'Testing')
        ),

        tab === 'users' && H('div', { style: { display: 'grid', gap: 16 } },
          H('section', { className: 'card', style: { padding: 16 } },
            H('h3', { style: { margin: '0 0 12px', fontSize: 18 } }, 'Search users'),
            H('div', { className: 'row', style: { gap: 8, marginBottom: 8 } },
              H('input', {
                value: searchTerm,
                onChange: (e) => setSearchTerm(e.target.value),
                placeholder: 'Search by email or username',
                style: { flex: 1, padding: 8, fontSize: 14 },
                disabled: searchLoading
              }),
              searchTerm && H('button', {
                className: 'btn',
                type: 'button',
                onClick: () => setSearchTerm(''),
                disabled: searchLoading
              }, 'Clear')
            ),
            searchError && H('div', { style: { color: '#b91c1c', fontSize: 13, marginBottom: 8 } }, searchError),
            searchLoading && !searchTerm.trim() ? H('div', { className: 'muted', style: { fontSize: 13 } }, 'Loading...') : null,
            H('div', { style: { maxHeight: 220, overflowY: 'auto', display: 'grid', gap: 6 } },
              searchResults.map(item => H('button', {
                key: item.id,
                className: 'card',
                onClick: () => loadUser(item.id),
                style: {
                  padding: 12,
                  textAlign: 'left',
                  border: selectedUserId === item.id ? '2px solid #2563eb' : '1px solid #e5e7eb',
                  background: '#fff',
                  cursor: 'pointer'
                }
              },
                H('div', { style: { fontWeight: 600 } }, item.username || '(no username)'),
                H('div', { className: 'muted', style: { fontSize: 12 } }, item.email || 'No email'),
                H('div', { className: 'muted', style: { fontSize: 12 } }, `Status: ${item.account_status || 'active'} | Reports: ${Number(item.report_count || 0)}`)
              ))
            )
          ),

          H('section', { className: 'card', style: { padding: 16 } },
            userLoading ? H('div', { className: 'muted' }, 'Loading user...') : userSummary,
            (reportsLoading && !userReports.length) ? H('div', { className: 'muted', style: { marginTop: 12 } }, 'Loading reports...') : reportsList
          )
        ),

        tab === 'reports' && H('section', { className: 'card', style: { padding: 16, display: 'grid', gap: 12 } },
          H('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } },
            H('h3', { style: { margin: 0, fontSize: 18 } }, 'Most reported accounts'),
            H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
              H('label', { style: { fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 } },
                'Window:',
                H('select', {
                  value: topDays,
                  onChange: (e) => setTopDays(Number(e.target.value)),
                  style: { padding: 6 }
                },
                  H('option', { value: 7 }, '7 days'),
                  H('option', { value: 30 }, '30 days'),
                  H('option', { value: 90 }, '90 days')
                )
              ),
              H('label', { style: { fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 } },
                'Min reports:',
                H('input', {
                  type: 'number',
                  min: 1,
                  value: String(topMin),
                  onChange: (e) => setTopMin(Math.max(1, Number(e.target.value) || 1)),
                  style: { width: 72, padding: 6 }
                })
              ),
              H('button', { className: 'btn', onClick: () => loadTopReports(topDays, topMin) }, 'Refresh')
            )
          ),
          topLoading && !topReports.length ? H('div', { className: 'muted' }, 'Loading...') : null,
          topList
        ),

        tab === 'flagged' && H('section', { className: 'card', style: { padding: 16, display: 'grid', gap: 12 } },
          H('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 } },
            H('h3', { style: { margin: 0, fontSize: 18 } }, 'Flagged uploads'),
            H('button', { className: 'btn', onClick: loadFlagged, disabled: flaggedLoading }, flaggedLoading ? 'Refreshing…' : 'Refresh')
          ),
          flaggedError && H('div', { style: { color: '#b91c1c', fontSize: 13 } }, flaggedError),
          flaggedLoading && !flaggedList.length ? H('div', { className: 'muted', style: { fontSize: 13 } }, 'Loading flagged uploads…') : null,
          flaggedList.length
            ? H('div', { style: { display: 'grid', gap: 12 } },
                flaggedList.map(item => {
                  const details = Array.isArray(item?.details) ? item.details : [];
                  return H('div', {
                    key: item.id,
                    className: 'card',
                    style: { padding: 12, border: '1px solid #e5e7eb', display: 'grid', gap: 8 }
                  },
                    H('div', { style: { display: 'grid', gap: 4 } },
                      H('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                        H('span', { style: { fontWeight: 600 } }, item?.username || '(no username)'),
                        item?.flagged_at && H('span', { className: 'muted', style: { fontSize: 12 } }, formatDateTime(item.flagged_at))
                      ),
                      H('div', { className: 'muted', style: { fontSize: 12 } }, item?.email || 'No email on file'),
                      H('div', { className: 'muted', style: { fontSize: 12 } }, item?.listing_title ? `Title: ${item.listing_title}` : 'Title not provided'),
                      details.length ? H('div', { style: { display: 'grid', gap: 6 } },
                        details.map((detail, idx) => {
                          if (!detail || typeof detail !== 'object') return null;
                          const categories = Array.isArray(detail.categories) ? detail.categories.filter(Boolean) : [];
                          const tags = categories.length ? categories : ['Flagged'];
                          const rawType = typeof detail.type === 'string' && detail.type ? detail.type : 'content';
                          const typeLabel = rawType.charAt(0).toUpperCase() + rawType.slice(1);
                          const target = typeof detail.target === 'string' ? detail.target.trim() : '';
                          const isImage = rawType.toLowerCase() === 'image';
                          const textPreview = target.length > 120 ? `${target.slice(0, 117)}…` : target;
                          const preview = isImage
                            ? (target ? 'Image flagged — click to view the full capture.' : 'Image flagged — preview unavailable.')
                            : (textPreview || 'No text captured. Click to open details.');
                          return H('button', {
                            key: `${item.id}-${idx}`,
                            type: 'button',
                            className: 'flagged-detail-button',
                            onClick: () => openFlaggedDetail(item, detail),
                            title: target
                          },
                            H('div', { className: 'flagged-detail-type' }, typeLabel),
                            H('div', { className: 'flagged-detail-tags' },
                              tags.map((tag) => H('span', { key: tag, className: 'flagged-tag' }, tag))
                            ),
                            H('div', { className: 'flagged-detail-preview' }, preview)
                          );
                        }).filter(Boolean)
                      ) : null
                    ),
                    H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap' } },
                      onMessageUser && H('button', { className: 'btn', onClick: () => handleMessageFlagged(item.user_id) }, 'Message'),
                      H('button', {
                        className: 'btn',
                        onClick: () => handleDismissFlagged(item.id),
                        disabled: dismissingFlaggedId === Number(item.id)
                      }, dismissingFlaggedId === Number(item.id) ? 'Removing…' : 'Dismiss')
                    )
                  );
                })
              )
            : (!flaggedLoading && !flaggedError
                ? H('div', { className: 'muted', style: { fontSize: 13 } }, 'No flagged uploads yet.')
                : null)
        ),

        H(FlaggedDetailsModal, {
          open: Boolean(flaggedDetailModal?.detail),
          detail: flaggedDetailModal?.detail || null,
          item: flaggedDetailModal?.item || null,
          onClose: closeFlaggedDetail
        }),

        tab === 'ads' && H('section', { className: 'card', style: { padding: 16, display: 'grid', gap: 16 } },

          H('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } },

            H('h3', { style: { margin: 0, fontSize: 18 } }, editingAdId ? 'Edit advertisement' : 'Create advertisement'),

            H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap' } },

              H('button', { className: 'btn', type: 'button', onClick: loadAds, disabled: adsLoading }, 'Refresh'),

              editingAdId && H('button', { className: 'btn', type: 'button', onClick: resetAdForm, disabled: adSaving }, 'New ad')

            )

          ),

          adsError && H('div', { style: { color: '#b91c1c', fontSize: 13 } }, adsError),

          H('form', { onSubmit: handleAdSubmit, style: { display: 'grid', gap: 12 } },

            H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap' } },

              H('label', { style: { display: 'grid', gap: 4, flex: '1 1 260px' } },

                'Title',

                H('input', {

                  value: adForm.title,

                  onChange: (e) => setAdForm(f => ({ ...f, title: e.target.value })),

                  placeholder: 'Headline',

                  disabled: adSaving,

                  required: true

                })

              ),

              H('label', { style: { display: 'grid', gap: 4, flex: '1 1 260px' } },

                'Target URL',

                H('input', {

                  value: adForm.target_url,

                  onChange: (e) => setAdForm(f => ({ ...f, target_url: e.target.value })),

                  placeholder: 'https://example.com',

                  disabled: adSaving,

                  required: true

                })

              )

            ),

            H('label', { style: { display: 'grid', gap: 4 } },

              'Subtitle',

              H('input', {

                value: adForm.subtitle,

                onChange: (e) => setAdForm(f => ({ ...f, subtitle: e.target.value })),

                placeholder: 'Short supporting copy',

                disabled: adSaving

              })

            ),

            H('label', { style: { display: 'grid', gap: 4 } },

              'Image URL',

              H('input', {

                value: adForm.image_url,

                onChange: (e) => setAdForm(f => ({ ...f, image_url: e.target.value })),

                placeholder: 'https://cdn.example.com/banner.jpg',

                disabled: adSaving

              })

            ),

            H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap' } },

              H('label', { style: { display: 'grid', gap: 4, flex: '1 1 200px' } },

                'CTA label',

                H('input', {

                  value: adForm.cta_label,

                  onChange: (e) => setAdForm(f => ({ ...f, cta_label: e.target.value })),

                  placeholder: 'Learn more',

                  disabled: adSaving

                })

              ),

              H('label', { style: { display: 'grid', gap: 4, flex: '1 1 240px' } },

                'Background',

                H('input', {

                  value: adForm.background,

                  onChange: (e) => setAdForm(f => ({ ...f, background: e.target.value })),

                  placeholder: 'e.g. linear-gradient(...)',

                  disabled: adSaving

                })

              ),

              H('label', { style: { display: 'grid', gap: 4, width: 140 } },

                'Position',

                H('input', {

                  type: 'number',

                  value: adForm.position,

                  onChange: (e) => setAdForm(f => ({ ...f, position: e.target.value })),

                  disabled: adSaving

                })

              ),

              H('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } },

                H('input', {

                  type: 'checkbox',

                  checked: !!adForm.is_active,

                  onChange: (e) => setAdForm(f => ({ ...f, is_active: e.target.checked })),

                  disabled: adSaving

                }),

                'Active'

              )

            ),

            H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap' } },

              H('button', { className: 'btn primary', type: 'submit', disabled: adSaving }, editingAdId ? 'Update ad' : 'Create ad'),

              H('button', { className: 'btn', type: 'button', onClick: resetAdForm, disabled: adSaving }, 'Reset')

            ),

            H('div', { style: { display: 'grid', gap: 8 } },

              H('div', { className: 'muted', style: { fontSize: 12 } }, 'Preview'),

              H('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 } },

                H(AdTile, { ad: { ...adForm }, cols: 3, preview: true, className: 'ad-preview' })

              )

            )

          ),

          adsLoading ? H('div', { className: 'muted' }, 'Loading ads...') :

            (adsList.length

              ? H('div', { style: { display: 'grid', gap: 12 } }, adsList.map(ad =>

                  H('div', { key: ad.id, className: 'card', style: { padding: 16, display: 'grid', gap: 12 } },

                    H('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },

                      H('div', { style: { display: 'grid', gap: 4 } },

                        H('div', { style: { fontWeight: 600 } }, ad.title || '(no title)'),

                        H('div', { className: 'muted', style: { fontSize: 12 } }, ad.target_url),

                        H('div', { className: 'muted', style: { fontSize: 12 } }, `Position: ${Number(ad.position || 0)} | ${ad.is_active ? 'Active' : 'Inactive'}`)

                      ),

                      H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap' } },

                        H('button', { className: 'btn', onClick: () => handleEditAd(ad) }, 'Edit'),

                        H('button', { className: 'btn', onClick: () => handleToggleAdActive(ad) }, ad.is_active ? 'Deactivate' : 'Activate'),

                        H('button', { className: 'btn danger', onClick: () => handleDeleteAd(ad.id) }, 'Delete')

                      )

                    ),

                    H('div', { style: { display: 'grid', gap: 8 } },

                      H(AdTile, { ad, cols: 3, preview: true })

                    )

                  )

                ))

              : H('div', { className: 'muted' }, 'No ads yet.')

            )

        ),

        tab === 'testing' && H('section', { className: 'card', style: { padding: 16, display: 'grid', gap: 12 } },
          H('h3', { style: { margin: 0, fontSize: 18 } }, 'Testing utilities'),
          H('div', { className: 'muted', style: { fontSize: 13 } }, 'Generate sample listings with photos for QA or demo walkthroughs.'),
          seedError
            ? H('div', { style: { color: '#b91c1c', fontSize: 13 } }, seedError)
            : (seedMessage
                ? H('div', { style: { color: '#047857', fontSize: 13 } }, seedMessage)
                : null),
          (seedBusy || seedDeleteBusy)
            ? H('div', { className: 'muted', style: { fontSize: 13 } }, seedBusy ? 'Seeding test listings… this may take a moment.' : 'Deleting test listings…')
            : null,
          H('label', { style: { display: 'grid', gap: 6, fontSize: 13 } },
            'Images to seed',
            H('input', {
              type: 'number',
              min: 1,
              max: 2000,
              step: 1,
              value: seedCount,
              placeholder: 'Uses default when left blank',
              onChange: (e) => setSeedCount(e.target.value),
              disabled: seedActionsDisabled
            })
          ),
          H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap' } },
            H('button', { className: 'btn primary', onClick: handleSeedListings, disabled: seedActionsDisabled }, seedBusy ? 'Seeding…' : 'Seed listings'),
            H('button', { className: 'btn danger', onClick: handleDeleteSeedListings, disabled: seedActionsDisabled }, seedDeleteBusy ? 'Deleting…' : 'Delete seeded listings')
          )
        )
      );
    }

    return {
      AdminDashboard,
      FlaggedDetailsModal,
      createEmptyAdForm
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.admin = {
    createAdminFeature
  };
})();
