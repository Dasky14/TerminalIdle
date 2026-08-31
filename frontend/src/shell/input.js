// Global keyboard wiring for menu navigation.
//
// Three equivalent activation paths are supported across the shell; this file
// owns the keyboard ones (hotkey + arrows/Enter + Esc/back). Mouse clicks are
// wired in shell.render(). Typing into the command line is handled in
// commandLine.js — so we bail out here whenever a text field is focused.

/**
 * @param {import('./shell.js').Shell} shell
 */
export function attachInput(shell) {
  window.addEventListener('keydown', (e) => {
    // Don't hijack keys while the user is typing in the command line (or any
    // input/textarea/contenteditable).
    if (isTypingTarget(e.target)) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        shell.moveFocus(1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        shell.moveFocus(-1);
        return;
      case 'Enter':
        e.preventDefault();
        shell.activateFocused();
        return;
      case 'Escape':
      case 'Backspace':
        e.preventDefault();
        shell.back();
        return;
      default:
        break;
    }

    // Single printable letter/number → treat as a menu hotkey.
    if (e.key.length === 1 && /[a-z0-9]/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (shell.activateByKey(e.key)) {
        e.preventDefault();
      }
    }
  });
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}
