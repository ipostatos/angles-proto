import React from 'react';

export function Card({ children, style, ...rest }) {
    return (
        <div style={style} className="card" {...rest}>
            {children}
        </div>
    );
}
