import React, { useState, useEffect } from 'react';

/**
 * Error boundary component to catch React errors and display fallback UI.
 * Prevents white screen of death and provides user-friendly error messages.
 * Now supports theming by reading from localStorage.
 */
export class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('ErrorBoundary caught:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return <ErrorFallback error={this.state.error} />;
        }
        return this.props.children;
    }
}

function ErrorFallback({ error }) {
    const [isDark, setIsDark] = useState(false);

    useEffect(() => {
        try {
            const theme = localStorage.getItem('angles_proto_theme');
            setIsDark(theme === 'dark');
        } catch {
            setIsDark(false);
        }
    }, []);

    const colors = isDark ? {
        background: '#1a1a1a',
        textPrimary: '#e8e8e8',
        textSecondary: '#aaaaaa',
        buttonBg: '#e8e8e8',
        buttonText: '#1a1a1a',
        buttonBorder: '#e8e8e8',
    } : {
        background: '#fafafa',
        textPrimary: '#1a1a1a',
        textSecondary: '#666',
        buttonBg: '#1a1a1a',
        buttonText: '#fff',
        buttonBorder: '#1a1a1a',
    };

    return (
        <div style={{
            padding: 40,
            textAlign: 'center',
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: colors.background,
        }}>
            <h1 style={{ fontSize: 24, color: colors.textPrimary, marginBottom: 16 }}>
                Something went wrong
            </h1>
            <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 24 }}>
                {error?.message || 'An unexpected error occurred'}
            </p>
            <button
                onClick={() => window.location.reload()}
                style={{
                    border: `1px solid ${colors.buttonBorder}`,
                    background: colors.buttonBg,
                    borderRadius: 4,
                    padding: '10px 20px',
                    cursor: 'pointer',
                    fontSize: 14,
                    color: colors.buttonText,
                }}
            >
                Reload Page
            </button>
        </div>
    );
}
