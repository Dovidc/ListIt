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

    function ProfilePictureUploadModal({ open, onClose, onUploadComplete, currentPictureUrl }) {
      const [selectedFile, setSelectedFile] = useState(null);
      const [previewUrl, setPreviewUrl] = useState(null);
      const [uploading, setUploading] = useState(false);
      const [error, setError] = useState(null);
      const [cropData, setCropData] = useState({ x: 0, y: 0, size: 100 });
      const fileInputRef = useRef(null);
      const canvasRef = useRef(null);
      const imageRef = useRef(null);

      useEffect(() => {
        if (!open) {
          setSelectedFile(null);
          setPreviewUrl(null);
          setError(null);
          setCropData({ x: 0, y: 0, size: 100 });
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
          // Create cropped image
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          const img = imageRef.current;

          // Set canvas size
          canvas.width = 200;
          canvas.height = 200;

          // Calculate crop dimensions
          const scale = img.naturalWidth / img.width;
          const cropX = cropData.x * scale;
          const cropY = cropData.y * scale;
          const cropSize = cropData.size * scale;

          // Draw cropped image
          ctx.drawImage(
            img,
            cropX,
            cropY,
            cropSize,
            cropSize,
            0,
            0,
            200,
            200
          );

          // Convert to blob
          const blob = await new Promise((resolve) => {
            canvas.toBlob(resolve, 'image/jpeg', 0.9);
          });

          // Upload to S3
          const file = new File([blob], 'profile-picture.jpg', { type: 'image/jpeg' });
          const url = await uploadOneMessageImage(file);

          // Update profile picture
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

      const handleImageLoad = useCallback(() => {
        if (!imageRef.current) return;
        const img = imageRef.current;
        const size = Math.min(img.width, img.height);
        const x = (img.width - size) / 2;
        const y = (img.height - size) / 2;
        setCropData({ x, y, size });
      }, []);

      if (!open) return null;

      const modalContent = H('div', {
        className: 'modal-overlay',
        onClick: (e) => {
          if (e.target.classList.contains('modal-overlay')) {
            onClose?.();
          }
        }
      },
        H('div', { className: 'modal-content', style: { maxWidth: 500 } },
          H('div', { className: 'modal-header' },
            H('h2', { style: { margin: 0, fontSize: 20, fontWeight: 700 } }, 'Profile Picture'),
            H('button', {
              className: 'modal-close',
              onClick: onClose,
              'aria-label': 'Close'
            }, '×')
          ),
          H('div', { className: 'modal-body' },
            error && H('div', {
              style: {
                padding: 12,
                background: '#fee2e2',
                color: '#991b1b',
                borderRadius: 8,
                marginBottom: 12
              }
            }, error),
            !previewUrl && H('div', null,
              currentPictureUrl && H('div', {
                style: {
                  width: 200,
                  height: 200,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  margin: '0 auto 16px',
                  border: '2px solid #e5e7eb'
                }
              },
                H('img', {
                  src: currentPictureUrl,
                  alt: 'Current profile picture',
                  style: { width: '100%', height: '100%', objectFit: 'cover' }
                })
              ),
              H('input', {
                ref: fileInputRef,
                type: 'file',
                accept: 'image/*',
                onChange: handleFileSelect,
                style: { display: 'none' }
              }),
              H('button', {
                className: 'btn-primary',
                onClick: () => fileInputRef.current?.click(),
                style: { width: '100%', marginBottom: 8 }
              }, 'Choose Photo'),
              currentPictureUrl && H('button', {
                className: 'btn',
                onClick: handleRemove,
                disabled: uploading,
                style: { width: '100%' }
              }, uploading ? 'Removing...' : 'Remove Photo')
            ),
            previewUrl && H('div', null,
              H('div', {
                style: {
                  position: 'relative',
                  width: '100%',
                  maxWidth: 400,
                  margin: '0 auto 16px'
                }
              },
                H('img', {
                  ref: imageRef,
                  src: previewUrl,
                  alt: 'Preview',
                  onLoad: handleImageLoad,
                  style: {
                    width: '100%',
                    display: 'block',
                    borderRadius: 8
                  }
                }),
                H('div', {
                  style: {
                    position: 'absolute',
                    left: cropData.x,
                    top: cropData.y,
                    width: cropData.size,
                    height: cropData.size,
                    border: '2px solid white',
                    boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
                    borderRadius: '50%',
                    pointerEvents: 'none'
                  }
                })
              ),
              H('canvas', {
                ref: canvasRef,
                style: { display: 'none' }
              }),
              H('div', { style: { display: 'flex', gap: 8 } },
                H('button', {
                  className: 'btn',
                  onClick: () => {
                    setPreviewUrl(null);
                    setSelectedFile(null);
                  },
                  disabled: uploading,
                  style: { flex: 1 }
                }, 'Cancel'),
                H('button', {
                  className: 'btn-primary',
                  onClick: handleUpload,
                  disabled: uploading,
                  style: { flex: 1 }
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
    window.createProfilePictureUploadComponents = createProfilePictureUploadComponents;
  }
})();
