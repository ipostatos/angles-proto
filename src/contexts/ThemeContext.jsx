import React, { createContext, useContext, useEffect, useState } from 'react';

const THEME_STORAGE_KEY = 'angles_proto_theme';

const lightTheme = {
    name: 'light',
    colors: {
        background: '#fafafa',
        cardBg: '#ffffff',
        textPrimary: '#1a1a1a',
        textSecondary: '#666666',
        textTertiary: '#888888',
        textMuted: '#999999',
        textLight: '#aaaaaa',
        border: '#e8e8e8',
        borderLight: '#eeeeee',
        borderMedium: '#e0e0e0',
        borderDark: '#dddddd',
        hoverBg: '#f6f6f6',
        activeBg: '#f5f5f5',
        inputBg: '#ffffff',
        buttonPrimaryBg: '#1a1a1a',
        buttonPrimaryText: '#ffffff',
        buttonPrimaryBorder: '#1a1a1a',
        buttonGhostBg: '#ffffff',
        buttonGhostText: '#1a1a1a',
        buttonGhostBorder: '#dddddd',
        viewerEmptyBg: '#fafafa',
        viewerEmptyBorder: '#e0e0e0',
        adminPageBg: '#fafafa',
    },
};

const darkTheme = {
    name: 'dark',
    colors: {
        background: '#1a1a1a',
        cardBg: '#2a2a2a',
        textPrimary: '#e8e8e8',
        textSecondary: '#aaaaaa',
        textTertiary: '#888888',
        textMuted: '#777777',
        textLight: '#666666',
        border: '#3a3a3a',
        borderLight: '#333333',
        borderMedium: '#444444',
        borderDark: '#4a4a4a',
        hoverBg: '#333333',
        activeBg: '#353535',
        inputBg: '#2a2a2a',
        buttonPrimaryBg: '#e8e8e8',
        buttonPrimaryText: '#1a1a1a',
        buttonPrimaryBorder: '#e8e8e8',
        buttonGhostBg: '#2a2a2a',
        buttonGhostText: '#e8e8e8',
        buttonGhostBorder: '#4a4a4a',
        viewerEmptyBg: '#242424',
        viewerEmptyBorder: '#3a3a3a',
        adminPageBg: '#1a1a1a',
    },
};

const ThemeContext = createContext({
    theme: lightTheme,
    toggleTheme: () => { },
    isDark: false,
});

export function ThemeProvider({ children }) {
    const [isDark, setIsDark] = useState(() => {
        try {
            const saved = localStorage.getItem(THEME_STORAGE_KEY);
            return saved === 'dark';
        } catch {
            return false;
        }
    });

    const theme = isDark ? darkTheme : lightTheme;

    const toggleTheme = () => {
        setIsDark((prev) => !prev);
    };

    useEffect(() => {
        try {
            localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
        } catch {
            // Ignore storage errors
        }
    }, [isDark]);

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme, isDark }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within ThemeProvider');
    }
    return context;
}
