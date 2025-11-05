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

    const { useCallback } = React;

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    const { AdTile } = components;
    if (typeof AdTile !== 'function') {
      throw new Error('Admin feature requires AdTile component.');
    }

    const stateModuleFactory = window.ListItApp?.features?.admin?.createAdminStateModule;
    if (typeof stateModuleFactory !== 'function') {
      throw new Error('Admin feature requires admin state module.');
    }
    const { useAdminDashboardState, createEmptyAdForm } = stateModuleFactory({ React, api });

    const componentsFactory = window.ListItApp?.features?.admin?.createAdminComponents;
    if (typeof componentsFactory !== 'function') {
      throw new Error('Admin feature requires admin components.');
    }
    const { FlaggedDetailsModal } = componentsFactory({ React, ReactDOM });

    function AdminDashboard({ onViewSeller, onMessageUser, onAdsUpdated }) {
      const {
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
      } = useAdminDashboardState({ onAdsUpdated, onMessageUser });

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

      const lockToggleLabel = selectedUser?.account_status === 'locked' ? 'Unlock account' : 'Lock account';
      const lockToggleTarget = selectedUser?.account_status === 'locked' ? 'active' : 'locked';
      const showRestore = selectedUser?.account_status === 'banned';

      const previewUrl = typeof adForm?.target_url === 'string' ? adForm.target_url.trim() : '';
      const canOpenAdPreview = /^https?:\/\//i.test(previewUrl);

      const handleOpenAdPreview = useCallback(() => {
        const url = typeof adForm?.target_url === 'string' ? adForm.target_url.trim() : '';
        if (!/^https?:\/\//i.test(url)) {
          alert('Enter a valid http(s) target URL to preview.');
          return;
        }
        const opener = typeof window !== 'undefined' && typeof window.open === 'function' ? window.open : null;
        if (!opener) {
          alert('Preview not available in this environment.');
          return;
        }
        const popup = opener(url, '_blank', 'noopener');
        if (!popup) {
          alert('Allow pop-ups to open the ad preview.');
        }
      }, [adForm?.target_url]);

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

              H('div', {
                className: 'row',
                style: { justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }
              },
                H('div', { className: 'muted', style: { fontSize: 12 } }, 'Preview'),
                H('button', {
                  className: 'btn',
                  type: 'button',
                  onClick: handleOpenAdPreview,
                  disabled: !canOpenAdPreview
                }, 'Open ad preview')
              ),

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

    function useAdminListingActions({ setAllListings, setMineListings }) {
      const toArray = (value) => Array.isArray(value) ? value : [];

      const handleAdminDeleteAll = useCallback(async () => {
        await api.adminDeleteAll();
        if (typeof setAllListings === 'function') {
          setAllListings([]);
        }
        if (typeof setMineListings === 'function') {
          setMineListings([]);
        }
      }, [api, setAllListings, setMineListings]);

      const handleAdminDelete = useCallback((listingId) => {
        if (!listingId) return;
        if (typeof setAllListings === 'function') {
          setAllListings((prev) => toArray(prev).filter((item) => item.id !== listingId));
        }
        if (typeof setMineListings === 'function') {
          setMineListings((prev) => toArray(prev).filter((item) => item.id !== listingId));
        }
      }, [setAllListings, setMineListings]);

      return {
        handleAdminDeleteAll,
        handleAdminDelete
      };
    }

    return {
      AdminDashboard,
      FlaggedDetailsModal,
      createEmptyAdForm,
      useAdminListingActions
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.admin = window.ListItApp.features.admin || {};
  window.ListItApp.features.admin.createAdminFeature = createAdminFeature;
})();
