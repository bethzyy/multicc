/**
 * Toast Container
 *
 * Renders all active toasts in a fixed position container
 */

import React from 'react';
import { useToast } from './ToastContext';
import { Toast } from './Toast';

export function ToastContainer() {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-label="Notifications">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          id={toast.id}
          type={toast.type}
          message={toast.message}
          duration={toast.duration}
          onDismiss={dismissToast}
        />
      ))}
    </div>
  );
}
