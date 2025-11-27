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
      const [cropData, setCropData] = useState({ x: 0, y: 0, size: 100 });
      const [saving, setSaving] = useState(false);
      const fileInputRef = useRef(null);
      const canvasRef = useRef(null);
      const imageRef = useRef(null);

      const borderColorValue = typeof avatarBorderColor === 'string' && avatarBorderColor.trim()
        ? avatarBorderColor.trim()
        : '#ffffff';
      const borderStyleValue = avatarBorderStyle === 'dashed' ? 'dashed' : 'solid';

      useEffect(() => {
        if (!open) {
          setSelectedFile(null);
          setPreviewUrl(null);
          setError(null);
          setCropData({ x: 0, y: 0, size: 100 });
          setSaving(false);
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

        const reader = new FileReader();
        reader.onload = (e) => {
          setPreviewUrl(e.target.result);
        };
        reader.readAsDataURL(file);
      }, []);

      const handleUpload = useCallback(async () => {
        if (!selectedFile || !canvasRef.current || !imageRef.current) return;

        setUploading(true);
        setError(null);

        try {
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          const img = imageRef.current;

          canvas.width = 200;
          canvas.height = 200;

          const scale = img.naturalWidth / img.width;
          const cropX = cropData.x * scale;
          const cropY = cropData.y * scale;
          const cropSize = cropData.size * scale;

          ctx.drawImage(img, cropX, cropY, cropSize, cropSize, 0, 0, 200, 200);

          const blob = await new Promise((resolve) => {
            canvas.toBlob(resolve, 'image/jpeg', 0.9);
          });

          const file = new File([blob], 'profile-picture.jpg', { type: 'image/jpeg' });
          const url = await uploadOneMessageImage(file);

          await api.updateProfilePicture(url);

          onUploadComplete?.(url);
          onClose?.();
        } catch (err) {
          console.error('Upload failed:', err);
          setError(err.message || 'Upload failed');
        } finally {
          setUploading(false);
        }
      }, [selectedFile, cropData, onUploadComplete, onClose]);

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

      const handleSaveAndClose = useCallback(async () => {
        if (!onSave) return;
        setSaving(true);
        try {
          await onSave();
          onClose?.();
        } catch (err) {
          console.error('Save failed:', err);
          setError(err.message || 'Save failed');
        } finally {
          setSaving(false);
        }
      }, [onSave, onClose]);

      const handleImageLoad = useCallback(() => {
        if (!imageRef.current) return;
        const img = imageRef.current;
        const size = Math.min(img.width, img.height);
        const x = (img.width - size) / 2;
        const y = (img.height - size) / 2;
        setCropData({ x, y, size });
      }, []);

      const handleMouseDown = useCallback((evt) => {
        if (!imageRef.current) return;
        evt.preventDefault();
        const img = imageRef.current;
        const startX = evt.clientX;
        const startY = evt.clientY;
        const initialCrop = { ...cropData };

        const handleMouseMove = (e) => {
          const deltaX = e.clientX - startX;
          const deltaY = e.clientY - startY;
          const newX = Math.max(0, Math.min(img.width - cropData.size, initialCrop.x + deltaX));
          const newY = Math.max(0, Math.min(img.height - cropData.size, initialCrop.y + deltaY));
          setCropData({ ...cropData, x: newX, y: newY });
        };

        const handleMouseUp = () => {
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
      }, [cropData]);

      if (!open) return null;

      const modalContent = H('div', {
        className: 'modal open',
        onClick: (e) => {
          if (e.target.classList.contains('modal')) {
            onClose?.();
          }
        }
      },
        H('div', {
          className: 'modal-inner',
          style: {
            maxWidth: '340px',
            width: 'min(340px, 92vw)',
            padding: 20,
            background: '#fff',
            color: '#111',
            borderRadius: 16,
            position: 'relative'
          }
        },
          // Close button
          H('button', {
            onClick: onClose,
            style: {
              position: 'absolute',
              top: 12,
              right: 12,
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: 'none',
              background: '#f3f4f6',
              color: '#6b7280',
              fontSize: 16,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }
          }, '\u2715'),

          // Title
          H('h3', {
            style: { margin: '0 0 16px', fontSize: 17, fontWeight: 600 }
          }, 'Profile Picture'),

          // Error
          error && H('div', {
            style: { fontSize: 12, color: '#dc2626', marginBottom: 12 }
          }, error),

          // Not in crop mode
          !previewUrl && H('div', null,
            // Current picture
            H('div', {
              style: {
                width: 100,
                height: 100,
                borderRadius: '50%',
                margin: '0 auto 16px',
                overflow: 'hidden',
                background: '#f3f4f6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: `3px ${borderStyleValue} ${borderColorValue}`
              }
            },
              currentPictureUrl
                ? H('img', {
                  src: currentPictureUrl,
                  alt: 'Profile',
                  style: { width: '100%', height: '100%', objectFit: 'cover' }
                })
                : H('span', { style: { fontSize: 32, color: '#9ca3af' } }, '\uD83D\uDC64')
            ),

            // Hidden file input
            H('input', {
              ref: fileInputRef,
              type: 'file',
              accept: 'image/*',
              onChange: handleFileSelect,
              style: { display: 'none' }
            }),

            // Buttons
            H('div', { style: { display: 'flex', gap: 10, marginBottom: avatarBorderColor ? 16 : 0 } },
              H('button', {
                onClick: () => fileInputRef.current?.click(),
                style: {
                  flex: 1,
                  padding: '10px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#111',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer'
                }
              }, currentPictureUrl ? 'Change' : 'Upload'),
              currentPictureUrl && H('button', {
                onClick: handleRemove,
                disabled: uploading,
                style: {
                  flex: 1,
                  padding: '10px',
                  borderRadius: 8,
                  border: '1px solid #e5e7eb',
                  background: '#fff',
                  color: '#dc2626',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: uploading ? 'not-allowed' : 'pointer',
                  opacity: uploading ? 0.6 : 1
                }
              }, uploading ? 'Removing...' : 'Remove')
            ),

            // Avatar outline (premium)
            avatarBorderColor && avatarBorderStyle && H('div', {
              style: {
                padding: 12,
                background: '#f9fafb',
                borderRadius: 10,
                border: '1px solid #e5e7eb'
              }
            },
              H('div', {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 10
                }
              },
                H('span', { style: { fontSize: 13, fontWeight: 600, color: '#374151' } }, 'Outline'),
                !isPremium && H('span', {
                  style: {
                    fontSize: 10,
                    padding: '2px 6px',
                    background: '#fef3c7',
                    color: '#92400e',
                    borderRadius: 4,
                    fontWeight: 600
                  }
                }, 'Premium')
              ),
              H('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                H('input', {
                  type: 'color',
                  value: borderColorValue,
                  onChange: (evt) => onChangeBorderColor?.(evt.target.value),
                  disabled: !isPremium,
                  style: {
                    width: 36,
                    height: 36,
                    borderRadius: 6,
                    border: '1px solid #d1d5db',
                    cursor: isPremium ? 'pointer' : 'not-allowed',
                    opacity: isPremium ? 1 : 0.5,
                    padding: 2
                  }
                }),
                H('select', {
                  value: borderStyleValue,
                  onChange: (evt) => onChangeBorderStyle?.(evt.target.value),
                  disabled: !isPremium,
                  style: {
                    flex: 1,
                    height: 36,
                    padding: '0 8px',
                    border: '1px solid #d1d5db',
                    borderRadius: 6,
                    background: '#fff',
                    cursor: isPremium ? 'pointer' : 'not-allowed',
                    opacity: isPremium ? 1 : 0.5,
                    fontSize: 13
                  }
                },
                  H('option', { value: 'solid' }, 'Solid'),
                  H('option', { value: 'dashed' }, 'Dashed')
                ),
                H('button', {
                  onClick: handleSaveAndClose,
                  disabled: !isPremium || saving,
                  style: {
                    padding: '0 14px',
                    height: 36,
                    borderRadius: 6,
                    border: 'none',
                    background: (!isPremium || saving) ? '#e5e7eb' : '#111',
                    color: (!isPremium || saving) ? '#9ca3af' : '#fff',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: (!isPremium || saving) ? 'not-allowed' : 'pointer'
                  }
                }, saving ? '...' : 'Save')
              )
            )
          ),

          // Crop mode
          previewUrl && H('div', null,
            H('div', {
              style: {
                position: 'relative',
                width: '100%',
                marginBottom: 12,
                borderRadius: 10,
                overflow: 'hidden'
              }
            },
              H('img', {
                ref: imageRef,
                src: previewUrl,
                alt: 'Preview',
                onLoad: handleImageLoad,
                style: { width: '100%', display: 'block' }
              }),
              H('div', {
                onMouseDown: handleMouseDown,
                style: {
                  position: 'absolute',
                  left: cropData.x,
                  top: cropData.y,
                  width: cropData.size,
                  height: cropData.size,
                  border: '2px solid white',
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
                  borderRadius: '50%',
                  cursor: 'move'
                }
              },
                H('div', {
                  style: {
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: 10,
                    fontWeight: 600,
                    textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                    pointerEvents: 'none'
                  }
                }, 'Drag')
              )
            ),
            H('canvas', { ref: canvasRef, style: { display: 'none' } }),
            H('div', { style: { display: 'flex', gap: 10 } },
              H('button', {
                onClick: () => { setPreviewUrl(null); setSelectedFile(null); },
                disabled: uploading,
                style: {
                  flex: 1,
                  padding: '10px',
                  borderRadius: 8,
                  border: '1px solid #e5e7eb',
                  background: '#fff',
                  color: '#374151',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer'
                }
              }, 'Cancel'),
              H('button', {
                onClick: handleUpload,
                disabled: uploading,
                style: {
                  flex: 1,
                  padding: '10px',
                  borderRadius: 8,
                  border: 'none',
                  background: uploading ? '#e5e7eb' : '#111',
                  color: uploading ? '#9ca3af' : '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: uploading ? 'not-allowed' : 'pointer'
                }
              }, uploading ? 'Uploading...' : 'Upload')
            )
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
