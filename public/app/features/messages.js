(() => {
  function createMessagesFeature({ React, ReactDOM, api, uploads, helpers, components }) {
    if (!React || typeof React.useState !== 'function') {
      throw new Error('Messages feature requires React.');
    }
    if (!ReactDOM || typeof ReactDOM.createPortal !== 'function') {
      throw new Error('Messages feature requires ReactDOM.');
    }
    if (!api) {
      throw new Error('Messages feature requires an API client.');
    }

    const {
      useState,
      useEffect,
      useRef,
      useCallback
    } = React;

    const uploadOneMessageImage = uploads?.uploadOneMessageImage;
    const useFilePreviews = uploads?.useFilePreviews;
    if (typeof uploadOneMessageImage !== 'function') {
      throw new Error('Messages feature requires uploadOneMessageImage helper.');
    }
    if (typeof useFilePreviews !== 'function') {
      throw new Error('Messages feature requires useFilePreviews hook.');
    }

    const loadSeen = helpers?.loadSeen;
    if (typeof loadSeen !== 'function') {
      throw new Error('Messages feature requires loadSeen helper.');
    }

    const saveSeen = helpers?.saveSeen;
    if (typeof saveSeen !== 'function') {
      throw new Error('Messages feature requires saveSeen helper.');
    }

    const Lightbox = components?.Lightbox;
    const ImageWithSkeleton = components?.ImageWithSkeleton;
    if (typeof Lightbox !== 'function' || typeof ImageWithSkeleton !== 'function') {
      throw new Error('Messages feature requires media components.');
    }

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);
    const memo = typeof React.memo === 'function' ? React.memo : (component) => component;

    function isMobileDevice() {
      const ua = (navigator.userAgent || navigator.vendor || '').toLowerCase();
      if (/(iphone|ipod|ipad|android|windows phone|iemobile|mobile)/.test(ua)) {
        return true;
      }
      if (/macintosh/.test(ua) && navigator.maxTouchPoints && navigator.maxTouchPoints > 1) {
        return true;
      }
      return false;
    }

    function PaypalPresetIcon({ size = 22, stroke = '#9ca3af', style, ...rest } = {}) {
      return H('svg', Object.assign({
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke,
        'stroke-width': 1.8,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        focusable: 'false',
        'aria-hidden': 'true',
        style
      }, rest),
      H('rect', { x: 3.2, y: 7.6, width: 17.6, height: 11.6, rx: 2.8, ry: 2.8 }),
      H('path', { d: 'M6.2 7.6V6.1c0-2 1.6-3.6 3.6-3.6h8.2a1.8 1.8 0 0 1 0 3.6H6.2' }),
      H('path', { d: 'M10.8 11.2h2.3a1.9 1.9 0 0 1 0 3.8h-2.3V18' }),
      H('path', { d: 'M10.8 15h1.8' }),
      H('circle', { cx: 16.8, cy: 13.4, r: 1.5 }));
    }

    function LocationPresetIcon({ size = 20, stroke = '#4b5563', style, ...rest } = {}) {
      return H('svg', Object.assign({
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke,
        'stroke-width': 1.8,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        focusable: 'false',
        'aria-hidden': 'true',
        style
      }, rest),
      H('path', { d: 'M12 21s6-5.2 6-11a6 6 0 0 0-12 0c0 5.8 6 11 6 11z' }),
      H('circle', { cx: 12, cy: 10, r: 2.6 }));
    }

    function AttachButton({ onClick, title = 'Attach images', variant = 'library', disabled = false }) {
      let icon;
      if (variant === 'camera') {
        icon = H('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none' },
          H('rect', { x: 3, y: 6, width: 18, height: 13, rx: 3, stroke: '#9ca3af', 'stroke-width': 2 }),
          H('path', { d: 'M9 6l1.5-2h3L15 6', stroke: '#9ca3af', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
          H('circle', { cx: 12, cy: 12.5, r: 3, stroke: '#9ca3af', 'stroke-width': 2 })
        );
      } else if (variant === 'paypal') {
        icon = H(PaypalPresetIcon, { size: 22, stroke: '#9ca3af' });
      } else if (variant === 'location') {
        icon = H(LocationPresetIcon, { size: 20, stroke: '#6b7280' });
      } else {
        icon = H('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none' },
          H('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2, stroke: '#9ca3af', 'stroke-width': 2 }),
          H('circle', { cx: 9, cy: 10, r: 2, fill: '#9ca3af' }),
          H('path', { d: 'M7 18l4-4 3 3 4-5 3 4', stroke: '#9ca3af', 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
        );
      }
      return H('button', {
        className: 'icon-btn',
        type: 'button',
        onClick: disabled ? undefined : onClick,
        title,
        'aria-label': title,
        'data-testid': variant === 'paypal'
          ? 'dm-paypal'
          : variant === 'location'
            ? 'dm-location'
            : 'dm-attach',
        disabled,
        style: {
          width: 40,
          height: 40,
          borderRadius: 12,
          border: '1px solid #e5e7eb',
          background: '#fff',
          display: 'grid',
          placeItems: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1
        }
      }, icon);
    }

    function ConversationsSidebar({ conversations, activeId, onSelectConversation, onDeleteConversation, onMarkAllRead, className }) {
      const [searchQuery, setSearchQuery] = useState('');
      const hasUnread = conversations.some(c => c._unread);

      // Filter conversations by username or listing title
      const filteredConversations = searchQuery.trim()
        ? conversations.filter(c => {
            const query = searchQuery.toLowerCase();
            const username = (c.other_user_username || '').toLowerCase();
            const listingTitle = (c.listing_title || '').toLowerCase();
            return username.includes(query) || listingTitle.includes(query);
          })
        : conversations;

      return H('aside', { className: `card sidebar messages-sidebar ${className || ''}` },
        H('div', {
          className: 'messages-sidebar__header',
          style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
        },
          'Conversations'
        ),
        H('div', { className: 'messages-sidebar__controls' },
          H('input', {
            type: 'text',
            placeholder: 'Search...',
            value: searchQuery,
            onChange: (e) => setSearchQuery(e.target.value),
            className: 'messages-search-input'
          }),
          hasUnread && H('button', {
            className: 'btn messages-mark-read-btn',
            onClick: onMarkAllRead,
            title: 'Mark all conversations as read'
          }, 'Mark read')
        ),
        H('div', { className: 'messages-sidebar__list' },
          ...(filteredConversations.length
            ? filteredConversations.map((conversation) => H('div', {
                key: conversation.id,
                className: 'row',
                style: {
                  padding: '8px 6px',
                  borderRadius: 12,
                  cursor: 'pointer',
                  background: conversation.id === activeId ? '#f3f4f6' : 'transparent',
                  position: 'relative',
                  alignItems: 'center',
                  gap: 8
                },
                onClick: () => onSelectConversation?.(conversation.id)
              },
              H('div', {
                className: 'profile-avatar profile-avatar-tiny',
                style: { flexShrink: 0 }
              },
                conversation.other_user_profile_picture
                  ? H('img', { src: conversation.other_user_profile_picture, alt: '' })
                  : (conversation.other_user_username ? conversation.other_user_username.charAt(0).toUpperCase() : '?')
              ),
              H('div', {
                style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }
              },
                H('div', { style: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, conversation.other_user_username ? conversation.other_user_username : 'Unknown'),
                conversation.listing_title ? H('div', { className: 'muted', style: { fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, conversation.listing_title) : null
              ),
              conversation._unread && H('span', {
                style: {
                  marginLeft: 'auto',
                  width: 8,
                  height: 8,
                  borderRadius: 8,
                  background: conversation._unreadAdmin ? '#111' : '#ef4444'
                }
              }),
              H('button', {
                title: 'Delete conversation',
                'data-testid': 'dm-delete',
                onClick: (event) => {
                  event.stopPropagation();
                  onDeleteConversation?.(conversation.id);
                },
                style: {
                  marginLeft: conversation._unread ? 6 : 'auto',
                  width: 22,
                  height: 22,
                  lineHeight: '20px',
                  borderRadius: 10,
                  border: '1px solid #fee2e2',
                  background: '#fff5f5',
                  color: '#b91c1c',
                  fontWeight: 800,
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer'
                }
              }, 'x')
            ))
            : [H('div', { key: 'empty', className: 'muted messages-sidebar__empty' }, 'No conversations yet')])
        )
      );
    }

    function MessagesThread({
      messages,
      user,
      ImageWithSkeleton,
      openLightbox,
      msgsContainerRef,
      onScroll,
      formatMessageTimestamp,
      otherUserPicture,
      otherUserId,
      otherUserUsername,
      onViewProfile
    }) {
      const userPicture = user?.profile_picture_url;
      const userInitial = user?.username ? user.username.charAt(0).toUpperCase() : '?';
      const otherInitial = otherUserUsername ? otherUserUsername.charAt(0).toUpperCase() : '?';

      const avatarStyle = {
        width: 32,
        height: 32,
        borderRadius: '50%',
        objectFit: 'cover',
        flexShrink: 0,
        cursor: 'pointer',
        border: '2px solid #e5e7eb'
      };

      const avatarPlaceholderStyle = {
        ...avatarStyle,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f3f4f6',
        color: '#6b7280',
        fontSize: 14,
        fontWeight: 700
      };

      return H('div', {
        ref: msgsContainerRef,
        className: 'messages-thread-content',
        style: {
          flex: 1,
          overflow: 'auto',
          padding: 4,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end'
        },
        onScroll
      },
      H('div', { style: { display: 'flex', flexDirection: 'column' } },
        messages.map((message) => {
        const ts = formatMessageTimestamp(message.created_at || message.updated_at);
        const isMine = message.sender_id === user?.id;
        const picture = isMine ? userPicture : otherUserPicture;
        const initial = isMine ? userInitial : otherInitial;
        const profileId = isMine ? user?.id : otherUserId;

        const avatar = picture
          ? H('img', {
              src: picture,
              alt: '',
              style: avatarStyle,
              onClick: () => onViewProfile?.(profileId),
              title: 'View profile'
            })
          : H('div', {
              style: avatarPlaceholderStyle,
              onClick: () => onViewProfile?.(profileId),
              title: 'View profile'
            }, initial);

        return H('div', {
          key: message.id,
          style: {
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
            marginBottom: 8,
            flexDirection: isMine ? 'row-reverse' : 'row'
          }
        },
          avatar,
          H('div', {
            className: `message ${isMine ? 'mine' : 'their'}`,
            style: { maxWidth: 'calc(100% - 50px)' }
          },
            message.body && H('div', null, message.body),
            Array.isArray(message.images) && message.images.length > 0 &&
              H('div', { className: 'row', style: { gap: 6, marginTop: 6, flexWrap: 'wrap' } },
                ...message.images.map((src, index) =>
                  H(ImageWithSkeleton, {
                    key: index,
                    src,
                    loading: 'lazy',
                    decoding: 'async',
                    style: {
                      width: 140,
                      height: 140,
                      objectFit: 'cover',
                      borderRadius: 10,
                      border: '1px solid #e5e7eb',
                      cursor: 'zoom-in'
                    },
                    onClick: () => openLightbox(message.images, index)
                  })
                )
              ),
            ts && H('div', {
              className: 'muted',
              style: {
                fontSize: 11,
                marginTop: 6,
                textAlign: isMine ? 'right' : 'left'
              }
            }, ts)
          )
        );
      })));
    }

    function ImagePreviewStrip({ previews, onRemove, ImageWithSkeleton }) {
      if (!previews?.length) return null;
      return H('div', { className: 'row', style: { gap: 6, flexWrap: 'wrap', margin: '6px 0' } },
        ...previews.map(({ url }, index) =>
          H('div', { key: index, style: { position: 'relative' } },
            H(ImageWithSkeleton, {
              src: url,
              style: {
                width: 72,
                height: 72,
                objectFit: 'cover',
                borderRadius: 10,
                border: '1px solid #e5e7eb'
              }
            }),
            H('button', {
              className: 'btn danger',
              type: 'button',
              style: { position: 'absolute', top: 2, right: 2, padding: '2px 6px' },
              onClick: () => onRemove(index)
            }, 'x')
          )
        )
      );
    }

    function MessageComposer({
      input,
      setInput,
      onComposerPaste,
      onPickImages,
      cameraFileRef,
      libraryFileRef,
      dropRef,
      onDragOver,
      onDrop,
      canRevealPaypal,
      onRevealPaypal,
      canSendLocation,
      onRequestLocation,
      onSend,
      inputRef,
      otherUserDeleted,
      hasImages
    }) {
      const [showAttachMenu, setShowAttachMenu] = useState(false);
      const attachMenuRef = useRef(null);
      const isMobile = isMobileDevice();
      const canSend = !otherUserDeleted && (input.trim() || hasImages);

      // Close attach menu when clicking outside
      useEffect(() => {
        if (!showAttachMenu) return;
        const handleClickOutside = (e) => {
          if (attachMenuRef.current && !attachMenuRef.current.contains(e.target)) {
            setShowAttachMenu(false);
          }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);
        return () => {
          document.removeEventListener('mousedown', handleClickOutside);
          document.removeEventListener('touchstart', handleClickOutside);
        };
      }, [showAttachMenu]);

      // Mobile UI: plus button with popup menu, rounded input, arrow send button
      if (isMobile) {
        return H('div', {
          className: 'message-composer-wrapper',
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            marginTop: 'auto'
          }
        },
          // Warning when other user deleted the conversation
          otherUserDeleted && H('div', {
            style: {
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 13,
              color: '#dc2626',
              textAlign: 'center'
            }
          }, 'This user deleted the conversation. You cannot send messages.'),

          H('div', {
            className: 'message-composer',
            ref: dropRef,
            onDragOver: otherUserDeleted ? undefined : onDragOver,
            onDrop: otherUserDeleted ? undefined : onDrop,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 0',
              opacity: otherUserDeleted ? 0.5 : 1
            }
          },
            // Hidden file inputs
            H('input', {
              type: 'file',
              accept: 'image/*',
              capture: 'environment',
              ref: cameraFileRef,
              onChange: onPickImages,
              disabled: otherUserDeleted,
              style: { position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }
            }),
            H('input', {
              type: 'file',
              accept: 'image/*',
              multiple: true,
              ref: libraryFileRef,
              onChange: onPickImages,
              disabled: otherUserDeleted,
            style: { position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }
          }),

          // Plus button (attachment menu)
          H('div', { ref: attachMenuRef, style: { position: 'relative' } },
            H('button', {
              type: 'button',
              onClick: otherUserDeleted ? undefined : () => setShowAttachMenu(!showAttachMenu),
              disabled: otherUserDeleted,
              style: {
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: 'none',
                background: '#e5e7eb',
                color: '#374151',
                fontSize: 24,
                fontWeight: 300,
                lineHeight: 1,
                display: 'grid',
                placeItems: 'center',
                cursor: otherUserDeleted ? 'not-allowed' : 'pointer',
                flexShrink: 0
              },
              title: 'Attach'
            }, '+'),

            // Attachment menu popup - horizontal icon row
            showAttachMenu && H('div', {
              style: {
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: 8,
                background: '#fff',
                borderRadius: 12,
                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                padding: 8,
                display: 'flex',
                flexDirection: 'row',
                gap: 8,
                zIndex: 100
              }
            },
              // Camera icon button
              H('button', {
                type: 'button',
                onClick: () => { cameraFileRef?.current?.click(); setShowAttachMenu(false); },
                title: 'Take photo',
                style: {
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  border: '1px solid #e5e7eb',
                  background: '#fff',
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer'
                }
              },
                H('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none' },
                  H('rect', { x: 3, y: 6, width: 18, height: 13, rx: 3, stroke: '#6b7280', 'stroke-width': 2 }),
                  H('path', { d: 'M9 6l1.5-2h3L15 6', stroke: '#6b7280', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
                  H('circle', { cx: 12, cy: 12.5, r: 3, stroke: '#6b7280', 'stroke-width': 2 })
                )
              ),
              // Gallery icon button
              H('button', {
                type: 'button',
                onClick: () => { libraryFileRef?.current?.click(); setShowAttachMenu(false); },
                title: 'Photo library',
                style: {
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  border: '1px solid #e5e7eb',
                  background: '#fff',
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer'
                }
              },
                H('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none' },
                  H('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2, stroke: '#6b7280', 'stroke-width': 2 }),
                  H('circle', { cx: 9, cy: 10, r: 2, fill: '#6b7280' }),
                  H('path', { d: 'M7 18l4-4 3 3 4-5 3 4', stroke: '#6b7280', 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
                )
              )
            )
          ),

          // Location preset button
          canSendLocation && !otherUserDeleted && H('button', {
            type: 'button',
            onClick: onRequestLocation,
            style: {
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: 'none',
              background: '#e5e7eb',
              color: '#374151',
              fontSize: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0
            },
            title: 'Send location'
          }, H(LocationPresetIcon, { size: 20, stroke: '#6b7280' })),

          // Text input
          H('input', {
            type: 'text',
            inputMode: 'text',
            autoComplete: 'off',
            autoCorrect: 'off',
            autoCapitalize: 'sentences',
            enterKeyHint: 'send',
            placeholder: otherUserDeleted ? 'Cannot send messages' : 'Message...',
            value: input,
            ref: inputRef,
            disabled: otherUserDeleted,
            onPaste: otherUserDeleted ? undefined : onComposerPaste,
            onFocus: () => {
              // Immediately hide dashboard on focus - must be 100% reliable
              document.body.classList.add('keyboard-open');
            },
            onBlur: () => {
              // Only remove class if no other input is focused
              setTimeout(() => {
                const active = document.activeElement;
                if (active?.tagName !== 'INPUT' && active?.tagName !== 'TEXTAREA') {
                  document.body.classList.remove('keyboard-open');
                }
              }, 150);
            },
            onChange: otherUserDeleted ? undefined : (event) => {
              setInput(event.target.value);
              if (showAttachMenu) setShowAttachMenu(false);
            },
            onKeyDown: otherUserDeleted ? undefined : (event) => {
              if (event.key === 'Enter' && !event.shiftKey && canSend) {
                event.preventDefault();
                onSend();
              }
            },
            style: {
              flex: 1,
              minWidth: 0,
              padding: '10px 14px',
              border: '1px solid #e5e7eb',
              borderRadius: 20,
              fontSize: 16,
              outline: 'none',
              background: otherUserDeleted ? '#f3f4f6' : '#fff',
              WebkitAppearance: 'none',
              WebkitTapHighlightColor: 'transparent',
              WebkitUserSelect: 'text',
              userSelect: 'text',
              touchAction: 'manipulation'
            }
          }),

          // Send button (blue arrow)
          H('button', {
            type: 'button',
            onClick: canSend ? onSend : undefined,
            disabled: !canSend,
            style: {
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: 'none',
              background: canSend ? '#2563eb' : '#d1d5db',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: canSend ? 'pointer' : 'default',
              flexShrink: 0,
              transition: 'background 0.15s ease'
            },
            title: 'Send'
          },
            // Arrow icon (SVG)
            H('svg', {
              width: 18,
              height: 18,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2.5,
              strokeLinecap: 'round',
              strokeLinejoin: 'round'
            },
              H('line', { x1: 22, y1: 2, x2: 11, y2: 13 }),
              H('polygon', { points: '22 2 15 22 11 13 2 9 22 2' })
            )
          )
        )
        );
      }

      // Desktop UI: separate attach buttons, textarea, Send button
      return H('div', {
        style: { display: 'flex', flexDirection: 'column', gap: 8 }
      },
        // Warning when other user deleted the conversation
        otherUserDeleted && H('div', {
          style: {
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 13,
            color: '#dc2626',
            textAlign: 'center'
          }
        }, 'This user deleted the conversation. You cannot send messages.'),

        H('div', {
          className: 'row',
          style: { alignItems: 'center', gap: 8, flexWrap: 'wrap', opacity: otherUserDeleted ? 0.5 : 1 },
          ref: dropRef,
          onDragOver: otherUserDeleted ? undefined : onDragOver,
          onDrop: otherUserDeleted ? undefined : onDrop
        },
        H('input', {
          type: 'file',
          accept: 'image/*',
          capture: 'environment',
          ref: cameraFileRef,
          onChange: onPickImages,
          disabled: otherUserDeleted,
          style: { position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }
        }),
        H('input', {
          type: 'file',
          accept: 'image/*',
          multiple: true,
          ref: libraryFileRef,
          onChange: onPickImages,
          disabled: otherUserDeleted,
          style: { position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }
        }),
        !otherUserDeleted && H('div', {
          className: 'row',
          style: { alignItems: 'center', gap: 8, flexWrap: 'wrap' }
        },
          H(AttachButton, {
            onClick: () => {
              if (cameraFileRef?.current) cameraFileRef.current.click();
            },
            title: 'Take a photo',
            variant: 'camera'
          }),
          H(AttachButton, {
            onClick: () => {
              if (libraryFileRef?.current) libraryFileRef.current.click();
            },
            title: 'Attach from photos',
            variant: 'library'
          }),
          canRevealPaypal && H(AttachButton, {
            onClick: onRevealPaypal,
            title: 'Reveal payment info',
            variant: 'paypal'
          }),
          H(AttachButton, {
            onClick: onRequestLocation,
            title: 'Send saved address',
            variant: 'location',
            disabled: !canSendLocation
          })
        ),
        H('textarea', {
          placeholder: otherUserDeleted ? 'Cannot send messages' : 'Type a message...',
          value: input,
          rows: 1,
          disabled: otherUserDeleted,
          onPaste: otherUserDeleted ? undefined : onComposerPaste,
          onChange: otherUserDeleted ? undefined : (event) => setInput(event.target.value),
          onKeyDown: otherUserDeleted ? undefined : (event) => {
            if (event.key === 'Enter' && !event.shiftKey && canSend) {
              event.preventDefault();
              onSend();
            }
          },
          style: {
            width: 220,
            maxWidth: '100%',
            resize: 'none'
          }
        }),
        H('button', {
          className: 'btn primary',
          onClick: canSend ? onSend : undefined,
          disabled: !canSend
        }, 'Send'))
      );
    }

    const ConfirmLocationModal = memo(function ConfirmLocationModal({
      open,
      onConfirm,
      onCancel,
      address
    }) {
      const hasDom = typeof document !== 'undefined' && document.body;
      if (!open || !hasDom) {
        return null;
      }

      const handleOverlayClick = (evt) => {
        if (evt.target && evt.target.classList && evt.target.classList.contains('modal')) {
          onCancel?.();
        }
      };

      return ReactDOM.createPortal(
        H('div', {
          className: 'modal open',
          onClick: handleOverlayClick,
          style: { zIndex: 1100 }
        },
          H('div', {
            className: 'modal-inner',
            style: {
              maxWidth: '360px',
              width: 'min(360px, 92vw)',
              padding: '20px',
              background: '#fff',
              color: '#111',
              borderRadius: 14,
              display: 'grid',
              gap: 16
            }
          },
            H('h3', {
              style: {
                margin: 0,
                fontSize: 18,
                fontWeight: 700
              }
            }, 'Send saved address?'),
            H('p', {
              className: 'muted',
              style: { margin: 0, fontSize: 13 }
            }, address ? address : 'No address saved yet.'),
            H('div', {
              className: 'row',
              style: { justifyContent: 'flex-end', gap: 10 }
            },
              H('button', {
                type: 'button',
                onClick: onCancel,
                className: 'btn',
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#b91c1c'
                }
              },
                H('span', { 'aria-hidden': 'true', style: { color: '#ef4444', fontSize: 18, lineHeight: 1 } }, '✕'),
                'Cancel'
              ),
              H('button', {
                type: 'button',
                onClick: onConfirm,
                className: 'btn',
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: '#059669',
                  border: '1px solid #047857',
                  color: '#fff'
                }
              },
                H('span', { 'aria-hidden': 'true', style: { fontSize: 18, lineHeight: 1 } }, '✔'),
                'Send address'
              )
            )
          )
        ),
        document.body
      );
    });

    const ConfirmPaypalModal = memo(function ConfirmPaypalModal({
      open,
      email,
      onConfirm,
      onCancel
    }) {
      const hasDom = typeof document !== 'undefined' && document.body;
      if (!open || !hasDom) {
        return null;
      }

      const handleOverlayClick = (evt) => {
        if (evt.target && evt.target.classList && evt.target.classList.contains('modal')) {
          onCancel?.();
        }
      };

      return ReactDOM.createPortal(
        H('div', {
          className: 'modal open',
          onClick: handleOverlayClick,
          style: { zIndex: 1100 }
        },
          H('div', {
            className: 'modal-inner',
            style: {
              maxWidth: '360px',
              width: 'min(360px, 92vw)',
              padding: '20px',
              background: '#fff',
              color: '#111',
              borderRadius: 14,
              display: 'grid',
              gap: 16
            }
          },
            H('h3', {
              style: {
                margin: 0,
                fontSize: 18,
                fontWeight: 700
              }
            }, 'Share payment info?'),
            H('p', {
              className: 'muted',
              style: { margin: 0, fontSize: 13 }
            }, email ? `Your payment info (${email}) will be sent in the chat.` : 'No PayPal email saved yet.'),
            H('div', {
              className: 'row',
              style: { justifyContent: 'flex-end', gap: 10 }
            },
              H('button', {
                type: 'button',
                onClick: onCancel,
                className: 'btn',
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#b91c1c'
                }
              },
                H('span', { 'aria-hidden': 'true', style: { color: '#ef4444', fontSize: 18, lineHeight: 1 } }, '✕'),
                'Cancel'
              ),
              H('button', {
                type: 'button',
                onClick: onConfirm,
                className: 'btn',
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: '#2563eb',
                  border: '1px solid #1d4ed8',
                  color: '#fff'
                }
              },
                H('span', { 'aria-hidden': 'true', style: { fontSize: 18, lineHeight: 1 } }, '✔'),
                'Share info'
              )
            )
          )
        ),
        document.body
      );
    });

    function useMessagesPanelState({ user, initialActiveId, onSeenChange, onConversationsUpdate }) {
      const [convos, setConvos] = useState([]);
      const [activeId, setActiveId] = useState(initialActiveId || null);
      const [msgs, setMsgs] = useState([]);
      const [loadingMsgs, setLoadingMsgs] = useState(false);
      const [input, setInput] = useState('');
      const [imgFiles, setImgFiles] = useState([]);
      const imgPreviews = useFilePreviews(imgFiles);
      const cameraFileRef = useRef();
      const libraryFileRef = useRef();
      const [lb, setLb] = useState({ open: false, images: [], index: 0 });
      const dropRef = useRef();
      const wsRef = useRef(null);
      const reconnectTimeoutRef = useRef(null);
      const reconnectAttemptsRef = useRef(0);
      const msgsContainerRef = useRef(null);
      const [isAtBottom, setIsAtBottom] = useState(true);

      const formatMessageTimestamp = useCallback((value) => {
        if (!value) return '';
        const dt = new Date(value);
        if (!Number.isFinite(dt.getTime())) return value;
        return dt.toLocaleString();
      }, []);

      const isAtBottomRef = useRef(isAtBottom);

      useEffect(() => {
        isAtBottomRef.current = isAtBottom;
      }, [isAtBottom]);

      const checkIfAtBottom = () => {
        // Don't update scroll state while keyboard is opening (prevents re-render during focus)
        if (document.body.classList.contains('keyboard-open')) return;
        const container = msgsContainerRef.current;
        if (!container) return;
        const threshold = 50;
        const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
        setIsAtBottom(atBottom);
      };

      useEffect(() => {
        if (!user) return;

        function connectWebSocket() {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const wsUrl = `${protocol}//${window.location.host}/ws`;
          const ws = new WebSocket(wsUrl);
          wsRef.current = ws;

          ws.onopen = () => {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectAttemptsRef.current = 0;
          };

          ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);

              if (data.type === 'new_message') {
                setActiveId((currentActiveId) => {
                  if (data.conversation_id === currentActiveId) {
                    setMsgs((prev) => [...prev, data.message]);

                    if (data.sender_id !== user.id && isAtBottomRef.current) {
                      onSeenChange?.(data.conversation_id, data.message.id);
                    }
                  }

                  fetchConvos();

                  return currentActiveId;
                });
              }
            } catch (e) {
              console.error('WebSocket message error:', e);
            }
          };

          ws.onerror = (error) => {
            console.error('WebSocket error:', error);
          };

          ws.onclose = (event) => {
            wsRef.current = null;

            if (event?.code !== 1008) {
              const baseDelay = 1000;
              const maxDelay = 30000;
              const attempts = reconnectAttemptsRef.current;
              const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempts), maxDelay);
              const jitter = exponentialDelay * 0.2 * (Math.random() * 2 - 1);
              const delay = Math.round(exponentialDelay + jitter);

              reconnectAttemptsRef.current = attempts + 1;
              reconnectTimeoutRef.current = setTimeout(() => {
                if (user) connectWebSocket();
              }, delay);
            }
          };

          const pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping' }));
            }
          }, 25000);

          return () => {
            clearInterval(pingInterval);
            ws.close();
          };
        }

        const cleanup = connectWebSocket();

        return () => {
          if (typeof cleanup === 'function') cleanup();
          clearTimeout(reconnectTimeoutRef.current);
          if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
          }
        };
      }, [user?.id]);

      useEffect(() => {
        if (isAtBottom && msgs.length > 0 && activeId) {
          const lastMsg = msgs[msgs.length - 1];
          if (lastMsg.sender_id !== user?.id) {
            onSeenChange?.(activeId, lastMsg.id);
          }
        }
      }, [isAtBottom, msgs, activeId, user?.id]);

      function addFiles(filesLike) {
        const MAX_EACH_MB = 20;
        const MAX_EACH = MAX_EACH_MB * 1024 * 1024;
        const MAX_COUNT = 5;
        const next = [...imgFiles];
        for (const f of Array.from(filesLike || [])) {
          if (!f || !f.type?.startsWith?.('image/')) continue;
          if (f.size > MAX_EACH) { alert(`Each image must be under ${MAX_EACH_MB}MB`); continue; }
          if (next.length >= MAX_COUNT) break;
          next.push(f);
        }
        setImgFiles(next);
      }

      function pickImgs(e) {
        addFiles(e.target.files);
        if (e?.target) e.target.value = '';
      }

      function onComposerPaste(e) {
        const cd = e.clipboardData;
        if (!cd) return;
        const imageItems = Array.from(cd.items || []).filter((it) => it.kind === 'file' && it.type.startsWith('image/'));
        if (imageItems.length === 0) return;
        e.preventDefault();

        const files = imageItems
          .map((it) => it.getAsFile())
          .filter(Boolean)
          .map((blob) => new File([blob], `pasted-${Date.now()}-${Math.random().toString(36).slice(2)}.${(blob.type.split('/')[1] || 'png')}`, { type: blob.type }));
        addFiles(files);

        const txt = cd.getData('text/plain');
        if (txt) setInput((v) => (v ? v + ' ' : '') + txt);
      }

      function onDragOver(e) { e.preventDefault(); }
      function onDrop(e) { e.preventDefault(); addFiles(e.dataTransfer?.files || []); }
      function removeImg(i) { const n = [...imgFiles]; n.splice(i, 1); setImgFiles(n); }

      function openLightbox(images, index = 0) { setLb({ open: true, images, index }); }
      function closeLightbox() { setLb({ open: false, images: [], index: 0 }); }
      function setLightboxIndex(index) { setLb((state) => ({ ...state, index })); }

      useEffect(() => { if (initialActiveId) setActiveId(initialActiveId); }, [initialActiveId]);

      async function fetchConvos() {
        try {
          const list = await api.listConversations({ silent: true });
          setConvos(list);
          onConversationsUpdate?.(list);
        } catch (_) {}
      }

      async function fetchMsgs({ silent = false } = {}) {
        if (!activeId) {
          setMsgs([]);
          setLoadingMsgs(false);
          return;
        }
        if (!silent) setLoadingMsgs(true);
        try {
          const arr = await api.getMessages(activeId, { silent: true });
          setMsgs(arr);
          if (arr.length) onSeenChange?.(activeId, arr[arr.length - 1].id);
        } catch {}
        setLoadingMsgs(false);
      }

      async function deleteConvo(id) {
        if (!id) return;
        const ok = confirm('Delete this conversation from your inbox? The other participant will keep the messages.');
        if (!ok) return;
        try {
          await api.deleteConversation(id);
          if (activeId === id) setActiveId(null);
          setMsgs([]);
          await fetchConvos();
        } catch (e) { alert(e?.message || 'Delete failed'); }
      }

      useEffect(() => { fetchConvos(); }, []);
      useEffect(() => { fetchMsgs(); }, [activeId]);

      useEffect(() => {
        if (msgs.length > 0 && isAtBottom) {
          setTimeout(() => {
            if (msgsContainerRef.current) {
              msgsContainerRef.current.scrollTop = msgsContainerRef.current.scrollHeight;
            }
          }, 50);
        }
      }, [msgs, isAtBottom]);

      async function send() {
        const bodyTrim = (input || '').trim();
        if (!bodyTrim && imgFiles.length === 0) return;

        const urls = [];
        for (const f of imgFiles) {
          const url = await uploadOneMessageImage(f);
          urls.push(url);
        }

        let resp;
        try {
          resp = await api.sendMessage(activeId, bodyTrim, urls);
        } catch (e) {
          alert(e?.message || 'Send failed');
          return;
        }

        if (resp?.other_user_deleted) {
          alert('Heads up: This user deleted the conversation. They may not see your new message.');
        }

        setInput('');
        setImgFiles([]);
        await fetchMsgs({ silent: true });
        await fetchConvos();

        setTimeout(() => {
          if (msgsContainerRef.current) {
            msgsContainerRef.current.scrollTop = msgsContainerRef.current.scrollHeight;
          }
        }, 100);
      }

      async function revealPaypal() {
        if (!activeId) return;
        if (!user?.paypal_email) { alert('Add your PayPal email in Profile first.'); return; }
        const msg = `My payment info: ${user.paypal_email}`;
        let resp;
        try {
          resp = await api.sendMessage(activeId, msg, []);
        } catch (e) {
          alert(e?.message || 'Send failed');
          return;
        }

        if (resp?.other_user_deleted) {
          alert('Heads up: This user deleted the conversation. They may not see your new message.');
        }
        await fetchMsgs({ silent: true });
        await fetchConvos();
      }

      async function sendLocationPreset() {
        if (!activeId) return false;
        const saved = (user?.location_preset || '').trim();
        if (!saved) { alert('Add your address in Profile first.'); return false; }
        const msg = `My address: ${saved}`;
        let resp;
        try {
          resp = await api.sendMessage(activeId, msg, []);
        } catch (e) {
          alert(e?.message || 'Send failed');
          return false;
        }

        if (resp?.other_user_deleted) {
          alert('Heads up: This user deleted the conversation. They may not see your new message.');
        }

        await fetchMsgs({ silent: true });
        await fetchConvos();

        setTimeout(() => {
          if (msgsContainerRef.current) {
            msgsContainerRef.current.scrollTop = msgsContainerRef.current.scrollHeight;
          }
        }, 100);

        return true;
      }

      const seenMap = loadSeen(user?.id);
      const convosDecorated = (convos || [])
        .map((c) => {
          const unread = !!(
            c.last_message_id && c.last_message_sender_id &&
            c.last_message_sender_id !== user?.id &&
            (!seenMap[c.id] || seenMap[c.id] < c.last_message_id)
          );
          const unreadFromAdmin = unread && !!c.last_message_is_admin;
          return { ...c, _unread: unread, _unreadAdmin: unreadFromAdmin };
        })
        .sort((a, b) => {
          const ua = a._unread ? 1 : 0, ub = b._unread ? 1 : 0;
          if (ub - ua) return ub - ua;
          const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
          const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
          return tb - ta;
        });

      const active = (convosDecorated.find((c) => c.id === activeId) || (convos || []).find((c) => c.id === activeId)) || null;

      const locationPreset = (user?.location_preset || '').trim();

      const canRevealPaypal = !!(
        active &&
        active.listing_id &&
        active.listing_owner_id &&
        user?.id === active.listing_owner_id &&
        user?.paypal_email
      );

      const canSendLocation = !!locationPreset;

      const markAllAsRead = useCallback(() => {
        if (!user?.id || !convos || convos.length === 0) return;
        const seen = loadSeen(user.id) || {};
        let changed = false;
        for (const c of convos) {
          if (c.last_message_id && (!seen[c.id] || seen[c.id] < c.last_message_id)) {
            seen[c.id] = c.last_message_id;
            changed = true;
          }
        }
        if (changed) {
          saveSeen(user.id, seen);
          // Trigger re-render by re-fetching convos
          fetchConvos();
          onSeenChange?.(null, null);
        }
      }, [user?.id, convos, loadSeen, saveSeen, fetchConvos, onSeenChange]);

      return {
        user,
        convosDecorated,
        active,
        convos,
        activeId,
        setActiveId,
        msgs,
        loadingMsgs,
        input,
        setInput,
        imgPreviews,
        cameraFileRef,
        libraryFileRef,
        dropRef,
        msgsContainerRef,
        formatMessageTimestamp,
        checkIfAtBottom,
        removeImg,
        onComposerPaste,
        pickImgs,
        onDragOver,
        onDrop,
        send,
        revealPaypal,
        canRevealPaypal,
        canSendLocation,
        locationPreset,
        sendLocationPreset,
        deleteConvo,
        openLightbox,
        closeLightbox,
        setLightboxIndex,
        lb,
        markAllAsRead
      };
    }

    function useMessageActions({
      user,
      onConversationOpened,
      onTabChange,
      onSellerCleared,
      recomputeUnread
    }) {
      const startMessage = useCallback(async (item) => {
        if (!item) return;
        if (!user) { alert('Log in to message a seller.'); return; }
        if (user.id === item?.user_id) { alert('This is your listing.'); return; }

        if (typeof onSellerCleared === 'function') {
          onSellerCleared();
        }

        try {
          const convo = await api.ensureConversation({
            with_user_id: item.user_id,
            listing_id: item.id
          });
          if (typeof onConversationOpened === 'function') {
            onConversationOpened(convo?.id ?? null);
          }
          if (typeof onTabChange === 'function') {
            onTabChange('messages');
          }
        } catch (err) {
          alert(err?.message || 'Failed to open conversation.');
        }
      }, [user, onSellerCleared, onConversationOpened, onTabChange]);

      const startDirectMessage = useCallback(async (userId) => {
        if (!user) { alert('Log in to message users.'); return; }
        const targetId = Number(userId);
        if (!Number.isFinite(targetId) || targetId <= 0) return;
        if (targetId === user.id) return;

        if (typeof onSellerCleared === 'function') {
          onSellerCleared();
        }

        try {
          const convo = await api.ensureConversation({ with_user_id: targetId });
          if (typeof onConversationOpened === 'function') {
            onConversationOpened(convo?.id ?? null);
          }
          if (typeof onTabChange === 'function') {
            onTabChange('messages');
          }
        } catch (err) {
          alert(err?.message || 'Failed to open conversation.');
        }
      }, [user, onSellerCleared, onConversationOpened, onTabChange]);

      const handleSeen = useCallback((convoId, lastMsgId) => {
        if (!user) return;

        // If called with null/null (from markAllAsRead), just recompute unread
        if (!convoId || !lastMsgId) {
          if (typeof recomputeUnread === 'function') {
            setTimeout(() => {
              Promise.resolve()
                .then(() => recomputeUnread())
                .catch(() => {});
            }, 0);
          }
          return;
        }

        const seen = loadSeen(user.id) || {};
        if (!seen[convoId] || seen[convoId] < lastMsgId) {
          seen[convoId] = lastMsgId;
          saveSeen(user.id, seen);
          if (typeof recomputeUnread === 'function') {
            setTimeout(() => {
              Promise.resolve()
                .then(() => recomputeUnread())
                .catch(() => {});
            }, 0);
          }
        }
      }, [user, loadSeen, saveSeen, recomputeUnread]);

      return {
        startMessage,
        startDirectMessage,
        handleSeen
      };
    }

    function MessagesPanel(props) {
      const { user, onViewProfile } = props;
      if (!user) return H('div', { className: 'muted' }, 'Please log in to view messages.');

      const isMobile = isMobileDevice();

      const {
        convosDecorated,
        active,
        activeId,
        setActiveId,
        msgs,
        loadingMsgs,
        imgPreviews,
        removeImg,
        msgsContainerRef,
        formatMessageTimestamp,
        checkIfAtBottom,
        openLightbox,
        lb,
        closeLightbox,
        setLightboxIndex,
        canRevealPaypal,
        revealPaypal,
        onComposerPaste,
        pickImgs,
        cameraFileRef,
        libraryFileRef,
        dropRef,
        onDragOver,
        onDrop,
        send,
        input,
        setInput,
        deleteConvo,
        user: currentUser,
        canSendLocation,
        locationPreset,
        sendLocationPreset,
        markAllAsRead
      } = useMessagesPanelState(props);

      const [confirmLocationOpen, setConfirmLocationOpen] = useState(false);
      const [confirmPaypalOpen, setConfirmPaypalOpen] = useState(false);
      const [showConversationOnMobile, setShowConversationOnMobile] = useState(false);
      const mobileInputRef = useRef(null);

      useEffect(() => {
        if (activeId && isMobile) {
          setShowConversationOnMobile(true);
        }
      }, [activeId, isMobile]);

      const handleRequestLocation = useCallback(() => {
        if (!canSendLocation) {
          alert('Add your address in Profile first.');
          return;
        }
        setConfirmLocationOpen(true);
      }, [canSendLocation]);

      const handleCloseLocationConfirm = useCallback(() => {
        setConfirmLocationOpen(false);
      }, []);

      const handleConfirmLocation = useCallback(async () => {
        setConfirmLocationOpen(false);
        await sendLocationPreset();
      }, [sendLocationPreset]);

      const handleRequestPaypal = useCallback(() => {
        if (!canRevealPaypal) {
          alert('Add your PayPal email in Profile first.');
          return;
        }
        setConfirmPaypalOpen(true);
      }, [canRevealPaypal]);

      const handleClosePaypalConfirm = useCallback(() => {
        setConfirmPaypalOpen(false);
      }, []);

      const handleConfirmPaypal = useCallback(async () => {
        await revealPaypal();
        setConfirmPaypalOpen(false);
      }, [revealPaypal]);

      const handleSelectConversation = useCallback((id) => {
        setActiveId(id);
        setShowConversationOnMobile(true);
      }, [setActiveId]);

      const handleBackToList = useCallback(() => {
        setShowConversationOnMobile(false);
      }, []);

      // Thread content - reusable for both desktop and mobile portal
      const threadContent = H(React.Fragment, null,
        // Back button only on mobile
        isMobile && activeId && H('div', {
          className: 'messages-thread-header',
          style: { marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #e5e7eb' }
        },
          H('button', {
            onClick: handleBackToList,
            style: {
              background: 'transparent',
              border: 'none',
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontWeight: 600,
              color: '#2563eb'
            }
          }, '← Back to conversations')
        ),
        !activeId && H('div', { className: 'muted' }, 'Select a conversation'),
        (activeId && loadingMsgs) && H('div', {
          className: 'muted',
          style: { padding: '20px', textAlign: 'center' }
        }, 'Loading messages...'),
        (activeId && !loadingMsgs) && H(MessagesThread, {
          messages: msgs,
          user: currentUser,
          ImageWithSkeleton,
          openLightbox,
          msgsContainerRef,
          onScroll: checkIfAtBottom,
          formatMessageTimestamp,
          otherUserPicture: active?.other_user_profile_picture,
          otherUserId: active?.other_user_id,
          otherUserUsername: active?.other_user_username,
          onViewProfile
        }),
        (activeId && imgPreviews.length > 0) && H(ImagePreviewStrip, {
          previews: imgPreviews,
          onRemove: removeImg,
          ImageWithSkeleton
        }),
        activeId && H(MessageComposer, {
          input,
          setInput,
          onComposerPaste,
          onPickImages: pickImgs,
          cameraFileRef,
          libraryFileRef,
          dropRef,
          onDragOver,
          onDrop,
          canRevealPaypal,
          onRevealPaypal: handleRequestPaypal,
          canSendLocation,
          onRequestLocation: handleRequestLocation,
          onSend: send,
          inputRef: mobileInputRef,
          otherUserDeleted: active?.other_user_deleted,
          hasImages: imgPreviews.length > 0
        }),
        H(Lightbox, {
          open: lb.open,
          images: lb.images,
          fallback: lb.images,
          loading: false,
          index: lb.index,
          onClose: closeLightbox,
          onIndex: setLightboxIndex
        }),
        H(ConfirmLocationModal, {
          open: confirmLocationOpen,
          address: locationPreset,
          onCancel: handleCloseLocationConfirm,
          onConfirm: handleConfirmLocation
        }),
        H(ConfirmPaypalModal, {
          open: confirmPaypalOpen,
          email: currentUser?.paypal_email,
          onCancel: handleClosePaypalConfirm,
          onConfirm: handleConfirmPaypal
        })
      );

      // Refs for portal elements
      const portalRef = useRef(null);
      const composerWrapperRef = useRef(null);
      const messagesAreaRef = useRef(null);

      // Handle iOS keyboard - adjust portal padding to keep composer visible
      useEffect(() => {
        if (!isMobile || !showConversationOnMobile) return;

        let rafId = null;

        const adjustForKeyboard = () => {
          if (!window.visualViewport || !portalRef.current) return;

          const vv = window.visualViewport;
          // Calculate how much the viewport has shrunk (keyboard height)
          const keyboardHeight = window.innerHeight - vv.height;

          if (keyboardHeight > 100) {
            // Keyboard is open - add padding to keep composer above keyboard
            portalRef.current.style.paddingBottom = `${keyboardHeight + 12}px`;
          } else {
            // Keyboard is closed - use safe area padding
            portalRef.current.style.paddingBottom = '';
          }
        };

        const onViewportChange = () => {
          // Cancel any pending frame
          if (rafId) cancelAnimationFrame(rafId);
          // Use RAF for smoother updates
          rafId = requestAnimationFrame(adjustForKeyboard);
        };

        if (window.visualViewport) {
          window.visualViewport.addEventListener('resize', onViewportChange);
          window.visualViewport.addEventListener('scroll', onViewportChange);
          // Initial check
          adjustForKeyboard();
        }

        return () => {
          if (rafId) cancelAnimationFrame(rafId);
          if (window.visualViewport) {
            window.visualViewport.removeEventListener('resize', onViewportChange);
            window.visualViewport.removeEventListener('scroll', onViewportChange);
          }
        };
      }, [isMobile, showConversationOnMobile]);

      // Build mobile-specific thread content with refs for keyboard handling
      const mobileThreadContent = H(React.Fragment, null,
        // Back button
        activeId && H('div', {
          className: 'messages-thread-header',
          style: { marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #e5e7eb', flexShrink: 0 }
        },
          H('button', {
            onClick: handleBackToList,
            style: {
              background: 'transparent',
              border: 'none',
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontWeight: 600,
              color: '#2563eb'
            }
          }, '← Back to conversations')
        ),
        !activeId && H('div', { className: 'muted' }, 'Select a conversation'),
        // Messages area wrapper (will have margin adjusted when keyboard opens)
        H('div', {
          ref: messagesAreaRef,
          style: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }
        },
          (activeId && loadingMsgs) && H('div', {
            className: 'muted',
            style: { padding: '20px', textAlign: 'center' }
          }, 'Loading messages...'),
          (activeId && !loadingMsgs) && H(MessagesThread, {
            messages: msgs,
            user: currentUser,
            ImageWithSkeleton,
            openLightbox,
            msgsContainerRef,
            onScroll: checkIfAtBottom,
            formatMessageTimestamp,
            otherUserPicture: active?.other_user_profile_picture,
            otherUserId: active?.other_user_id,
            otherUserUsername: active?.other_user_username,
            onViewProfile
          })
        ),
        // Composer wrapper (will be repositioned when keyboard opens)
        H('div', {
          ref: composerWrapperRef,
          style: { flexShrink: 0 }
        },
          (activeId && imgPreviews.length > 0) && H(ImagePreviewStrip, {
            previews: imgPreviews,
            onRemove: removeImg,
            ImageWithSkeleton
          }),
          activeId && H(MessageComposer, {
            input,
            setInput,
            onComposerPaste,
            onPickImages: pickImgs,
            cameraFileRef,
            libraryFileRef,
            dropRef,
            onDragOver,
            onDrop,
            canRevealPaypal,
            onRevealPaypal: handleRequestPaypal,
            canSendLocation,
            onRequestLocation: handleRequestLocation,
            onSend: send,
            inputRef: mobileInputRef,
            otherUserDeleted: active?.other_user_deleted,
            hasImages: imgPreviews.length > 0
          })
        ),
        // Modals
        H(Lightbox, {
          open: lb.open,
          images: lb.images,
          fallback: lb.images,
          loading: false,
          index: lb.index,
          onClose: closeLightbox,
          onIndex: setLightboxIndex
        }),
        H(ConfirmLocationModal, {
          open: confirmLocationOpen,
          address: locationPreset,
          onCancel: handleCloseLocationConfirm,
          onConfirm: handleConfirmLocation
        }),
        H(ConfirmPaypalModal, {
          open: confirmPaypalOpen,
          email: currentUser?.paypal_email,
          onCancel: handleClosePaypalConfirm,
          onConfirm: handleConfirmPaypal
        })
      );

      // Mobile portal - full screen (dashboard is hidden via CSS when portal is present)
      const mobileThreadPortal = isMobile && showConversationOnMobile && ReactDOM.createPortal(
        H('div', {
          ref: portalRef,
          className: 'mobile-messages-thread-portal',
          style: {
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            paddingTop: 'env(safe-area-inset-top, 0px)',
            paddingLeft: 12,
            paddingRight: 12,
            paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
            zIndex: 999,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            WebkitOverflowScrolling: 'touch'
          }
        }, mobileThreadContent),
        document.body
      );

      return H('div', { className: 'messages-panel' },
        H(ConversationsSidebar, {
          conversations: convosDecorated,
          activeId,
          onSelectConversation: handleSelectConversation,
          onDeleteConversation: deleteConvo,
          onMarkAllRead: markAllAsRead,
          className: (isMobile && showConversationOnMobile) ? 'hide-on-mobile' : ''
        }),
        // Desktop thread only (mobile uses portal instead)
        !isMobile && H('section', {
          className: 'card col messages-thread-shell',
          style: { padding: 12 }
        }, threadContent),
        // Mobile portal
        mobileThreadPortal
      );
    }

    return {
      MessagesPanel,
      useMessagesPanelState,
      MessageComposer,
      ConfirmLocationModal,
      ConfirmPaypalModal,
      ImagePreviewStrip,
      MessagesThread,
      ConversationsSidebar,
      useMessageActions
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.messages = {
    createMessagesFeature
  };
})();
