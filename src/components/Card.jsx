import React from 'react';

export function Card({ children, style, className, ...rest }) {
    return (
        <div style={style} className={className ? `card ${className}` : "card"} {...rest}>
            {children}
        </div>
    );
}
