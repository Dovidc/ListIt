(() => {
  function createAdminStateModule({ React, api }) {
    if (!React || typeof React.useState !== 'function') {
      throw new Error('Admin state module requires React.');
    }
    if (!api) {
      throw new Error('Admin state module requires an API client.');
    }

    const {
      useState,
      useEffect,
      useCallback,
      useRef
    } = React;

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

    function useAdminDashboardState(options = {}) {
      const { onAdsUpdated, onMessageUser } = options;

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

      useEffect(() => () => {
        if (searchTimer.current) clearTimeout(searchTimer.current);
      }, []);

      const loadUserReports = useCallback(async (userId, limit = 50) => {
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
      }, [api]);

      const loadUser = useCallback(async (userId) => {
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
      }, [api, loadUserReports]);

      const loadTopReports = useCallback(async (daysValue = topDays, minValue = topMin) => {
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
      }, [api, topDays, topMin]);

      useEffect(() => {
        loadTopReports(topDays, topMin);
      }, [loadTopReports, topDays, topMin]);

      const fetchSearch = useCallback(async (term) => {
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
      }, [api]);

      useEffect(() => {
        if (searchTimer.current) clearTimeout(searchTimer.current);
        const term = searchTerm.trim();
        if (!term) {
          setSearchResults([]);
          setSearchError('');
          return;
        }
        searchTimer.current = setTimeout(() => { fetchSearch(term); }, 300);
      }, [searchTerm, fetchSearch]);

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
      }, [api]);

      const openFlaggedDetail = useCallback((item, detail) => {
        if (!detail || typeof detail !== 'object') return;
        setFlaggedDetailModal({ item, detail });
      }, []);

      const closeFlaggedDetail = useCallback(() => {
        setFlaggedDetailModal(null);
      }, []);

      useEffect(() => {
        if (tab === 'flagged') {
          loadFlagged();
        }
      }, [tab, loadFlagged]);

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
      }, [api]);

      useEffect(() => {
        if (tab === 'ads') {
          loadAds();
        }
      }, [tab, loadAds]);

      const handleStatusChange = useCallback(async (status) => {
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
      }, [api, fetchSearch, loadTopReports, loadUser, searchTerm, selectedUser, topDays, topMin]);

      const handleViewUserFromTop = useCallback((userId) => {
        setTab('users');
        loadUser(userId);
      }, [loadUser]);

      const handleClearReportsForUser = useCallback(async (user) => {
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
      }, [api, fetchSearch, loadTopReports, loadUser, searchTerm, selectedUser, topDays, topMin]);

      const handleMessageFlagged = useCallback(async (userId) => {
        if (!onMessageUser) return;
        const targetId = Number(userId);
        if (!Number.isFinite(targetId)) return;
        try {
          await onMessageUser(targetId);
        } catch (err) {
          alert(err?.message || 'Failed to open conversation.');
        }
      }, [onMessageUser]);

      const handleDismissFlagged = useCallback(async (id) => {
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
      }, [api, dismissingFlaggedId]);

      const resetAdForm = useCallback(() => {
        setEditingAdId(null);
        setAdForm(createEmptyAdForm());
        setAdsError('');
      }, []);

      const handleEditAd = useCallback((ad) => {
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
      }, []);

      const handleAdSubmit = useCallback(async (event) => {
        event?.preventDefault?.();
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
      }, [adForm, api, editingAdId, loadAds, onAdsUpdated, resetAdForm]);

      const handleDeleteAd = useCallback(async (id) => {
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
      }, [api, editingAdId, loadAds, onAdsUpdated, resetAdForm]);

      const handleToggleAdActive = useCallback(async (ad) => {
        if (!ad) return;
        try {
          const payload = buildAdPayload({ ...ad, is_active: ad.is_active ? 0 : 1 });
          await api.adminUpdateAd(ad.id, payload);
          await loadAds();
          onAdsUpdated?.();
        } catch (err) {
          alert(err?.message || 'Failed to update ad');
        }
      }, [api, loadAds, onAdsUpdated]);

      const handleSeedListings = useCallback(async () => {
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
      }, [api, seedBusy, seedCount, seedDeleteBusy]);

      const handleDeleteSeedListings = useCallback(async () => {
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
      }, [api, seedBusy, seedDeleteBusy]);

      const seedActionsDisabled = seedBusy || seedDeleteBusy;

      return {
        tab,
        setTab,
        searchTerm,
        setSearchTerm,
        searchResults,
        searchLoading,
        searchError,
        selectedUserId,
        selectedUser,
        userLoading,
        userError,
        userReports,
        reportsLoading,
        reportsError,
        topReports,
        clearingUserId,
        topLoading,
        topError,
        topDays,
        setTopDays,
        topMin,
        setTopMin,
        loadTopReports,
        flaggedList,
        flaggedLoading,
        flaggedError,
        flaggedDetailModal,
        openFlaggedDetail,
        closeFlaggedDetail,
        dismissingFlaggedId,
        handleDismissFlagged,
        handleMessageFlagged,
        loadFlagged,
        adsList,
        adsLoading,
        adsError,
        loadAds,
        adForm,
        setAdForm,
        adSaving,
        editingAdId,
        handleAdSubmit,
        resetAdForm,
        handleEditAd,
        handleDeleteAd,
        handleToggleAdActive,
        seedBusy,
        seedDeleteBusy,
        seedMessage,
        seedError,
        seedCount,
        setSeedCount,
        handleSeedListings,
        handleDeleteSeedListings,
        seedActionsDisabled,
        loadUser,
        handleStatusChange,
        handleViewUserFromTop,
        handleClearReportsForUser
      };
    }

    return {
      createEmptyAdForm,
      useAdminDashboardState
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.admin = window.ListItApp.features.admin || {};
  window.ListItApp.features.admin.createAdminStateModule = createAdminStateModule;
})();
