function auth_signIn(payload) {
  return payload.email && payload.password;
}

function listings_fetch() {
  return [
    { id: '1', title: 'Sample Listing', subtitle: 'Sourced from shared core' }
  ];
}

function upload_photo(base64) {
  return !!base64;
}

if (typeof NativeBridge !== 'undefined') {
  NativeBridge.log('Shared core stub loaded');
}
