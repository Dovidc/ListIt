(() => {
    function createErrorBoundary({ React }) {
        if (!React) throw new Error('ErrorBoundary requires React');

        const H = React.createElement;

        class GlobalErrorBoundary extends React.Component {
            constructor(props) {
                super(props);
                this.state = { hasError: false, error: null };
            }

            static getDerivedStateFromError(error) {
                return { hasError: true, error };
            }

            componentDidCatch(error, errorInfo) {
                console.error('GlobalErrorBoundary caught an error:', error, errorInfo);
            }

            handleReload = () => {
                window.location.reload();
            };

            render() {
                if (this.state.hasError) {
                    return H('div', {
                        style: {
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100vh',
                            padding: '20px',
                            textAlign: 'center',
                            fontFamily: 'system-ui, -apple-system, sans-serif',
                            backgroundColor: '#f9fafb',
                            color: '#1f2937'
                        }
                    },
                        H('h1', { style: { fontSize: '24px', marginBottom: '16px' } }, 'Something went wrong'),
                        H('p', { style: { marginBottom: '24px', color: '#4b5563' } }, 'We encountered an unexpected error. Please try reloading the page.'),
                        H('button', {
                            onClick: this.handleReload,
                            style: {
                                padding: '10px 20px',
                                fontSize: '16px',
                                backgroundColor: '#2563eb',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer'
                            }
                        }, 'Reload Application')
                    );
                }

                return this.props.children;
            }
        }

        return { GlobalErrorBoundary };
    }

    window.ListItApp = window.ListItApp || {};
    window.ListItApp.components = window.ListItApp.components || {};
    window.ListItApp.components.errorBoundary = { createErrorBoundary };
})();
