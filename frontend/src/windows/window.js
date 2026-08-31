// A single draggable + resizable floating window that hosts one <iframe>.
//
// Pure DOM, no framework. The window notifies the manager on focus/close via
// callbacks passed in `opts`.

let uidCounter = 0;

export class FloatingWindow {
  /**
   * @param {object} opts
   * @param {string} opts.title
   * @param {string} opts.src           iframe URL
   * @param {{w:number,h:number}} [opts.size]
   * @param {{x:number,y:number}} [opts.position]
   * @param {(win:FloatingWindow)=>void} [opts.onFocus]
   * @param {(win:FloatingWindow)=>void} [opts.onClose]
   */
  constructor(opts) {
    this.id = `win-${++uidCounter}`;
    this.opts = opts;
    this.el = this._build();
    this.iframe = this.el.querySelector('iframe');
  }

  _build() {
    const { title, src, size = { w: 480, h: 360 }, position = { x: 80, y: 60 } } = this.opts;

    const win = document.createElement('div');
    win.className = 'til-window';
    win.style.width = `${size.w}px`;
    win.style.height = `${size.h}px`;
    win.style.left = `${position.x}px`;
    win.style.top = `${position.y}px`;

    win.innerHTML = `
      <div class="til-window__titlebar">
        <span class="til-window__title"></span>
        <div class="til-window__controls">
          <button class="til-window__btn til-window__min" title="Minimize" aria-label="Minimize">_</button>
          <button class="til-window__btn til-window__close" title="Close" aria-label="Close">×</button>
        </div>
      </div>
      <div class="til-window__body">
        <iframe
          class="til-window__frame"
          sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms"
          referrerpolicy="no-referrer"
        ></iframe>
      </div>
      <div class="til-window__resize" title="Resize"></div>
    `;

    win.querySelector('.til-window__title').textContent = title;
    win.querySelector('iframe').src = src;

    // Focus on any interaction with the window chrome.
    win.addEventListener('mousedown', () => this._focus());

    this._wireDrag(win);
    this._wireResize(win);

    win.querySelector('.til-window__close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });
    win.querySelector('.til-window__min').addEventListener('click', (e) => {
      e.stopPropagation();
      win.classList.toggle('til-window--minimized');
    });

    return win;
  }

  _focus() {
    if (this.opts.onFocus) this.opts.onFocus(this);
  }

  _wireDrag(win) {
    const bar = win.querySelector('.til-window__titlebar');
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;

    const onMove = (e) => {
      win.style.left = `${originLeft + (e.clientX - startX)}px`;
      win.style.top = `${Math.max(0, originTop + (e.clientY - startY))}px`;
    };
    const onUp = () => {
      // Re-enable iframe pointer events after dragging (see below).
      win.classList.remove('til-window--dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    bar.addEventListener('mousedown', (e) => {
      if (e.target.closest('.til-window__btn')) return; // let buttons work
      e.preventDefault();
      startX = e.clientX;
      startY = e.clientY;
      originLeft = win.offsetLeft;
      originTop = win.offsetTop;
      // While dragging, disable iframe pointer events so the drag isn't
      // swallowed by the embedded content.
      win.classList.add('til-window--dragging');
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  _wireResize(win) {
    const handle = win.querySelector('.til-window__resize');
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;

    const onMove = (e) => {
      win.style.width = `${Math.max(240, startW + (e.clientX - startX))}px`;
      win.style.height = `${Math.max(160, startH + (e.clientY - startY))}px`;
    };
    const onUp = () => {
      win.classList.remove('til-window--dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX;
      startY = e.clientY;
      startW = win.offsetWidth;
      startH = win.offsetHeight;
      win.classList.add('til-window--dragging');
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  setActive(isActive) {
    this.el.classList.toggle('til-window--active', isActive);
  }

  setZIndex(z) {
    this.el.style.zIndex = String(z);
  }

  /**
   * Switch this window between desktop (free-floating, inline-positioned) and
   * mobile (full-width card; CSS handles layout). The iframe element is never
   * recreated, so the running game and its bridge are preserved either way.
   */
  applyMobile(on) {
    if (on) {
      // Remember desktop geometry, then let the mobile CSS take over.
      this._savedRect = {
        width: this.el.style.width,
        height: this.el.style.height,
        left: this.el.style.left,
        top: this.el.style.top,
      };
      this.el.style.width = '';
      this.el.style.height = '';
      this.el.style.left = '';
      this.el.style.top = '';
      this.el.style.zIndex = '';
      this.el.classList.remove('til-window--active');
    } else {
      const r = this._savedRect || {};
      const { size = { w: 480, h: 360 }, position = { x: 80, y: 60 } } = this.opts;
      this.el.style.width = r.width || `${size.w}px`;
      this.el.style.height = r.height || `${size.h}px`;
      this.el.style.left = r.left || `${position.x}px`;
      this.el.style.top = r.top || `${position.y}px`;
    }
  }

  close() {
    if (this.opts.onClose) this.opts.onClose(this);
    this.el.remove();
  }
}
