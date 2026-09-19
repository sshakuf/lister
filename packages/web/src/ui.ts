import { create } from "zustand";

interface PickerRequest {
  title: string;
  /** called with the chosen absolute/contracted directory path */
  onPick: (folder: string) => Promise<void>;
}

interface UiState {
  searchOpen: boolean;
  picker: PickerRequest | null;
  /** increments on every server file.changed; Admin uses it to refresh */
  changeTick: number;
  setSearchOpen(v: boolean): void;
  openPicker(req: PickerRequest): void;
  closePicker(): void;
  tick(): void;
}

export const useUi = create<UiState>((set) => ({
  searchOpen: false,
  picker: null,
  changeTick: 0,
  setSearchOpen: (v) => set({ searchOpen: v }),
  openPicker: (req) => set({ picker: req }),
  closePicker: () => set({ picker: null }),
  tick: () => set((s) => ({ changeTick: s.changeTick + 1 })),
}));

/**
 * Set while a finger is on the edit toolbar / action sheet. The focused bullet uses it to
 * ignore the blur iOS Safari fires when a fixed-position button is tapped, keeping the keyboard up.
 */
let toolbarTouchUntil = 0;
export function markToolbarTouch(): void {
  toolbarTouchUntil = Date.now() + 700;
}
export function toolbarTouching(): boolean {
  return Date.now() < toolbarTouchUntil;
}
