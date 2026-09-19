import { Service, signal } from '@angular/core';

export interface Toast {
  id: number;
  message: string;
  undo?: () => void;
}

/** Minimal signal-based toast queue, rendered by the single ToastHost at the app root. */
@Service()
export class ToastService {
  private readonly _toasts = signal<Toast[]>([]);
  private nextId = 0;

  readonly toasts = this._toasts.asReadonly();

  show(message: string, options?: { undo?: () => void; durationMs?: number }): number {
    const id = this.nextId++;
    this._toasts.update((list) => [...list, { id, message, undo: options?.undo }]);
    const duration = options?.durationMs ?? 6000;
    setTimeout(() => this.dismiss(id), duration);
    return id;
  }

  dismiss(id: number): void {
    this._toasts.update((list) => list.filter((t) => t.id !== id));
  }

  runUndo(id: number): void {
    const toast = this._toasts().find((t) => t.id === id);
    toast?.undo?.();
    this.dismiss(id);
  }
}
