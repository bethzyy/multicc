/**
 * Toast Component
 *
 * Individual toast notification with auto-dismiss and manual close
 */

import { useEffect, useState } from 'react';
import type { ToastType } from './ToastContext';
import './Toast.css';

export interface ToastProps {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
  onDismiss: (id: string) => void;
}

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 3000,
  error: 5000,
  warning: 4000,
  info: 3000,
};

export function Toast({ id, type, message, duration, onDismiss }: ToastProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const actualDuration = duration ?? DEFAULT_DURATIONS[type];

  useEffect(() => {
    // Trigger enter animation
    requestAnimationFrame(() => {
      setIsVisible(true);
    });

    // Auto dismiss
    const timer = setTimeout(() => {
      handleDismiss();
    }, actualDuration);

    return () => clearTimeout(timer);
  }, [actualDuration]);

  const handleDismiss = () => {
    setIsLeaving(true);
    setTimeout(() => {
      onDismiss(id);
    }, 300); // Match CSS transition duration
  };

  return (
    <div
      className={`toast toast--${type} ${isVisible && !isLeaving ? 'toast--visible' : ''}`}
      role="alert"
      aria-live="polite"
    >
      <span className="toast__icon">{ICONS[type]}</span>
      <span className="toast__message">{message}</span>
      <button
        className="toast__close"
        onClick={handleDismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
      <div
        className="toast__progress"
        style={{ animationDuration: `${actualDuration}ms` }}
      />
    </div>
  );
}
