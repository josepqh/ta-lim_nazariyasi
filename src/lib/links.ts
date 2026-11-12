import { showSection, type PublicSection } from '../store';

interface LinkClick {
  preventDefault(): void;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

// The address a public section lives at, so a link can be copied or opened in a new tab.
export function sectionHref(section: PublicSection): string {
  return section === 'home' ? '/' : `#${section}`;
}

// A plain left click stays in the page; Cmd/Ctrl/Shift-click and the middle button keep the browser's
// own behaviour (a new tab or window). Returns true when the page should handle the click.
export function isPlainClick(event: LinkClick): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  event.preventDefault();
  return true;
}

export function openSection(section: PublicSection, after?: () => void) {
  return (event: LinkClick) => {
    if (!isPlainClick(event)) return;
    showSection(section);
    after?.();
  };
}
