(() => {
  function createProfilePictureUploadComponents({ React, ReactDOM, api, uploads = {} } = {}) {
    if (!React || typeof React.createElement !== 'function') {
      throw new Error('ProfilePictureUpload components require React.');
    }
    if (!ReactDOM || typeof ReactDOM.createPortal !== 'function') {
      throw new Error('ProfilePictureUpload components require ReactDOM.');
    }

    const H = React.createElement;
    const { useState, useRef, useCallback, useEffect } = React;
    const { uploadOneMessageImage } = uploads;

    function ProfilePictureUploadModal({ open, onClose, onUploadComplete, currentPictureUrl, avatarBorderColor, avatarBorderStyle, onChangeBorderColor, onChangeBorderStyle, onSave, isPremium }) {
      const [selectedFile, setSelectedFile] = useState(null);
      const [previewUrl, setPreviewUrl] = useState(null);
      const [uploading, setUploading] = useState(false);
      const [error, setError] = useState(null);
      const [zoom, setZoom] = useState(1);
      const [position, setPosition] = useState({ x: 0, y: 0 });
      const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
      const [isDragging, setIsDragging] = useState(false);
      const fileInputRef = useRef(null);
      const canvasRef = useRef(null);
      const imageRef = useRef(null);
      const containerRef = useRef(null);
      const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
      const pinchStartRef = useRef({ distance: 0, zoom: 1 });

      // Detect dark mode
      const isDarkMode = typeof document !== 'undefined' &&
        (document.documentElement.getAttribute('data-theme') === 'dark' ||
        localStorage.getItem('theme') === 'dark');

      // Detect if desktop (no touch support or wide screen)
      const isDesktop = typeof window !== 'undefined' &&
        (!('ontouchstart' in window) || window.innerWidth >= 1024);

      // Theme colors
      const theme = {
        bg: isDarkMode ? '#1e293b' : '#fff',
        bgSecondary: isDarkMode ? '#334155' : '#f8fafc',
        bgTertiary: isDarkMode ? '#475569' : '#f1f5f9',
        border: isDarkMode ? 'rgba(255,255,255,0.1)' : '#e5e7eb',
        text: isDarkMode ? '#f1f5f9' : '#0f172a',
        textSecondary: isDarkMode ? '#94a3b8' : '#64748b',
        textMuted: isDarkMode ? '#64748b' : '#94a3b8',
        sliderBg: isDarkMode ? '#475569' : '#e2e8f0',
        sliderThumb: isDarkMode ? '#3b82f6' : '#2563eb',
        errorBg: isDarkMode ? 'rgba(239, 68, 68, 0.15)' : '#fee2e2',
        errorText: isDarkMode ? '#f87171' : '#991b1b'
      };

      const borderColorValue = typeof avatarBorderColor === 'string' && avatarBorderColor.trim()
        ? avatarBorderColor.trim()
        : '#ffffff';
      const borderStyleValue = avatarBorderStyle === 'dashed' ? 'dashed' : 'solid';

      const CROP_SIZE = 280; // Size of the crop area in the UI
      const MIN_ZOOM = 0.25;
      const MAX_ZOOM = 5;

      useEffect(() => {
        if (!open) {
          setSelectedFile(null);
          setPreviewUrl(null);
          setError(null);
          setZoom(1);
          setPosition({ x: 0, y: 0 });
          setImageDimensions({ width: 0, height: 0 });
        }
      }, [open]);

      const handleFileSelect = useCallback((evt) => {
        const file = evt.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
          setError('Please select an image file');
          return;
        }

        if (file.size > 10 * 1024 * 1024) {
          setError('Image must be less than 10MB');
          return;
        }

        setSelectedFile(file);
        setError(null);
        setZoom(1);
        setPosition({ x: 0, y: 0 });

        const reader = new FileReader();
        reader.onload = (e) => {
          setPreviewUrl(e.target.result);
        };
        reader.readAsDataURL(file);
      }, []);

      const handleImageLoad = useCallback(() => {
        if (!imageRef.current) return;
        const img = imageRef.current;
        setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
        // Center the image initially
        setPosition({ x: 0, y: 0 });
        // Calculate initial zoom to fit the smaller dimension
        const minDim = Math.min(img.naturalWidth, img.naturalHeight);
        const initialZoom = CROP_SIZE / minDim;
        setZoom(Math.max(1, initialZoom));
      }, []);

      const clampPosition = useCallback((x, y, currentZoom) => {
        if (!imageDimensions.width || !imageDimensions.height) return { x: 0, y: 0 };

        const scaledWidth = imageDimensions.width * currentZoom;
        const scaledHeight = imageDimensions.height * currentZoom;

        const maxX = Math.max(0, (scaledWidth - CROP_SIZE) / 2);
        const maxY = Math.max(0, (scaledHeight - CROP_SIZE) / 2);

        return {
          x: Math.max(-maxX, Math.min(maxX, x)),
          y: Math.max(-maxY, Math.min(maxY, y))
        };
      }, [imageDimensions]);

      const handlePointerDown = useCallback((evt) => {
        // Don't call preventDefault here - use touch-action: none CSS instead
        setIsDragging(true);
        const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
        const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
        dragStartRef.current = { x: clientX, y: clientY, posX: position.x, posY: position.y };

        // Handle pinch-to-zoom start
        if (evt.touches && evt.touches.length === 2) {
          const dx = evt.touches[0].clientX - evt.touches[1].clientX;
          const dy = evt.touches[0].clientY - evt.touches[1].clientY;
          pinchStartRef.current = {
            distance: Math.sqrt(dx * dx + dy * dy),
            zoom: zoom
          };
        }
      }, [position, zoom]);

      const handlePointerMove = useCallback((evt) => {
        if (!isDragging) return;
        evt.preventDefault();

        // Handle pinch-to-zoom
        if (evt.touches && evt.touches.length === 2) {
          const dx = evt.touches[0].clientX - evt.touches[1].clientX;
          const dy = evt.touches[0].clientY - evt.touches[1].clientY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const scale = distance / pinchStartRef.current.distance;
          const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchStartRef.current.zoom * scale));
          setZoom(newZoom);
          setPosition(prev => clampPosition(prev.x, prev.y, newZoom));
          return;
        }

        const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
        const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
        const deltaX = clientX - dragStartRef.current.x;
        const deltaY = clientY - dragStartRef.current.y;
        const newPos = clampPosition(
          dragStartRef.current.posX + deltaX,
          dragStartRef.current.posY + deltaY,
          zoom
        );
        setPosition(newPos);
      }, [isDragging, zoom, clampPosition]);

      const handlePointerUp = useCallback(() => {
        setIsDragging(false);
      }, []);

      useEffect(() => {
        if (isDragging) {
          document.addEventListener('mousemove', handlePointerMove);
          document.addEventListener('mouseup', handlePointerUp);
          document.addEventListener('touchmove', handlePointerMove, { passive: false });
          document.addEventListener('touchend', handlePointerUp);
          return () => {
            document.removeEventListener('mousemove', handlePointerMove);
            document.removeEventListener('mouseup', handlePointerUp);
            document.removeEventListener('touchmove', handlePointerMove);
            document.removeEventListener('touchend', handlePointerUp);
          };
        }
      }, [isDragging, handlePointerMove, handlePointerUp]);

      const handleZoomChange = useCallback((newZoom) => {
        const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
        setZoom(clampedZoom);
        // Re-clamp position with new zoom
        setPosition(prev => clampPosition(prev.x, prev.y, clampedZoom));
      }, [clampPosition]);

      const handleUpload = useCallback(async () => {
        if (!selectedFile || !canvasRef.current || !imageRef.current) return;

        setUploading(true);
        setError(null);

        try {
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          const img = imageRef.current;

          // Output size
          canvas.width = 400;
          canvas.height = 400;

          // Calculate the crop area in original image coordinates
          const scaledWidth = imageDimensions.width * zoom;
          const scaledHeight = imageDimensions.height * zoom;

          // Center of the crop area in scaled coordinates
          const centerX = scaledWidth / 2 - position.x;
          const centerY = scaledHeight / 2 - position.y;

          // Convert to original image coordinates
          const srcCenterX = centerX / zoom;
          const srcCenterY = centerY / zoom;
          const srcSize = CROP_SIZE / zoom;

          const srcX = srcCenterX - srcSize / 2;
          const srcY = srcCenterY - srcSize / 2;

          // Draw the cropped image
          ctx.drawImage(
            img,
            srcX,
            srcY,
            srcSize,
            srcSize,
            0,
            0,
            400,
            400
          );

          const blob = await new Promise((resolve) => {
            canvas.toBlob(resolve, 'image/jpeg', 0.9);
          });

          const file = new File([blob], 'profile-picture.jpg', { type: 'image/jpeg' });
          const url = await uploadOneMessageImage(file);
          const result = await api.updateProfilePicture(url);

          if (result?.error === 'moderation_flagged') {
            setError('This image was flagged by our content moderation system and cannot be used.');
            return;
          }
          if (result?.error) {
            setError(result.error);
            return;
          }

          onUploadComplete?.(url);
          onClose?.();
        } catch (err) {
          console.error('Upload failed:', err);
          const msg = err?.message || String(err);
          if (msg.includes('moderation_flagged')) {
            setError('This image was flagged by our content moderation system and cannot be used.');
          } else {
            setError(msg || 'Upload failed');
          }
        } finally {
          setUploading(false);
        }
      }, [selectedFile, zoom, position, imageDimensions, onUploadComplete, onClose]);

      const handleRemove = useCallback(async () => {
        if (!confirm('Remove your profile picture?')) return;

        setUploading(true);
        setError(null);

        try {
          await api.updateProfilePicture('');
          onUploadComplete?.('');
          onClose?.();
        } catch (err) {
          console.error('Remove failed:', err);
          setError(err.message || 'Remove failed');
        } finally {
          setUploading(false);
        }
      }, [onUploadComplete, onClose]);

      if (!open) return null;

      const modalContent = H('div', {
        className: 'modal-overlay',
        onClick: (e) => {
          if (e.target.classList.contains('modal-overlay')) {
            onClose?.();
          }
        },
        style: {
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          zIndex: 9999
        }
      },
        H('div', {
          className: 'modal-content',
          style: {
            background: theme.bg,
            borderRadius: 16,
            maxWidth: 440,
            width: '100%',
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 25px 50px rgba(0, 0, 0, 0.25)'
          }
        },
          // Header
          H('div', {
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px 20px',
              borderBottom: `1px solid ${theme.border}`
            }
          },
            H('h2', { style: { margin: 0, fontSize: 18, fontWeight: 700, color: theme.text } }, 'Profile Picture'),
            H('button', {
              onClick: onClose,
              style: {
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: 'none',
                background: theme.bgTertiary,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: theme.textSecondary
              }
            },
              // X icon SVG
              H('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                H('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
                H('line', { x1: 6, y1: 6, x2: 18, y2: 18 })
              )
            )
          ),

          // Body
          H('div', { style: { padding: 20 } },
            error && H('div', {
              style: {
                padding: 12,
                background: theme.errorBg,
                color: theme.errorText,
                borderRadius: 8,
                marginBottom: 16,
                fontSize: 14
              }
            }, error),

            // File selection view - clickable picture to change
            !previewUrl && H('div', { style: { textAlign: 'center' } },
              // Current picture preview (clickable)
              H('div', {
                onClick: () => fileInputRef.current?.click(),
                style: {
                  width: 120,
                  height: 120,
                  borderRadius: '50%',
                  margin: '0 auto 16px',
                  border: `4px ${borderStyleValue} ${borderColorValue}`,
                  overflow: 'hidden',
                  background: theme.bgTertiary,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  position: 'relative'
                }
              },
                currentPictureUrl
                  ? H('img', {
                      src: currentPictureUrl,
                      alt: 'Current profile picture',
                      style: { width: '100%', height: '100%', objectFit: 'cover' }
                    })
                  : H('svg', { width: 48, height: 48, viewBox: '0 0 24 24', fill: 'none', stroke: theme.textMuted, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
                      H('path', { d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }),
                      H('circle', { cx: 12, cy: 7, r: 4 })
                    ),
                // Overlay hint
                H('div', {
                  style: {
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(0, 0, 0, 0.5)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 600,
                    gap: 4
                  }
                },
                  // Camera icon SVG
                  H('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                    H('path', { d: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z' }),
                    H('circle', { cx: 12, cy: 13, r: 4 })
                  ),
                  currentPictureUrl ? 'Tap to change' : 'Tap to add'
                )
              ),
              H('input', {
                ref: fileInputRef,
                type: 'file',
                accept: 'image/*',
                onChange: handleFileSelect,
                style: { display: 'none' }
              })
            ),

            // Crop view
            previewUrl && H('div', null,
              // Crop area
              H('div', {
                ref: containerRef,
                style: {
                  position: 'relative',
                  width: CROP_SIZE,
                  height: CROP_SIZE,
                  margin: '0 auto 16px',
                  borderRadius: '50%',
                  overflow: 'hidden',
                  background: '#000',
                  cursor: isDragging ? 'grabbing' : 'grab',
                  touchAction: 'none'
                },
                onMouseDown: handlePointerDown,
                onTouchStart: handlePointerDown
              },
                H('img', {
                  ref: imageRef,
                  src: previewUrl,
                  alt: 'Preview',
                  onLoad: handleImageLoad,
                  draggable: false,
                  style: {
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px)) scale(${zoom})`,
                    transformOrigin: 'center',
                    maxWidth: 'none',
                    pointerEvents: 'none',
                    userSelect: 'none'
                  }
                }),
                // Overlay hint (mobile only - shows "Pinch to zoom")
                !isDesktop && H('div', {
                  style: {
                    position: 'absolute',
                    bottom: 12,
                    left: 0,
                    right: 0,
                    textAlign: 'center',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 500,
                    textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                    pointerEvents: 'none',
                    opacity: isDragging ? 0 : 0.8
                  }
                }, 'Pinch to zoom')
              ),

              // Zoom slider (desktop only)
              isDesktop && H('div', {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '0 20px',
                  marginBottom: 20
                }
              },
                // Zoom out icon (minus in circle)
                H('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: theme.textSecondary, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                  H('circle', { cx: 11, cy: 11, r: 8 }),
                  H('line', { x1: 8, y1: 11, x2: 14, y2: 11 })
                ),
                H('input', {
                  type: 'range',
                  min: String(MIN_ZOOM),
                  max: String(MAX_ZOOM),
                  step: '0.05',
                  value: zoom,
                  onChange: (e) => handleZoomChange(parseFloat(e.target.value)),
                  style: {
                    flex: 1,
                    height: 6,
                    borderRadius: 3,
                    appearance: 'none',
                    background: theme.sliderBg,
                    cursor: 'pointer'
                  }
                }),
                // Zoom in icon (plus in circle)
                H('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: theme.textSecondary, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                  H('circle', { cx: 11, cy: 11, r: 8 }),
                  H('line', { x1: 11, y1: 8, x2: 11, y2: 14 }),
                  H('line', { x1: 8, y1: 11, x2: 14, y2: 11 })
                )
              ),

              // Hidden canvas for cropping
              H('canvas', {
                ref: canvasRef,
                style: { display: 'none' }
              }),

              // Action buttons
              H('div', { style: { display: 'flex', gap: 12 } },
                H('button', {
                  onClick: () => {
                    setPreviewUrl(null);
                    setSelectedFile(null);
                    setZoom(1);
                    setPosition({ x: 0, y: 0 });
                  },
                  disabled: uploading,
                  style: {
                    flex: 1,
                    padding: '14px 20px',
                    background: theme.bgTertiary,
                    color: theme.text,
                    border: 'none',
                    borderRadius: 12,
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: uploading ? 'not-allowed' : 'pointer'
                  }
                }, 'Cancel'),
                H('button', {
                  onClick: handleUpload,
                  disabled: uploading,
                  style: {
                    flex: 1,
                    padding: '14px 20px',
                    background: uploading ? theme.textMuted : '#2563eb',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 12,
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: uploading ? 'not-allowed' : 'pointer'
                  }
                }, uploading ? 'Uploading...' : 'Save')
              )
            )
          ),

          // Border customization (only show when not cropping)
          !previewUrl && avatarBorderColor !== undefined && avatarBorderStyle !== undefined && H('div', {
            style: {
              padding: '16px 20px',
              borderTop: `1px solid ${theme.border}`,
              background: theme.bgSecondary
            }
          },
            H('div', {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12
              }
            },
              H('span', { style: { fontWeight: 600, fontSize: 14, color: theme.text } }, 'Border Style'),
              !isPremium && H('span', {
                style: {
                  fontSize: 11,
                  padding: '2px 8px',
                  background: isDarkMode ? 'rgba(99, 102, 241, 0.2)' : '#dbeafe',
                  color: isDarkMode ? '#a5b4fc' : '#1e40af',
                  borderRadius: 10,
                  fontWeight: 600
                }
              }, 'Premium')
            ),
            H('div', {
              style: {
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
                marginBottom: 12
              }
            },
              H('label', { style: { display: 'grid', gap: 4 } },
                H('span', { style: { fontSize: 12, color: theme.textSecondary } }, 'Color'),
                H('input', {
                  type: 'color',
                  value: borderColorValue,
                  onChange: (e) => onChangeBorderColor?.(e.target.value),
                  disabled: !isPremium,
                  style: {
                    width: '100%',
                    height: 40,
                    borderRadius: 8,
                    border: `1px solid ${theme.border}`,
                    cursor: isPremium ? 'pointer' : 'not-allowed',
                    opacity: isPremium ? 1 : 0.5,
                    background: theme.bg
                  }
                })
              ),
              H('label', { style: { display: 'grid', gap: 4 } },
                H('span', { style: { fontSize: 12, color: theme.textSecondary } }, 'Style'),
                H('select', {
                  value: borderStyleValue,
                  onChange: (e) => onChangeBorderStyle?.(e.target.value),
                  disabled: !isPremium,
                  style: {
                    width: '100%',
                    height: 40,
                    borderRadius: 8,
                    border: `1px solid ${theme.border}`,
                    padding: '0 12px',
                    cursor: isPremium ? 'pointer' : 'not-allowed',
                    opacity: isPremium ? 1 : 0.5,
                    background: theme.bg,
                    color: theme.text
                  }
                },
                  H('option', { value: 'solid' }, 'Solid'),
                  H('option', { value: 'dashed' }, 'Dashed')
                )
              )
            ),
            onSave && H('button', {
              onClick: async () => {
                await onSave();
                onClose?.();
              },
              disabled: !isPremium,
              style: {
                width: '100%',
                padding: '12px',
                background: isPremium ? '#2563eb' : theme.bgTertiary,
                color: isPremium ? '#fff' : theme.textMuted,
                border: 'none',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                cursor: isPremium ? 'pointer' : 'not-allowed'
              }
            }, 'Save')
          )
        )
      );

      return ReactDOM.createPortal(modalContent, document.body);
    }

    return { ProfilePictureUploadModal };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createProfilePictureUploadComponents };
  } else if (typeof window !== 'undefined') {
    window.ListItApp = window.ListItApp || {};
    window.ListItApp.components = window.ListItApp.components || {};
    window.ListItApp.components.profilePictureUpload = { createProfilePictureUploadComponents };
  }
})();
