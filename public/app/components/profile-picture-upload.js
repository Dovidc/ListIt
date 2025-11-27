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
        },
        style: {
          background: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(4px)'
        }
      },
        H('div', {
          className: 'modal-inner',
          style: {
            maxWidth: '440px',
            width: 'min(440px, 92vw)',
            padding: 0,
            background: '#fff',
            color: '#111',
            borderRadius: 20,
            overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
          }
        },
          // Header with gradient background
          H('div', {
            style: {
              background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
              padding: '24px 24px 20px',
              position: 'relative'
            }
          },
            H('button', {
              onClick: onClose,
              title: 'Close',
              style: {
                position: 'absolute',
                top: 12,
                right: 12,
                width: 32,
                height: 32,
                borderRadius: '50%',
                border: 'none',
                background: 'rgba(255, 255, 255, 0.2)',
                color: '#fff',
                fontSize: 18,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 150ms ease'
              }
            }, '\u2715'),
            H('h2', {
              style: {
                fontSize: 22,
                fontWeight: 700,
                margin: 0,
                color: '#fff'
              }
            }, 'Profile Picture'),
            H('p', {
              style: {
                fontSize: 14,
                margin: '8px 0 0',
                color: 'rgba(255, 255, 255, 0.85)'
              }
            }, 'Upload a photo and customize your avatar')
          ),

          // Content area
          H('div', { style: { padding: '20px 24px 24px' } },
            // Error message
            error && H('div', {
              style: {
                padding: '12px 16px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 12,
                fontSize: 13,
                color: '#dc2626',
                marginBottom: 16
              }
            }, error),

            // Avatar border customization (Premium feature)
            avatarBorderColor && avatarBorderStyle && H('div', {
              style: {
                marginBottom: 20,
                padding: 16,
                background: '#f8fafc',
                borderRadius: 12,
                border: '1px solid #e2e8f0'
              }
            },
              H('div', {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12
                }
              },
                H('span', {
                  style: { fontWeight: 600, fontSize: 14, color: '#374151' }
                }, 'Avatar Outline'),
                !isPremium && H('span', {
                  style: {
                    fontSize: 11,
                    padding: '2px 8px',
                    background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                    color: '#92400e',
                    borderRadius: 10,
                    fontWeight: 600
                  }
                }, 'Premium')
              ),
              H('div', {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16
                }
              },
                // Preview
                H('div', {
                  style: {
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    borderColor: borderColorValue,
                    borderStyle: borderStyleValue,
                    borderWidth: 4,
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                    background: currentPictureUrl ? `url(${currentPictureUrl}) center/cover` : '#1f2937',
                    color: '#e2e8f0',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 700,
                    fontSize: 20,
                    flexShrink: 0
                  }
                }, !currentPictureUrl && 'Aa'),
                // Controls
                H('div', {
                  style: {
                    display: 'flex',
                    gap: 8,
                    flex: 1
                  }
                },
                  H('label', {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      flex: 1
                    }
                  },
                    H('span', {
                      style: { fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }
                    }, 'Color'),
                    H('input', {
                      type: 'color',
                      value: borderColorValue,
                      onChange: (evt) => onChangeBorderColor?.(evt.target.value),
                      disabled: !isPremium,
                      style: {
                        width: '100%',
                        height: 36,
                        borderRadius: 8,
                        border: '1px solid #d1d5db',
                        cursor: isPremium ? 'pointer' : 'not-allowed',
                        opacity: isPremium ? 1 : 0.5
                      }
                    })
                  ),
                  H('label', {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      flex: 1
                    }
                  },
                    H('span', {
                      style: { fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }
                    }, 'Style'),
                    H('select', {
                      value: borderStyleValue,
                      onChange: (evt) => onChangeBorderStyle?.(evt.target.value),
                      disabled: !isPremium,
                      style: {
                        width: '100%',
                        height: 36,
                        padding: '0 8px',
                        border: '1px solid #d1d5db',
                        borderRadius: 8,
                        cursor: isPremium ? 'pointer' : 'not-allowed',
                        background: '#fff',
                        opacity: isPremium ? 1 : 0.5
                      }
                    },
                      H('option', { value: 'solid' }, 'Solid'),
                      H('option', { value: 'dashed' }, 'Dashed')
                    )
                  )
                )
              ),
              // Save button for avatar outline
              onSave && H('button', {
                onClick: handleSaveAndClose,
                disabled: !isPremium || saving,
                style: {
                  marginTop: 12,
                  width: '100%',
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: (!isPremium || saving) ? '#d1d5db' : 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: (!isPremium || saving) ? 'not-allowed' : 'pointer',
                  transition: 'all 150ms ease'
                }
              }, saving ? 'Saving...' : 'Save Outline')
            ),

            // Photo upload section
            !previewUrl && H('div', null,
              // Current picture display
              H('div', {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  marginBottom: 20
                }
              },
                H('div', {
                  style: {
                    width: 120,
                    height: 120,
                    borderRadius: '50%',
                    overflow: 'hidden',
                    border: '3px solid #e5e7eb',
                    background: '#f3f4f6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 8
                  }
                },
                  currentPictureUrl
                    ? H('img', {
                      src: currentPictureUrl,
                      alt: 'Current profile picture',
                      style: { width: '100%', height: '100%', objectFit: 'cover' }
                    })
                    : H('div', {
                      style: {
                        fontSize: 40,
                        color: '#9ca3af'
                      }
                    }, '\uD83D\uDC64')
                ),
                H('span', {
                  style: { fontSize: 13, color: '#6b7280' }
                }, currentPictureUrl ? 'Current photo' : 'No photo set')
              ),

              // Upload button
              H('input', {
                ref: fileInputRef,
                type: 'file',
                accept: 'image/*',
                onChange: handleFileSelect,
                style: { display: 'none' }
              }),
              H('button', {
                onClick: () => fileInputRef.current?.click(),
                style: {
                  width: '100%',
                  padding: '12px 20px',
                  borderRadius: 10,
                  border: 'none',
                  background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginBottom: 8,
                  transition: 'all 150ms ease'
                }
              }, 'Choose Photo'),

              // Remove button
              currentPictureUrl && H('button', {
                onClick: handleRemove,
                disabled: uploading,
                style: {
                  width: '100%',
                  padding: '12px 20px',
                  borderRadius: 10,
                  border: '1px solid #e5e7eb',
                  background: '#fff',
                  color: '#dc2626',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: uploading ? 'not-allowed' : 'pointer',
                  transition: 'all 150ms ease',
                  opacity: uploading ? 0.6 : 1
                }
              }, uploading ? 'Removing...' : 'Remove Photo')
            ),

            // Crop preview
            previewUrl && H('div', null,
              H('div', {
                style: {
                  position: 'relative',
                  width: '100%',
                  maxWidth: 350,
                  margin: '0 auto 16px',
                  borderRadius: 12,
                  overflow: 'hidden'
                }
              },
                H('img', {
                  ref: imageRef,
                  src: previewUrl,
                  alt: 'Preview',
                  onLoad: handleImageLoad,
                  style: {
                    width: '100%',
                    display: 'block'
                  }
                }),
                H('div', {
                  onMouseDown: handleMouseDown,
                  style: {
                    position: 'absolute',
                    left: cropData.x,
                    top: cropData.y,
                    width: cropData.size,
                    height: cropData.size,
                    border: '3px solid white',
                    boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
                    borderRadius: '50%',
                    cursor: 'move',
                    pointerEvents: 'auto'
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
                      fontSize: 11,
                      fontWeight: 600,
                      textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                      pointerEvents: 'none',
                      userSelect: 'none'
                    }
                  }, 'Drag to adjust')
                )
              ),
              H('canvas', {
                ref: canvasRef,
                style: { display: 'none' }
              }),
              // Action buttons
              H('div', {
                style: {
                  display: 'flex',
                  gap: 12
                }
              },
                H('button', {
                  onClick: () => {
                    setPreviewUrl(null);
                    setSelectedFile(null);
                  },
                  disabled: uploading,
                  style: {
                    flex: 1,
                    padding: '12px 20px',
                    borderRadius: 10,
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    color: '#374151',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: uploading ? 'not-allowed' : 'pointer',
                    transition: 'all 150ms ease'
                  }
                }, 'Cancel'),
                H('button', {
                  onClick: handleUpload,
                  disabled: uploading,
                  style: {
                    flex: 1,
                    padding: '12px 20px',
                    borderRadius: 10,
                    border: 'none',
                    background: uploading ? '#d1d5db' : 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: uploading ? 'not-allowed' : 'pointer',
                    transition: 'all 150ms ease'
                  }
                }, uploading ? 'Uploading...' : 'Upload')
              )
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
